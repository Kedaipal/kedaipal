import { useMutation } from "convex/react";
import {
	Clock,
	ExternalLink,
	MapPin,
	Package,
	Trash2,
	Truck,
	X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	assertValidFulfilmentDate,
	formatFulfilmentDate,
	fulfilmentDateBounds,
	mytMidnightFromYmd,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import type { UseCart } from "../../hooks/useCart";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { deriveMapsUrl } from "../../lib/google-address";
import { composeCustomerNote } from "../../lib/order-note";
import {
	type CheckoutAddressValues,
	checkoutFormSchema,
	emptyAddress,
} from "../../lib/schemas";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";
import { AddressFieldset } from "./address-fieldset";

const ADDRESS_STORAGE_KEY = "kedaipal:lastAddress";

/** Pickup kind — "self_collect" (seller's place) or "drop_off" (meetup point). */
export type PickupKind = "self_collect" | "drop_off";

/** Public-safe pickup location shape returned by `listActivePublicBySlug`. */
export interface PublicPickupLocation {
	_id: Id<"pickupLocations">;
	label: string;
	address: string;
	locationType: PickupKind;
	scheduleNote?: string;
	mapsUrl?: string;
	notes?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
	/** Flat fee (minor units) added to the order total when this point is
	 * chosen. Undefined = free. */
	fee?: number;
	sortOrder: number;
}

/** The fee a location adds to the total — 0 when free/unset. */
function pickupFeeOf(location: PublicPickupLocation | undefined): number {
	return location?.fee && location.fee > 0 ? location.fee : 0;
}

/** Buyer-facing sub-heading per pickup kind (one vocabulary, both sides). */
const PICKUP_KIND_HEADING: Record<PickupKind, string> = {
	self_collect: "Self-collect",
	drop_off: "Drop-off",
};

interface CheckoutSheetProps {
	open: boolean;
	onClose: () => void;
	cart: UseCart;
	retailerId: Id<"retailers">;
	storeName: string;
	checkoutPhone: string | undefined;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
	minFulfilmentNoticeDays: number | undefined;
	pickupLocations: ReadonlyArray<PublicPickupLocation>;
}

interface SanitizedDeliveryAddress {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postcode: string;
	notes?: string;
	mapsUrl?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
}

function loadSavedAddress(): CheckoutAddressValues {
	if (typeof window === "undefined") return emptyAddress;
	try {
		const raw = window.localStorage.getItem(ADDRESS_STORAGE_KEY);
		if (!raw) return emptyAddress;
		const parsed = JSON.parse(raw);
		return {
			line1: typeof parsed.line1 === "string" ? parsed.line1 : "",
			line2: typeof parsed.line2 === "string" ? parsed.line2 : "",
			city: typeof parsed.city === "string" ? parsed.city : "",
			state: typeof parsed.state === "string" ? parsed.state : "",
			postcode: typeof parsed.postcode === "string" ? parsed.postcode : "",
			notes: typeof parsed.notes === "string" ? parsed.notes : "",
			mapsUrl: typeof parsed.mapsUrl === "string" ? parsed.mapsUrl : "",
			latitude: typeof parsed.latitude === "string" ? parsed.latitude : "",
			longitude: typeof parsed.longitude === "string" ? parsed.longitude : "",
			placeId: typeof parsed.placeId === "string" ? parsed.placeId : "",
		};
	} catch {
		return emptyAddress;
	}
}

function saveAddress(addr: CheckoutAddressValues): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify(addr));
	} catch {
		// Quota errors / privacy mode — silently ignore.
	}
}

function sanitizeAddress(raw: CheckoutAddressValues): SanitizedDeliveryAddress {
	const line2 = raw.line2.trim();
	const notes = raw.notes.trim();
	const mapsUrl = raw.mapsUrl.trim();
	// lat/lng come in as strings from form state. Parse to numbers; drop on
	// any parse failure or invalid range — the order is still valid without.
	const latNum = raw.latitude.trim().length > 0 ? Number(raw.latitude) : NaN;
	const lngNum = raw.longitude.trim().length > 0 ? Number(raw.longitude) : NaN;
	const validCoords =
		Number.isFinite(latNum) &&
		Number.isFinite(lngNum) &&
		latNum >= -90 &&
		latNum <= 90 &&
		lngNum >= -180 &&
		lngNum <= 180;
	const placeId = raw.placeId.trim();
	return {
		line1: raw.line1.trim(),
		line2: line2.length > 0 ? line2 : undefined,
		city: raw.city.trim(),
		state: raw.state,
		postcode: raw.postcode.trim(),
		notes: notes.length > 0 ? notes : undefined,
		mapsUrl: mapsUrl.length > 0 ? mapsUrl : undefined,
		latitude: validCoords ? latNum : undefined,
		longitude: validCoords ? lngNum : undefined,
		placeId: placeId.length > 0 ? placeId : undefined,
	};
}

