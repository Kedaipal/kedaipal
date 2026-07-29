import { useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Clock, Package, ShoppingBag, Truck } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicDeliveryQuote } from "../../../convex/delivery";
import {
	assertValidFulfilmentDate,
	fulfilmentDateBounds,
	mytMidnightFromYmd,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	collectMinQuantityShortfalls,
	minOrderValueShortfall,
} from "../../../convex/lib/minOrderRules";
import type { UseCart } from "../../hooks/useCart";
import { quickPickDays } from "../../lib/checkout-dates";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { composeCustomerNote } from "../../lib/order-note";
import {
	type CheckoutAddressValues,
	checkoutFormSchema,
	emptyAddress,
} from "../../lib/schemas";
import { useLiveDeliveryQuote } from "../../lib/use-live-delivery-quote";
import { submitThenFocusError } from "../forms/focus-error";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";
import { AddressFieldset } from "./address-fieldset";
import { CheckoutSummary, CheckoutTotals } from "./checkout-summary";
import {
	PickupLocationRadioList,
	PickupSummaryCard,
	type PublicPickupLocation,
	pickupFeeOf,
} from "./pickup-location-options";

const ADDRESS_STORAGE_KEY = "kedaipal:lastAddress";

interface CheckoutPageProps {
	cart: UseCart;
	retailerId: Id<"retailers">;
	storeName: string;
	storeSlug: string;
	checkoutPhone: string | undefined;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
	minFulfilmentNoticeDays: number | undefined;
	/** Store-wide minimum order value (minor units) — checkout blocks below it.
	 * See convex/lib/minOrderRules.ts. */
	minOrderValue: number | undefined;
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

// The buyer→seller WhatsApp handoff message is NOT built here. The checkout
// submit navigates to the tracking page, which rebuilds it from the order's
// frozen snapshot — see src/lib/wa-order-message.ts for why (popup blockers
// kill window.open after the awaited createOrder round-trip).

/**
 * The storefront checkout PAGE (86eybrhrt PR1) — replaces the old bottom-sheet
 * checkout. Mobile: summary on top, numbered section cards, sticky bottom CTA.
 * Desktop (`lg:`): two columns — sections left, sticky receipt summary right.
 * Same schema, same `orders.create` submit, same tracking-page wa.me handoff
 * as the sheet it replaces.
 */
export function CheckoutPage({
	cart,
	retailerId,
	storeName,
	storeSlug,
	checkoutPhone,
	offerSelfCollect,
	offerDelivery,
	minFulfilmentNoticeDays,
	minOrderValue,
	pickupLocations,
}: CheckoutPageProps) {
	const createOrder = useMutation(api.orders.create);
	const navigate = useNavigate();
	// Success path clears the cart, which would flash the empty-cart state for
	// the frame before navigation lands on the tracking page — this flag keeps
	// the layout up instead.
	const [submitted, setSubmitted] = useState(false);

	const goToStore = useCallback(
		() => navigate({ to: "/$slug", params: { slug: storeSlug } }),
		[navigate, storeSlug],
	);

	// Live public catalog — caps the summary's quantity steppers at real stock
	// for hard-block variants. A cart line whose product left the public list
	// (hidden/archived since add) gets no cap; orders.create stays the judge.
	const listedProducts = useQuery(api.products.list, { retailerId });
	const stockByVariant = useMemo(() => {
		const map = new Map<string, { onHand: number; hardBlock: boolean }>();
		for (const product of listedProducts ?? []) {
			for (const variant of product.variants) {
				map.set(variant._id, {
					onHand: variant.onHand ?? 0,
					hardBlock: variant.blockWhenOutOfStock === true,
				});
			}
		}
		return map;
	}, [listedProducts]);
	const stockCapFor = useCallback(
		(variantId: string) => {
			const stock = stockByVariant.get(variantId);
			if (!stock || !stock.hardBlock) return undefined;
			return Math.max(stock.onHand, 0);
		},
		[stockByVariant],
	);

	// Minimum order rules (86ey9unyx) — same shared module the server enforces
	// with, so this pre-submit mirror can't disagree with orders.create. Cart
	// items snapshot each product's minQuantity at add time.
	const minRuleItems = cart.items.map((i) => ({
		productId: i.productId,
		name: i.name,
		quantity: i.quantity,
		minQuantity: i.minQuantity,
		isCustom: i.isCustom,
		quoteOnRequest: i.quoteOnRequest,
	}));
	const qtyShortfalls = collectMinQuantityShortfalls(minRuleItems);
	const valueShortfall = minOrderValueShortfall(
		minOrderValue,
		cart.total,
		minRuleItems,
	);
	const minRulesBlocked = qtyShortfalls.length > 0 || valueShortfall > 0;

	const [serverError, setServerError] = useState<string | null>(null);
	// Submit-time "choose a pickup point" error — inline on the radio list (the
	// shared focus helper lands on it), not a generic bottom banner. Cleared as
	// soon as the buyer picks one.
	const [pickupError, setPickupError] = useState<string | null>(null);

	// Selectable date range for the picker: today + the retailer's notice (the
	// earliest day) through today + 30. Memoised on the retailer setting so the
	// "today" anchor is computed once per mount, not on every keystroke. The
	// server re-validates against the live window — see convex/lib/fulfilmentDate.
	// Effective notice = the store-level setting raised by the strictest cart
	// item's per-product override (a custom cake needs lead time; ready stock
	// doesn't). Server enforces the same max at create.
	const cartNoticeDays = cart.items.reduce(
		(max, item) => Math.max(max, item.minNoticeDays ?? 0),
		0,
	);
	// A custom / price-on-quote line means the date is a REQUEST, not a promise
	// — the mockup conversation settles the real date. Copy adapts below.
	const hasCustomLine = cart.items.some(
		(item) => item.isCustom === true || item.quoteOnRequest === true,
	);
	const { minYmd, maxYmd, todayYmd } = useMemo(() => {
		const bounds = fulfilmentDateBounds(
			Math.max(minFulfilmentNoticeDays ?? 0, cartNoticeDays),
		);
		return {
			minYmd: ymdFromEpoch(bounds.min),
			maxYmd: ymdFromEpoch(bounds.max),
			// Today with no notice applied — lets the chips say "Today"/"Tomorrow"
			// only when those days are genuinely selectable.
			todayYmd: ymdFromEpoch(fulfilmentDateBounds(0).min),
		};
	}, [minFulfilmentNoticeDays, cartNoticeDays]);
	// One-tap shortcuts for the first selectable days — most orders are "as
	// soon as possible", so the common case is a single tap instead of a native
	// date-picker round trip. The DateField below stays the source of truth.
	const quickDays = useMemo(
		() => quickPickDays(minYmd, maxYmd, todayYmd),
		[minYmd, maxYmd, todayYmd],
	);

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
			// "YYYY-MM-DD" the buyer wants delivery/pickup. Defaults to the
			// EARLIEST allowed day (today, or today + the store's notice window)
			// — most orders are for "as soon as possible", so the common case is
			// zero taps while pre-order buyers just pick a later date. Server
			// re-validates the live window either way.
			fulfilmentDate: minYmd,
			// Optional free-text instruction for the seller (local form state — the
			// note is order-level, not a cart item, so it doesn't belong in useCart).
			note: "",
		},
		validators: { onChange: checkoutFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			setPickupError(null);
			if (cart.items.length === 0) return;
			// Minimum order rules — the submit button is already disabled with the
			// reason on screen; this guard covers a race (e.g. Enter key mid-render).
			if (minRulesBlocked) return;
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
			if (value.deliveryMethod === "self_collect" && selfCollectAvailable) {
				if (singlePickup) {
					resolvedPickupLocationId = singlePickup._id;
				} else {
					const chosen = sortedPickups.find(
						(p) => p._id === value.pickupLocationId,
					);
					if (!chosen) {
						// Inline on the picker itself (marks the radios aria-invalid), so
						// the focus helper scrolls the buyer straight to the choice.
						setPickupError("Please choose a pickup point to continue.");
						return;
					}
					resolvedPickupLocationId = chosen._id;
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
				const { trackingToken } = await createOrder({
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
					// Live Lalamove quote (86eyb5hrf): pass the server-side quote row
					// so the fee the buyer saw freezes onto the order. Missing/stale →
					// the server refuses the order (strict: no quote, no order — the
					// submit gate above should never let that happen).
					deliveryQuoteId:
						value.deliveryMethod === "delivery" && liveQuote.state === "quoted"
							? liveQuote.quoteId
							: undefined,
				});
				if (value.deliveryMethod === "delivery") saveAddress(value.address);
				setSubmitted(true);
				cart.clearCart();
				form.reset();
				// Same-tab navigation to the tracking page, NOT window.open(wa.me):
				// after the awaited createOrder round-trip we're outside the submit
				// tap's transient user activation, so popup blockers (iOS Safari,
				// IG/FB in-app webviews) silently swallow a new tab — order created,
				// buyer stranded. The tracking page shows the "Send order on
				// WhatsApp" anchor instead; ?send=1 makes it auto-fire the wa.me
				// redirect (same-tab, never popup-blocked) so the buyer still lands
				// in WhatsApp without an extra tap. See docs/order-lifecycle.md.
				navigate({
					to: "/track/$token",
					params: { token: trackingToken },
					search: { send: 1 },
				});
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	// The form's default date is captured at mount (often before the cart has
	// its strictest item, and long-lived tabs cross midnight) — pull a stale
	// value up to the current floor whenever it slips below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: form identity is stable; value read fresh inside.
	useEffect(() => {
		const current = form.store.state.values.fulfilmentDate;
		if (current && current < minYmd) {
			form.setFieldValue("fulfilmentDate", minYmd);
		}
	}, [minYmd]);

	function handleSubmit(e: FormEvent) {
		submitThenFocusError(form, e);
	}

	// --- Live delivery-charge preview (86extzdr8) ---------------------------
	// Watch the method + the coordinates the Google autocomplete stamped into
	// form state (three primitive selectors so keystrokes elsewhere don't
	// re-render the page), and quote the fee server-side. The server strips
	// distances (privacy) and orders.create re-resolves authoritatively — this
	// is display + gating only.
	const watchedMethod = useStore(form.store, (s) => s.values.deliveryMethod);
	const watchedLat = useStore(form.store, (s) => s.values.address.latitude);
	const watchedLng = useStore(form.store, (s) => s.values.address.longitude);
	// The chosen day PRICES the live quote (pre-orders quote as a scheduled
	// pickup on that day) — date changes re-quote just like address changes.
	const watchedDate = useStore(form.store, (s) => s.values.fulfilmentDate);
	const latNum = watchedLat.trim().length > 0 ? Number(watchedLat) : NaN;
	const lngNum = watchedLng.trim().length > 0 ? Number(watchedLng) : NaN;
	const hasCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
	const deliveryQuote: PublicDeliveryQuote | undefined = useQuery(
		api.delivery.quote,
		deliveryAvailable && watchedMethod === "delivery"
			? {
					retailerId,
					latitude: hasCoords ? latNum : undefined,
					longitude: hasCoords ? lngNum : undefined,
					subtotal: cart.total,
				}
			: "skip",
	);
	const rawQuote = watchedMethod === "delivery" ? deliveryQuote : undefined;

	// --- Live Lalamove quote (86eyb5hrf) ------------------------------------
	// When the store prices delivery by live provider quote, the reactive query
	// answers {kind:"live"} and the real fee comes from the shared
	// useLiveDeliveryQuote hook (quoteForCheckout action, once per picked pin).
	const isLiveMode = rawQuote?.kind === "live";
	const liveQuote = useLiveDeliveryQuote({
		enabled: isLiveMode,
		retailerId,
		latitude: hasCoords ? latNum : undefined,
		longitude: hasCoords ? lngNum : undefined,
		getAddressLabel: () => {
			const a = form.store.state.values.address;
			return [a.line1, a.line2, `${a.postcode} ${a.city}`.trim(), a.state]
				.filter((part) => part && part.trim().length > 0)
				.join(", ");
		},
		fulfilmentDate: watchedDate ? mytMidnightFromYmd(watchedDate) : undefined,
	});

	// Collapse the two sources into ONE shape for the breakdown + submit gate.
	// Live mode maps onto the static kinds (plus "calculating") so the render
	// below stays a single code path. No pin / no quote is a HARD stop (strict
	// since 27 Jul): a Lalamove buyer always sees the real rider price before
	// sending — exactly what orders.create enforces server-side.
	const quoteForDelivery:
		| PublicDeliveryQuote
		| { kind: "calculating" }
		| undefined = (() => {
		if (!rawQuote) return undefined;
		if (rawQuote.kind !== "live") return rawQuote;
		if (!hasCoords) return { kind: "blocked", reason: "no_coords" };
		switch (liveQuote.state) {
			case "quoted":
				return liveQuote.fee === 0
					? { kind: "free" }
					: { kind: "fee", fee: liveQuote.fee };
			// The courier doesn't cover this destination — same shape the radius
			// mode uses for "too far", so the copy tells them to change address
			// instead of the retry line that can never work.
			case "out_of_range":
				return { kind: "blocked", reason: "out_of_range" };
			// Seller-side breakage (revoked keys) — retrying is pointless too,
			// but the fix is the STORE's, so the copy points there.
			case "store_unavailable":
				return { kind: "blocked", reason: "store_unavailable" };
			case "unavailable":
				return { kind: "blocked", reason: "unquotable" };
			default:
				return { kind: "calculating" };
		}
	})();
	// A hard block only once the buyer has actually entered an address — while
	// the form is still empty the note under the breakdown does the guiding.
	// "calculating" also holds submit so a tap can't race the quote.
	const deliveryBlocked =
		quoteForDelivery?.kind === "blocked" ||
		quoteForDelivery?.kind === "calculating";

	// ------------------------------------------------------------------ render

	if (cart.items.length === 0) {
		if (submitted) {
			// createOrder just succeeded and navigation to /track is in flight.
			return (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-12 text-center">
					<p className="text-sm font-medium">Order sent!</p>
					<p className="text-sm text-muted-foreground">
						Taking you to your order…
					</p>
				</div>
			);
		}
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
				<span className="flex size-12 items-center justify-center rounded-full bg-muted">
					<ShoppingBag className="size-5 text-muted-foreground" aria-hidden />
				</span>
				<p className="text-sm font-medium">Your cart is empty</p>
				<p className="max-w-[36ch] text-sm text-muted-foreground">
					Add something from {storeName} first — your cart is saved on this
					device.
				</p>
				<Button type="button" onClick={goToStore} className="tap-target mt-1">
					Browse {storeName}
				</Button>
			</div>
		);
	}

	const submitButton = (
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
						neitherAvailable ||
						// Out-of-area / coord-less address on a "block" store —
						// the breakdown explains why (server enforces it too).
						deliveryBlocked ||
						// Below a minimum order rule — the alert above the total
						// lists exactly what's missing (server enforces it too).
						minRulesBlocked
					}
					className="h-12 w-full text-base"
				>
					{isSubmitting ? "Sending…" : "Send order on WhatsApp"}
				</Button>
			)}
		</form.Subscribe>
	);
	// The handoff is a two-step by design (tracking page fires the wa.me link)
	// — say what happens next so the CTA never feels like a bait-and-switch.
	const reassurance = (
		<p className="text-center text-xs text-muted-foreground">
			Opens WhatsApp to confirm with {storeName} — nothing is paid yet.
		</p>
	);
	const privacyLine = (
		<p className="text-center text-xs text-muted-foreground">
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
	);

	const minRuleAlerts = minRulesBlocked ? (
		<div
			role="alert"
			className="mt-1 flex flex-col gap-1 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			{qtyShortfalls.map((s) => (
				<p key={s.productId}>
					Minimum {s.minQuantity} × {s.name} per order — you have {s.have}
				</p>
			))}
			{valueShortfall > 0 ? (
				<p>
					Minimum order {formatPrice(minOrderValue ?? 0, cart.currency)} — add{" "}
					{formatPrice(valueShortfall, cart.currency)} more to check out
				</p>
			) : null}
		</div>
	) : null;

	return (
		// Bottom clearance for the fixed mobile CTA bar is owned by the route
		// container (it also has to clear the storefront footer).
		<form onSubmit={handleSubmit}>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
				{/* Order summary — first thing on mobile (this page IS the review),
				    sticky right rail on desktop. */}
				<div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:order-2 lg:w-96 lg:shrink-0">
					<form.Subscribe
						selector={(s) => ({
							deliveryMethod: s.values.deliveryMethod,
							pickupLocationId: s.values.pickupLocationId,
						})}
					>
						{({ deliveryMethod, pickupLocationId }) => {
							// Selected point (single-location auto-resolves) → its fee
							// joins the total the buyer is about to send.
							const selectedPickup =
								deliveryMethod === "self_collect"
									? (singlePickup ??
										sortedPickups.find((p) => p._id === pickupLocationId))
									: undefined;
							const pickupFee = pickupFeeOf(selectedPickup);
							const quote =
								deliveryMethod === "delivery" ? quoteForDelivery : undefined;
							const blockedCopy =
								quote?.kind === "blocked"
									? quote.reason === "out_of_range"
										? // Live-quote stores: the COURIER doesn't reach here, and
											// retrying the same address never will — say so, and point
											// at the two things that actually work.
											isLiveMode
											? `This address is too far — our delivery rider service doesn't cover it. Try an address closer to ${storeName}${
													selfCollectAvailable ? ", or choose pickup" : ""
												}.`
											: `This address is outside ${storeName}'s delivery area.${
													selfCollectAvailable
														? " Pickup is still available."
														: ""
												}`
										: quote.reason === "store_unavailable"
											? // Seller-side breakage — not the buyer's fault, not
												// fixable by retrying. Give them the two real ways out.
												`Delivery pricing isn't working for this store right now — it's on ${storeName}'s side, not yours. ${
													selfCollectAvailable
														? "Choose pickup, or message"
														: "Message"
												} the store on WhatsApp to sort it out.`
											: quote.reason === "unquotable"
												? "We couldn't calculate the delivery fee right now — re-pick your address to retry, or try again shortly."
												: "Pick your address from the Google suggestions so we can calculate your delivery fee."
									: undefined;
							return (
								<CheckoutSummary
									cart={cart}
									onAddMore={goToStore}
									stockCapFor={stockCapFor}
									shortfalls={qtyShortfalls}
									totals={
										<CheckoutTotals
											subtotal={cart.total}
											currency={cart.currency}
											pickupFee={pickupFee}
											pickupFeeLabel={selectedPickup?.label}
											quote={quote}
											blockedCopy={blockedCopy}
											minRuleAlerts={minRuleAlerts}
										/>
									}
									footer={
										// Desktop CTA lives with the money it commits to; the
										// mobile CTA is the sticky bar below.
										<div className="mt-4 hidden flex-col gap-3 lg:flex">
											{submitButton}
											{reassurance}
											{privacyLine}
										</div>
									}
								/>
							);
						}}
					</form.Subscribe>
				</div>

				{/* Form sections — small numbered decisions instead of a field wall. */}
				<div className="flex min-w-0 flex-1 flex-col gap-4 lg:order-1">
					<CheckoutSection step={1} title="Who's ordering?">
						<form.AppField name="name">
							{(field) => (
								<field.TextField
									label="Your name"
									placeholder="e.g. Aisyah"
									autoComplete="name"
									required
									description={`Appears in your WhatsApp message so ${storeName} knows who this order is for.`}
								/>
							)}
						</form.AppField>
					</CheckoutSection>

					<CheckoutSection
						step={2}
						title={
							bothAvailable
								? "How do you want to get it?"
								: deliveryAvailable
									? "Delivery address"
									: "Pickup point"
						}
					>
						{/* Method picker only when BOTH methods are offered. With a
						    single method there's nothing to choose, so we drop straight
						    to that method's form below (delivery → address, self-collect
						    → pickup picker). The settings invariant keeps ≥1 on offer. */}
						{bothAvailable ? (
							<form.AppField name="deliveryMethod">
								{(field) => (
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
								)}
							</form.AppField>
						) : null}

						{neitherAvailable ? (
							<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
								This store isn&apos;t accepting orders right now. Please check
								back soon or message the store owner.
							</p>
						) : (
							<form.Subscribe selector={(s) => s.values.deliveryMethod}>
								{(deliveryMethod) =>
									deliveryMethod === "delivery" ? (
										<div className="flex flex-col gap-2">
											<AddressFieldset
												form={form}
												fields="address"
												retailerId={retailerId}
											/>
											{/* Live-quote (rider) stores: set the expectation BEFORE
											    the buyer types a far-away address and hits a wall.
											    Deliberately vague about the range — the seller's
											    pickup point is owner-only data (never in the public
											    payload), and Lalamove's coverage is a city zone, not
											    a radius we could quote. */}
											{isLiveMode ? (
												<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
													Delivery is by rider, so the fee depends on your
													address — you&apos;ll see it here once you pick a
													suggestion. Addresses outside the rider&apos;s
													coverage can&apos;t be delivered
													{selfCollectAvailable ? " — pick up instead" : ""}.
												</p>
											) : null}
										</div>
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
														onChange={(id) => {
															field.handleChange(id);
															setPickupError(null);
														}}
														error={pickupError ?? undefined}
													/>
												)}
											</form.AppField>
										)
									) : null
								}
							</form.Subscribe>
						)}
					</CheckoutSection>

					{/* When do you need it — required for both delivery and pickup.
					    Sits after the where (address/pickup), before the optional note:
					    a required structured field outranks the free-text note. Hidden
					    only when the store can't take orders at all. */}
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
											sortedPickups.find((p) => p._id === pickupLocationId))
										: undefined;
								// Drop-off points are meetups, not the seller's place —
								// the date question reads "meet", matching the DROP-OFF
								// badge and the tracking page's "Meet at".
								const isDropOff = selectedPickup?.locationType === "drop_off";
								return (
									<CheckoutSection
										step={3}
										title={
											hasCustomLine
												? "Requested date"
												: deliveryMethod === "self_collect"
													? isDropOff
														? "When should we meet?"
														: "When will you collect?"
													: "When do you need it delivered?"
										}
									>
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
										{quickDays.length > 0 ? (
											<div className="flex flex-wrap gap-2">
												{quickDays.map((day) => {
													const active = watchedDate === day.ymd;
													return (
														<button
															key={day.ymd}
															type="button"
															onClick={() =>
																form.setFieldValue("fulfilmentDate", day.ymd)
															}
															aria-pressed={active}
															className={`tap-target rounded-full border-2 px-3.5 py-1.5 text-xs font-semibold transition-colors ${
																active
																	? "border-accent bg-accent/10 text-accent-emphasis"
																	: "border-border bg-card text-muted-foreground hover:border-accent/40"
															}`}
														>
															{day.label}
														</button>
													);
												})}
											</div>
										) : null}
										<form.AppField name="fulfilmentDate">
											{(field) => (
												<field.DateField
													label="Date"
													min={minYmd}
													max={maxYmd}
													required
													description={
														// Custom carts: the date is the buyer's ASK — the
														// seller settles the final date in the design
														// conversation. A notice floor raised by a cart
														// item is explained, never silent.
														hasCustomLine
															? `Your requested date — the seller confirms the final date with you after the design is agreed.${
																	cartNoticeDays > 0
																		? ` Items in your cart need at least ${cartNoticeDays} day${cartNoticeDays === 1 ? "" : "s"}' notice.`
																		: ""
																}`
															: cartNoticeDays > (minFulfilmentNoticeDays ?? 0)
																? `An item in your cart needs ${cartNoticeDays} day${cartNoticeDays === 1 ? "" : "s"}' notice — that's the earliest date you can pick.`
																: isDropOff
																	? "Pick the date you'll meet at the drop-off point."
																	: "Pick the date you need this order."
													}
												/>
											)}
										</form.AppField>
									</CheckoutSection>
								);
							}}
						</form.Subscribe>
					)}

					<CheckoutSection title="Anything else?">
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
					</CheckoutSection>

					{noCheckoutPhone ? (
						<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
							Order checkout is temporarily unavailable. Please try again
							shortly or contact the store owner.
						</p>
					) : null}

					{serverError ? (
						<p
							data-form-error
							role="alert"
							className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
						>
							{serverError}
						</p>
					) : null}
				</div>
			</div>

			{/* Mobile sticky CTA — total + send, always in thumb reach. Desktop
			    uses the summary card's own footer instead. */}
			<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-5 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
				<div className="mx-auto flex max-w-xl flex-col gap-2">
					<form.Subscribe
						selector={(s) => ({
							deliveryMethod: s.values.deliveryMethod,
							pickupLocationId: s.values.pickupLocationId,
						})}
					>
						{({ deliveryMethod, pickupLocationId }) => {
							const selectedPickup =
								deliveryMethod === "self_collect"
									? (singlePickup ??
										sortedPickups.find((p) => p._id === pickupLocationId))
									: undefined;
							const pickupFee = pickupFeeOf(selectedPickup);
							const quote =
								deliveryMethod === "delivery" ? quoteForDelivery : undefined;
							const deliveryFee = quote?.kind === "fee" ? quote.fee : 0;
							const blocked = minRulesBlocked || (quote && deliveryBlocked);
							return (
								<>
									{blocked ? (
										<p className="text-center text-[11px] font-medium text-destructive">
											{minRulesBlocked
												? "Below the store's minimum — see your order summary above"
												: quote?.kind === "calculating"
													? "Calculating your delivery fee…"
													: "Delivery can't be quoted — see your order summary above"}
										</p>
									) : null}
									<div className="flex items-center justify-between">
										<span className="text-sm text-muted-foreground">Total</span>
										<span className="text-lg font-bold tabular-nums">
											{formatPrice(
												cart.total + pickupFee + deliveryFee,
												cart.currency,
											)}
											{quote?.kind === "pending" ? (
												<span className="text-xs font-medium text-muted-foreground">
													{" "}
													+ delivery
												</span>
											) : null}
										</span>
									</div>
								</>
							);
						}}
					</form.Subscribe>
					{submitButton}
					{reassurance}
				</div>
			</div>
		</form>
	);
}

/** One numbered decision card — the antidote to the old unsectioned field
 *  wall. `step` is omitted for the optional note (it's not part of the
 *  sequence a buyer must complete). */
function CheckoutSection({
	step,
	title,
	children,
}: {
	step?: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<h2 className="flex items-center gap-2 font-heading text-sm font-bold">
				{step !== undefined ? (
					<span
						aria-hidden
						className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-extrabold text-accent-emphasis"
					>
						{step}
					</span>
				) : null}
				{title}
			</h2>
			{children}
		</section>
	);
}
