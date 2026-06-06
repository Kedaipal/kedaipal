import { useMutation } from "convex/react";
import { ExternalLink, MapPin, Package, Trash2, Truck, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { deriveMapsUrl } from "../../lib/google-address";
import {
	type CheckoutAddressValues,
	checkoutFormSchema,
	emptyAddress,
} from "../../lib/schemas";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";
import { AddressFieldset } from "./address-fieldset";

const ADDRESS_STORAGE_KEY = "kedaipal:lastAddress";

/** Public-safe pickup location shape returned by `listActivePublicBySlug`. */
export interface PublicPickupLocation {
	_id: Id<"pickupLocations">;
	label: string;
	address: string;
	mapsUrl?: string;
	notes?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
	sortOrder: number;
}

interface CheckoutSheetProps {
	open: boolean;
	onClose: () => void;
	cart: UseCart;
	retailerId: Id<"retailers">;
	storeName: string;
	checkoutPhone: string | undefined;
	offerSelfCollect: boolean;
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
	lines.push(`Total: ${formatPrice(cart.total, cart.currency)}`);
	if (hasQuoteItem) lines.push("(Custom item price to be confirmed by seller)");
	if (deliveryMethod === "self_collect") {
		if (pickupLocation) {
			lines.push(`📍 Self Collect at: ${pickupLocation.label}`);
			lines.push(pickupLocation.address);
			const mapsUrl = deriveMapsUrl(pickupLocation);
			if (mapsUrl) lines.push(mapsUrl);
			if (pickupLocation.notes) lines.push(pickupLocation.notes);
		} else {
			lines.push("📍 Self Collect");
		}
	} else if (deliveryAddress) {
		lines.push(`🚚 Deliver to: ${formatAddressOneLine(deliveryAddress)}`);
		const mapsUrl = deriveMapsUrl(deliveryAddress);
		if (mapsUrl) lines.push(`📍 ${mapsUrl}`);
		if (deliveryAddress.notes) lines.push(`📝 ${deliveryAddress.notes}`);
	} else {
		lines.push("🚚 Delivery");
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
	pickupLocations,
}: CheckoutSheetProps) {
	const createOrder = useMutation(api.orders.create);
	const [serverError, setServerError] = useState<string | null>(null);

	const noCheckoutPhone = !checkoutPhone;
	// Self-collect surfaces on the storefront only when the retailer opted in
	// AND has at least one active pickup location. Both gates must be open or
	// we fall back to delivery-only — the toggle button is hidden entirely so
	// the buyer never sees a non-functional option.
	const selfCollectAvailable = offerSelfCollect && pickupLocations.length > 0;
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
			deliveryMethod: "delivery" as "delivery" | "self_collect",
			address: loadSavedAddress(),
			// Empty when delivery, the chosen id when self-collect with 2+ options,
			// unused when self-collect with exactly 1 option (auto-resolved at submit).
			pickupLocationId: "",
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
				});
				const message = buildWaMessage(
					storeName,
					shortId,
					cart,
					value.deliveryMethod,
					sanitizedAddress,
					resolvedPickupLocation,
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
								{/* Delivery method — self-collect button hidden when the retailer
								    hasn't opted in or has no active pickup locations, so buyers
								    never see an option that can't be used. */}
								<form.AppField name="deliveryMethod">
									{(field) => (
										<fieldset className="flex flex-col gap-2">
											<legend className="text-sm font-medium">
												How would you like to receive your order?
											</legend>
											<div
												className={
													selfCollectAvailable
														? "grid grid-cols-2 gap-2"
														: "grid grid-cols-1 gap-2"
												}
											>
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
												{selfCollectAvailable ? (
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
														Self Collect
													</button>
												) : null}
											</div>
										</fieldset>
									)}
								</form.AppField>

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
												<PickupSummaryCard location={singlePickup} />
											) : (
												<form.AppField name="pickupLocationId">
													{(field) => (
														<PickupLocationRadioList
															locations={sortedPickups}
															value={field.state.value}
															onChange={(id) => field.handleChange(id)}
														/>
													)}
												</form.AppField>
											)
										) : null
									}
								</form.Subscribe>
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
							<div className="mb-3 flex items-center justify-between">
								<span className="text-sm text-muted-foreground">Total</span>
								<span className="text-xl font-bold">
									{formatPrice(cart.total, cart.currency)}
								</span>
							</div>
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
											noCheckoutPhone
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
function PickupSummaryCard({ location }: { location: PublicPickupLocation }) {
	return (
		<section className="flex flex-col gap-2 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
			<div className="flex items-start gap-2">
				<MapPin
					className="size-4 shrink-0 text-accent mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col gap-1">
					<p className="text-sm font-semibold leading-tight">
						{location.label}
					</p>
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{location.address}
					</p>
					{(() => {
						const mapsUrl = deriveMapsUrl(location);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noreferrer"
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

/**
 * Required radio list when 2+ active pickup locations exist. Buyer must pick
 * one before submission — the submit handler refuses to proceed without a
 * matching id.
 */
function PickupLocationRadioList({
	locations,
	value,
	onChange,
}: {
	locations: ReadonlyArray<PublicPickupLocation>;
	value: string;
	onChange: (id: string) => void;
}) {
	return (
		<fieldset className="flex flex-col gap-2">
			<legend className="text-sm font-medium">Choose a pickup location</legend>
			<div className="flex flex-col gap-2">
				{locations.map((loc) => {
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
								<span className="text-sm font-semibold leading-tight">
									{loc.label}
								</span>
								<span className="text-xs text-muted-foreground whitespace-pre-line">
									{loc.address}
								</span>
								{mapsUrl ? (
									<a
										href={mapsUrl}
										target="_blank"
										rel="noreferrer"
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
				})}
			</div>
		</fieldset>
	);
}