function formatAddressOneLine(addr: SanitizedDeliveryAddress): string {
	const parts = [addr.line1];
	if (addr.line2) parts.push(addr.line2);
	parts.push(`${addr.postcode} ${addr.city}`);
	parts.push(addr.state);
	return parts.join(", ");
}

function buildWaMessage(
	storeName: string,
	shortId: string,
	cart: UseCart,
	deliveryMethod: "delivery" | "self_collect",
	deliveryAddress: SanitizedDeliveryAddress | undefined,
	pickupLocation: PublicPickupLocation | undefined,
	note: string | undefined,
	fulfilmentDate: number | undefined,
): string {
	const lines: string[] = [];
	lines.push(`Hi ${storeName}, I'd like to place this order:`);
	lines.push("");
	lines.push(`Order: ${shortId}`);
	let hasQuoteItem = false;
	for (const item of cart.items) {
		const name = item.optionLabel
			? `${item.name} (${item.optionLabel})`
			: item.name;
		const suffix = item.quoteOnRequest ? " — price on quote" : "";
		if (item.quoteOnRequest) hasQuoteItem = true;
		lines.push(`• ${item.quantity}x ${name}${suffix}`);
	}
	lines.push("");
	// The chosen point's fee is part of what the buyer pays — the message total
	// must match the order total the server computed (subtotal + fee).
	const pickupFee =
		deliveryMethod === "self_collect" ? pickupFeeOf(pickupLocation) : 0;
	if (pickupFee > 0)
		lines.push(`Pickup fee: ${formatPrice(pickupFee, cart.currency)}`);
	lines.push(`Total: ${formatPrice(cart.total + pickupFee, cart.currency)}`);
	if (hasQuoteItem) lines.push("(Custom item price to be confirmed by seller)");
	if (deliveryMethod === "self_collect") {
		if (pickupLocation) {
			const verb =
				pickupLocation.locationType === "drop_off"
					? "Drop-off at"
					: "Self Collect at";
			lines.push(`📍 ${verb}: ${pickupLocation.label}`);
			lines.push(pickupLocation.address);
			if (pickupLocation.scheduleNote)
				lines.push(`🗓️ ${pickupLocation.scheduleNote}`);
			const mapsUrl = deriveMapsUrl(pickupLocation);
			if (mapsUrl) lines.push(mapsUrl);
			if (pickupLocation.notes) lines.push(pickupLocation.notes);
		} else {
			lines.push("📍 Pickup");
		}
	} else if (deliveryAddress) {
		lines.push(`🚚 Deliver to: ${formatAddressOneLine(deliveryAddress)}`);
		const mapsUrl = deriveMapsUrl(deliveryAddress);
		if (mapsUrl) lines.push(`📍 ${mapsUrl}`);
		if (deliveryAddress.notes) lines.push(`📝 ${deliveryAddress.notes}`);
	} else {
		lines.push("🚚 Delivery");
	}
	// Fulfilment date — the buyer's answer to "bila nak?". Sits with the
	// delivery/pickup block (it's the "when" to that "where"), above the note.
	if (fulfilmentDate !== undefined) {
		const verb = deliveryMethod === "self_collect" ? "Collect" : "Deliver";
		lines.push(`🗓️ ${verb} on: ${formatFulfilmentDate(fulfilmentDate)}`);
	}
	// Order note last, in a clearly delimited section. It sits AFTER the
	// "Order: ORD-XXXX" line, so even if the note text contains something that
	// looks like an order token, the inbound parser still matches the real ID
	// (first match) — see SHORT_ID_REGEX in whatsappCopy.
	if (note) {
		lines.push("");
		lines.push("📝 Note for seller:");
		lines.push(note);
	}
	return lines.join("\n");
}

export function CheckoutSheet({
	open,
	onClose,
	cart,
	retailerId,
	storeName,
	checkoutPhone,
	offerSelfCollect,
	offerDelivery,
	minFulfilmentNoticeDays,
	pickupLocations,
}: CheckoutSheetProps) {
	const createOrder = useMutation(api.orders.create);
	const [serverError, setServerError] = useState<string | null>(null);

	// Selectable date range for the picker: today + the retailer's notice (the
	// earliest day) through today + 30. Memoised on the retailer setting so the
	// "today" anchor is computed once per open, not on every keystroke. The
	// server re-validates against the live window — see convex/lib/fulfilmentDate.
	const { minYmd, maxYmd } = useMemo(() => {
		const bounds = fulfilmentDateBounds(minFulfilmentNoticeDays);
		return {
			minYmd: ymdFromEpoch(bounds.min),
			maxYmd: ymdFromEpoch(bounds.max),
		};
	}, [minFulfilmentNoticeDays]);

	const noCheckoutPhone = !checkoutPhone;
	// Self-collect surfaces on the storefront only when the retailer opted in
	// AND has at least one active pickup location. Both gates must be open or
	// the buyer never sees a non-functional option.
	const selfCollectAvailable = offerSelfCollect && pickupLocations.length > 0;
	// Delivery is zero-config (buyer types an address) so it only depends on the
	// retailer's opt-in. The settings invariant guarantees at least one of these
	// is true, so `neitherAvailable` is a defensive fallback, not a normal state.
	const deliveryAvailable = offerDelivery;
	const bothAvailable = deliveryAvailable && selfCollectAvailable;
	const neitherAvailable = !deliveryAvailable && !selfCollectAvailable;
	// Default to delivery when offered, otherwise self-collect — so a pickup-only
	// store opens straight on the pickup picker with no dead delivery branch.
	const defaultMethod: "delivery" | "self_collect" = deliveryAvailable
		? "delivery"
		: "self_collect";
	// Stable sort so the auto-select / radio list match the retailer's
	// configured order — the query already returns sorted, but defending against
	// upstream reordering is cheap and removes a class of subtle bugs.
	const sortedPickups = [...pickupLocations].sort(
		(a, b) => a.sortOrder - b.sortOrder,
	);
	const singlePickup =
		sortedPickups.length === 1 ? sortedPickups[0] : undefined;

	const form = useAppForm({
		defaultValues: {
			name: "",
			deliveryMethod: defaultMethod,
			address: loadSavedAddress(),
			// Empty when delivery, the chosen id when self-collect with 2+ options,
			// unused when self-collect with exactly 1 option (auto-resolved at submit).
			pickupLocationId: "",
			// "YYYY-MM-DD" the buyer picks for delivery/pickup. Required at submit.
			fulfilmentDate: "",
			// Optional free-text instruction for the seller (local form state — the
			// note is order-level, not a cart item, so it doesn't belong in useCart).
			note: "",
		},
		validators: { onChange: checkoutFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			if (cart.items.length === 0) return;
			if (noCheckoutPhone) {
				setServerError(
					"Order checkout is temporarily unavailable. Please try again shortly.",
				);
				return;
			}
			const sanitizedAddress =
				value.deliveryMethod === "delivery"
					? sanitizeAddress(value.address)
					: undefined;

			// Resolve the chosen pickup location id. For the single-location case
			// we never asked the buyer to pick — auto-fill from the (only) option.
			let resolvedPickupLocationId: Id<"pickupLocations"> | undefined;
			let resolvedPickupLocation: PublicPickupLocation | undefined;
			if (value.deliveryMethod === "self_collect" && selfCollectAvailable) {
				if (singlePickup) {
					resolvedPickupLocationId = singlePickup._id;
					resolvedPickupLocation = singlePickup;
				} else {
					const chosen = sortedPickups.find(
						(p) => p._id === value.pickupLocationId,
					);
					if (!chosen) {
						setServerError("Please choose a pickup location to continue.");
						return;
					}
					resolvedPickupLocationId = chosen._id;
					resolvedPickupLocation = chosen;
				}
			}

			// Resolve + range-check the fulfilment date. The schema guarantees a
			// non-empty string; here we convert to a MYT-midnight epoch and confirm
			// it's inside the live [min, max] window before sending. Mirrors the
			// server (which re-validates) so the buyer sees the error inline.
			const fulfilmentEpoch = mytMidnightFromYmd(value.fulfilmentDate);
			if (Number.isNaN(fulfilmentEpoch)) {
				setServerError("That date isn't valid — pick a day from the picker.");
				return;
			}
			try {
				assertValidFulfilmentDate(fulfilmentEpoch, minFulfilmentNoticeDays);
			} catch (err) {
				setServerError((err as Error).message);
				return;
			}

			const trimmedNote = value.note?.trim();
			const generalNote =
				trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;
			// Fold any per-line custom requests into the single order note so they
			// reach the seller via the existing customerNote channel (WhatsApp + the
			// dashboard + email) — no per-item schema needed. See docs/custom-option.md.
			const customerNote = composeCustomerNote(cart.items, generalNote);
			// Order is one custom negotiation → one reference image. Take the first
			// custom line's image (rare to have 2+ custom items in one order).
			const customerImageStorageId = cart.items.find(
				(i) => i.customImageStorageId,
			)?.customImageStorageId;

			try {
				const { shortId } = await createOrder({
					retailerId,
					items: cart.items.map((i) => ({
						variantId: i.variantId,
						quantity: i.quantity,
					})),
					currency: cart.currency,
					channel: "whatsapp",
					customer: {
						name: value.name?.trim() || undefined,
					},
					deliveryMethod: value.deliveryMethod,
					deliveryAddress: sanitizedAddress,
					pickupLocationId: resolvedPickupLocationId,
					fulfilmentDate: fulfilmentEpoch,
					customerNote,
					customerImageStorageId,
				});
				const message = buildWaMessage(
					storeName,
					shortId,
					cart,
					value.deliveryMethod,
					sanitizedAddress,
					resolvedPickupLocation,
					customerNote,
					fulfilmentEpoch,
				);
				const url = `https://wa.me/${checkoutPhone}?text=${encodeURIComponent(message)}`;
				if (value.deliveryMethod === "delivery") saveAddress(value.address);
				cart.clearCart();
				form.reset();
				onClose();
				window.open(url, "_blank", "noopener,noreferrer");
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							Review your order
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
								aria-label="Close"
							>
								<X className="size-5" />
							</button>
						</Dialog.Close>
					</div>

					<form
						onSubmit={handleSubmit}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex-1 overflow-y-auto px-5 py-4">
							{cart.items.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									Your cart is empty.
								</p>
							) : (
								<ul className="flex flex-col gap-3">
									{cart.items.map((item) => (
										<li
											key={item.variantId}
											className="flex items-center gap-3 rounded-xl border border-border p-3"
										>
											{item.imageUrl ? (
												<img
													src={item.imageUrl}
													alt={item.name}
													className="size-14 shrink-0 rounded-lg object-cover"
												/>
											) : (
												<div className="size-14 shrink-0 rounded-lg bg-muted" />
											)}
											<div className="flex flex-1 flex-col">
												<span className="text-sm font-medium leading-tight">
													{item.name}
												</span>
												{item.optionLabel ? (
													<span className="text-xs font-medium text-muted-foreground">
														{item.optionLabel}
													</span>
												) : null}
												<span className="text-xs text-muted-foreground">
													{item.quoteOnRequest
														? `${item.quantity} × Price on quote`
														: `${item.quantity} × ${formatPrice(item.price, item.currency)}`}
												</span>
												{item.note ? (
													<span className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
														📝 {item.note}
													</span>
												) : null}
												{item.customImageStorageId ? (
													<span className="mt-1 w-fit rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
														📎 Reference photo attached
													</span>
												) : null}
											</div>
											<div className="flex items-center gap-2">
												<span className="text-sm font-semibold">
													{item.quoteOnRequest
														? "On quote"
														: formatPrice(
																item.price * item.quantity,
																item.currency,
															)}
												</span>
												<button
													type="button"
													onClick={() => cart.removeItem(item.variantId)}
													className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
													aria-label={`Remove ${item.name}`}
												>
													<Trash2 className="size-4" />
												</button>
											</div>
										</li>
									))}
								</ul>
							)}

							<div className="mt-5 flex flex-col gap-4">
								<form.AppField name="name">
									{(field) => (
										<field.TextField
											label="Your name (optional)"
											placeholder="Ali"
											autoComplete="name"
										/>
									)}
								</form.AppField>
								{/* Method picker only when BOTH methods are offered. With a
								    single method there's nothing to choose, so we drop straight
								    to that method's form below (delivery → address, self-collect
								    → pickup picker). The settings invariant keeps ≥1 on offer. */}
								{bothAvailable ? (
									<form.AppField name="deliveryMethod">
										{(field) => (
											<fieldset className="flex flex-col gap-2">
												<legend className="text-sm font-medium">
													How would you like to receive your order?
												</legend>
												<div className="grid grid-cols-2 gap-2">
													<button
														type="button"
														onClick={() => field.handleChange("delivery")}
														className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors ${
															field.state.value === "delivery"
																? "border-accent bg-accent/5 text-accent"
																: "border-border bg-card text-muted-foreground hover:border-accent/40"
														}`}
													>
														<Truck className="size-5" />
														Delivery
													</button>
													<button
														type="button"
														onClick={() => field.handleChange("self_collect")}
														className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors ${
															field.state.value === "self_collect"
																? "border-accent bg-accent/5 text-accent"
																: "border-border bg-card text-muted-foreground hover:border-accent/40"
														}`}
													>
														<Package className="size-5" />
														Pickup
													</button>
												</div>
											</fieldset>
										)}
									</form.AppField>
								) : null}

								{neitherAvailable ? (
									<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
										This store isn&apos;t accepting orders right now. Please
										check back soon or message the store owner.
									</p>
								) : (
									<form.Subscribe selector={(s) => s.values.deliveryMethod}>
										{(deliveryMethod) =>
											deliveryMethod === "delivery" ? (
												<AddressFieldset
													form={form}
													fields="address"
													retailerId={retailerId}
												/>
											) : selfCollectAvailable ? (
												singlePickup ? (
													<PickupSummaryCard
														location={singlePickup}
														currency={cart.currency}
													/>
												) : (
													<form.AppField name="pickupLocationId">
														{(field) => (
															<PickupLocationRadioList
																locations={sortedPickups}
																currency={cart.currency}
																value={field.state.value}
																onChange={(id) => field.handleChange(id)}
															/>
														)}
													</form.AppField>
												)
											) : null
										}
									</form.Subscribe>
								)}

								{/* When do you need it — required for both delivery and
								    pickup. Sits below the where (address/pickup), above the
								    optional note: a required structured field outranks the
								    free-text note. Hidden only when the store can't take
								    orders at all. */}
								{neitherAvailable ? null : (
									<form.Subscribe
										selector={(s) => ({
											deliveryMethod: s.values.deliveryMethod,
											pickupLocationId: s.values.pickupLocationId,
										})}
									>
										{({ deliveryMethod, pickupLocationId }) => {
											// Resolve the point the buyer is collecting from so we
											// can surface its recurring schedule right here, at the
											// date step — a "Every Sat 3-5pm" drop-off shouldn't be
											// learned only after ordering. Single-pickup auto-resolves.
											const selectedPickup =
												deliveryMethod === "self_collect"
													? (singlePickup ??
														sortedPickups.find(
															(p) => p._id === pickupLocationId,
														))
													: undefined;
											// Drop-off points are meetups, not the seller's place —
											// the date question reads "meet", matching the DROP-OFF
											// badge and the tracking page's "Meet at".
											const isDropOff =
												selectedPickup?.locationType === "drop_off";
											return (
												<div className="flex flex-col gap-2">
													{selectedPickup?.scheduleNote ? (
														<p className="flex items-start gap-1.5 rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
															<Clock
																className="mt-0.5 size-3.5 shrink-0 text-accent"
																aria-hidden="true"
															/>
															<span>
																<span className="font-medium">
																	{selectedPickup.label}
																</span>{" "}
																is available{" "}
																<span className="font-medium">
																	{selectedPickup.scheduleNote}
																</span>{" "}
																— pick a matching date.
															</span>
														</p>
													) : null}
													<form.AppField name="fulfilmentDate">
														{(field) => (
															<field.DateField
																label={
																	deliveryMethod === "self_collect"
																		? isDropOff
																			? "When should we meet?"
																			: "When will you collect?"
																		: "When do you need it delivered?"
																}
																min={minYmd}
																max={maxYmd}
																required
																description={
																	isDropOff
																		? "Pick the date you'll meet at the drop-off point."
																		: "Pick the date you need this order."
																}
															/>
														)}
													</form.AppField>
												</div>
											);
										}}
									</form.Subscribe>
								)}

								<form.AppField name="note">
									{(field) => (
										<field.TextareaField
											label="Note for seller (optional)"
											placeholder="Any special instructions? e.g. no onions, deliver after 5pm"
											rows={3}
											maxLength={500}
										/>
									)}
								</form.AppField>
							</div>

							{noCheckoutPhone ? (
								<p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									Order checkout is temporarily unavailable. Please try again
									shortly or contact the store owner.
								</p>
							) : null}

							{serverError ? (
								<p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{serverError}
								</p>
							) : null}
						</div>

						<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<form.Subscribe
								selector={(s) => ({
									deliveryMethod: s.values.deliveryMethod,
									pickupLocationId: s.values.pickupLocationId,
								})}
							>
								{({ deliveryMethod, pickupLocationId }) => {
									// Selected point (single-location auto-resolves) → its fee
									// joins the total the buyer is about to send. Free orders
									// keep the original single Total row — no breakdown noise.
									const selectedPickup =
										deliveryMethod === "self_collect"
											? (singlePickup ??
												sortedPickups.find((p) => p._id === pickupLocationId))
											: undefined;
									const pickupFee = pickupFeeOf(selectedPickup);
									return (
										<div className="mb-3 flex flex-col gap-1">
											{pickupFee > 0 ? (
												<>
													<div className="flex items-center justify-between text-sm text-muted-foreground">
														<span>Subtotal</span>
														<span>
															{formatPrice(cart.total, cart.currency)}
														</span>
													</div>
													<div className="flex items-center justify-between text-sm text-muted-foreground">
														<span>Pickup fee — {selectedPickup?.label}</span>
														<span>{formatPrice(pickupFee, cart.currency)}</span>
													</div>
												</>
											) : null}
											<div className="flex items-center justify-between">
												<span className="text-sm text-muted-foreground">
													Total
												</span>
												<span className="text-xl font-bold">
													{formatPrice(cart.total + pickupFee, cart.currency)}
												</span>
											</div>
										</div>
									);
								}}
							</form.Subscribe>
							<form.Subscribe
								selector={(s) => ({
									canSubmit: s.canSubmit,
									isSubmitting: s.isSubmitting,
								})}
							>
								{({ canSubmit, isSubmitting }) => (
									<Button
										type="submit"
										disabled={
											!canSubmit ||
											isSubmitting ||
											cart.items.length === 0 ||
											noCheckoutPhone ||
											neitherAvailable
										}
										className="h-12 w-full text-base"
									>
										{isSubmitting ? "Sending…" : "Send order on WhatsApp"}
									</Button>
								)}
							</form.Subscribe>
							<p className="mt-3 text-center text-xs text-muted-foreground">
								By placing this order, you agree to our{" "}
								<a
									href="/privacy"
									target="_blank"
									rel="noopener noreferrer"
									className="underline hover:text-foreground"
								>
									Privacy Policy
								</a>
								.
							</p>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/**
 * Auto-selected confirmation card when the retailer has exactly one active
 * pickup location. No interaction needed — the location is resolved at submit
 * time.
 */
function PickupSummaryCard({
	location,
	currency,
}: {
	location: PublicPickupLocation;
	currency: string;
}) {
	return (
		<section className="flex flex-col gap-2 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
			<div className="flex items-start gap-2">
				<MapPin
					className="size-4 shrink-0 text-accent mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex items-center gap-2">
						<p className="text-sm font-semibold leading-tight">
							{location.label}
						</p>
						<PickupKindBadge kind={location.locationType} />
						<PickupFeeChip fee={location.fee} currency={currency} />
					</div>
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{location.address}
					</p>
					{location.scheduleNote ? (
						<p className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span className="line-clamp-2">{location.scheduleNote}</span>
						</p>
					) : null}
					{(() => {
						const mapsUrl = deriveMapsUrl(location);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
							>
								<ExternalLink className="size-3" />
								Open in maps
							</a>
						) : null;
					})()}
					{location.notes ? (
						<p className="text-xs text-muted-foreground whitespace-pre-line">
							{location.notes}
						</p>
					) : null}
				</div>
			</div>
		</section>
	);
}

/** "+ RM2.00 fee" chip on a paid pickup point — the charge must be visible on
 *  the option itself, before the buyer picks it, not only in the totals. */
function PickupFeeChip({
	fee,
	currency,
}: {
	fee: number | undefined;
	currency: string;
}) {
	if (!fee || fee <= 0) return null;
	return (
		<span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
			+ {formatPrice(fee, currency)} fee
		</span>
	);
}

/** Small kind chip so the buyer knows whether they're going to the seller's
 *  place or an agreed meetup point. */
function PickupKindBadge({ kind }: { kind: PickupKind }) {
	return (
		<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
			{PICKUP_KIND_HEADING[kind]}
		</span>
	);
}

/**
 * Required radio list when 2+ active pickup locations exist. Buyer must pick
 * one before submission — the submit handler refuses to proceed without a
 * matching id.
 */
function PickupLocationRadioList({
	locations,
	currency,
	value,
	onChange,
}: {
	locations: ReadonlyArray<PublicPickupLocation>;
	currency: string;
	value: string;
	onChange: (id: string) => void;
}) {
	// Group by kind, preserving the retailer's sort order within each group.
	// Sub-headings only appear when BOTH kinds exist — a single-kind seller
	// (the legacy 100%-self-collect case) sees a flat list, exactly as before.
	const selfCollect = locations.filter(
		(l) => l.locationType === "self_collect",
	);
	const dropOff = locations.filter((l) => l.locationType === "drop_off");
	const showHeadings = selfCollect.length > 0 && dropOff.length > 0;

	const renderOption = (loc: PublicPickupLocation) => {
		const selected = value === loc._id;
		const mapsUrl = deriveMapsUrl(loc);
		return (
			<label
				key={loc._id}
				className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${
					selected
						? "border-accent bg-accent/5"
						: "border-border bg-card hover:border-accent/40"
				}`}
			>
				<input
					type="radio"
					name="pickupLocationId"
					value={loc._id}
					checked={selected}
					onChange={() => onChange(loc._id)}
					className="mt-1 size-4 shrink-0 accent-accent"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex items-center gap-2">
						<span className="text-sm font-semibold leading-tight">
							{loc.label}
						</span>
						{/* Badge only when headings are off — otherwise the group
						    heading already names the kind. */}
						{showHeadings ? null : <PickupKindBadge kind={loc.locationType} />}
						<PickupFeeChip fee={loc.fee} currency={currency} />
					</span>
					<span className="text-xs text-muted-foreground whitespace-pre-line">
						{loc.address}
					</span>
					{loc.scheduleNote ? (
						<span className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span className="line-clamp-2">{loc.scheduleNote}</span>
						</span>
					) : null}
					{mapsUrl ? (
						<a
							href={mapsUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-3" />
							Open in maps
						</a>
					) : null}
				</div>
			</label>
		);
	};

	return (
		<fieldset className="flex flex-col gap-3">
			<legend className="text-sm font-medium">Choose a pickup point</legend>
			{showHeadings ? (
				<>
					<PickupGroup
						heading={PICKUP_KIND_HEADING.self_collect}
						locations={selfCollect}
						renderOption={renderOption}
					/>
					<PickupGroup
						heading={PICKUP_KIND_HEADING.drop_off}
						locations={dropOff}
						renderOption={renderOption}
					/>
				</>
			) : (
				<div className="flex flex-col gap-2">{locations.map(renderOption)}</div>
			)}
		</fieldset>
	);
}

function PickupGroup({
	heading,
	locations,
	renderOption,
}: {
	heading: string;
	locations: ReadonlyArray<PublicPickupLocation>;
	renderOption: (loc: PublicPickupLocation) => ReactNode;
}) {
	if (locations.length === 0) return null;
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{heading}
			</p>
			{locations.map(renderOption)}
		</div>
	);
}
