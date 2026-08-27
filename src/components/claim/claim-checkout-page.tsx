import { convexQuery } from "@convex-dev/react-query";
import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Package, Truck } from "lucide-react";
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
	defaultFulfilmentTimeMinutes,
	formatFulfilmentTime,
	fulfilmentDateBounds,
	hhmmFromMinutes,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import type { ClaimPagePayload } from "../../../convex/orderClaims";
import {
	assertWithinOpeningHours,
	defaultTimeWithinHours,
	formatDayWindow,
	hoursForDate,
	isAllDay,
	isOpenOnDate,
	selectableTimeWindow,
	WEEKDAY_NAMES,
	weekdayIndexMyt,
} from "../../../convex/lib/openingHours";
import { usePublishedHeight } from "../../hooks/usePublishedHeight";
import { addDaysYmd, quickPickDays } from "../../lib/checkout-dates";
import {
	convexErrorMessage,
	formatMobile,
	formatPrice,
} from "../../lib/format";
import { displayAddressState } from "../../lib/address-display";
import { MASK_PII } from "../../lib/analytics-privacy";
import { claimFormSchemaFor } from "../../lib/schemas";
import { useLiveDeliveryQuote } from "../../lib/use-live-delivery-quote";
import { submitThenFocusError } from "../forms/focus-error";
import { useAppForm } from "../forms/form";
import { AddressFieldset } from "../storefront/address-fieldset";
import {
	PickupLocationRadioList,
	PickupSummaryCard,
	type PublicPickupLocation,
	pickupFeeOf,
} from "../storefront/pickup-location-options";
import { sanitizeAddress } from "../storefront/checkout-form";
import { Button } from "../ui/button";

/**
 * The buyer's claim-link checkout (86eyq0epn, docs/claim-links.md) — a
 * pre-filled, price-LOCKED order the seller keyed during a live: items are
 * read-only, the buyer adds only address, fulfilment date/time and a note,
 * then commits. Payment happens on the order page they land on next (the one
 * payment door — HitPay Pay-now or the manual sheet), so the CTA promises
 * exactly that. Locked design: timer treatment = the sticky status bar
 * (variant A), rendered by the route above this form.
 *
 * Structure mirrors the storefront CheckoutPage (numbered decision cards,
 * shared AddressFieldset / pickup picker / date-time machinery) minus
 * everything a frozen cart makes moot: quantity steppers, min-order rules,
 * stock caps (commit re-checks stock server-side), phone entry (the claim
 * froze the number the link was sent to), custom-line plumbing.
 */

const CLAIM_LINES_TICKET = "font-mono text-[13px] leading-6";

type OpenClaim = NonNullable<ClaimPagePayload["open"]>;

interface ClaimCheckoutPageProps {
	token: string;
	store: ClaimPagePayload["store"];
	open: OpenClaim;
	pickupLocations: ReadonlyArray<PublicPickupLocation>;
}

/** One numbered decision card — same skin as the storefront checkout's. */
function ClaimSection({
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

export function ClaimCheckoutPage({
	token,
	store,
	open,
	pickupLocations,
}: ClaimCheckoutPageProps) {
	const barRef = usePublishedHeight<HTMLDivElement>("--storefront-bar-h");
	const commitClaim = useMutation(api.orderClaims.commit);
	const navigate = useNavigate();
	const [serverError, setServerError] = useState<string | null>(null);
	const [pickupError, setPickupError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const {
		retailerId,
		storeName,
		country,
		collectsFromCustomer,
		minNoticeDays,
		openingHours,
	} = store;

	const { minYmd, maxYmd, todayYmd } = useMemo(() => {
		const bounds = fulfilmentDateBounds(minNoticeDays);
		return {
			minYmd: ymdFromEpoch(bounds.min),
			maxYmd: ymdFromEpoch(bounds.max),
			todayYmd: ymdFromEpoch(fulfilmentDateBounds(0).min),
		};
	}, [minNoticeDays]);

	const selfCollectAvailable =
		store.offerSelfCollect && pickupLocations.length > 0;
	const deliveryAvailable = store.offerDelivery;
	const bothAvailable = deliveryAvailable && selfCollectAvailable;
	const neitherAvailable = !deliveryAvailable && !selfCollectAvailable;
	const defaultMethod: "delivery" | "self_collect" = deliveryAvailable
		? "delivery"
		: "self_collect";

	const isDaySelectable = useCallback(
		(ymd: string, method: "delivery" | "self_collect") => {
			const epoch = mytMidnightFromYmd(ymd);
			if (Number.isNaN(epoch)) return false;
			if (method === "delivery") {
				return selectableTimeWindow(openingHours, epoch) !== null;
			}
			return isOpenOnDate(openingHours, epoch);
		},
		[openingHours],
	);
	const defaultYmd = useMemo(() => {
		for (let ymd = minYmd; ymd <= maxYmd; ymd = addDaysYmd(ymd, 1)) {
			if (isDaySelectable(ymd, defaultMethod)) return ymd;
		}
		return minYmd;
	}, [minYmd, maxYmd, defaultMethod, isDaySelectable]);

	const sortedPickups = [...pickupLocations].sort(
		(a, b) => a.sortOrder - b.sortOrder,
	);
	const singlePickup =
		sortedPickups.length === 1 ? sortedPickups[0] : undefined;

	const form = useAppForm({
		defaultValues: {
			// Prefilled from the claim (the seller keyed it); still editable.
			name: open.buyerName ?? "",
			deliveryMethod: defaultMethod,
			// Deliberately NOT the saved-address prefill: this buyer may never
			// have used this device's storefront, and a wrong silent prefill on a
			// timed checkout is worse than an empty field.
			address: {
				line1: "",
				line2: "",
				city: "",
				state: "",
				postcode: "",
				notes: "",
				mapsUrl: "",
				latitude: "",
				longitude: "",
				placeId: "",
			},
			pickupLocationId: "",
			fulfilmentDate: defaultYmd,
			fulfilmentTime: hhmmFromMinutes(
				defaultTimeWithinHours(openingHours, mytMidnightFromYmd(defaultYmd)) ??
					defaultFulfilmentTimeMinutes(mytMidnightFromYmd(defaultYmd)),
			),
			note: "",
		},
		validators: { onChange: claimFormSchemaFor(country) },
		onSubmit: async ({ value }) => {
			setServerError(null);
			setPickupError(null);
			const sanitizedAddress =
				value.deliveryMethod === "delivery"
					? sanitizeAddress(value.address, country)
					: undefined;

			let resolvedPickupLocationId: Id<"pickupLocations"> | undefined;
			if (value.deliveryMethod === "self_collect" && selfCollectAvailable) {
				if (singlePickup) {
					resolvedPickupLocationId = singlePickup._id;
				} else {
					const chosen = sortedPickups.find(
						(p) => p._id === value.pickupLocationId,
					);
					if (!chosen) {
						setPickupError("Please choose a pickup point to continue.");
						return;
					}
					resolvedPickupLocationId = chosen._id;
				}
			}

			const fulfilmentEpoch = mytMidnightFromYmd(value.fulfilmentDate);
			if (Number.isNaN(fulfilmentEpoch)) {
				setServerError("That date isn't valid — pick a day from the picker.");
				return;
			}
			try {
				assertValidFulfilmentDate(fulfilmentEpoch, minNoticeDays);
				assertWithinOpeningHours(openingHours, fulfilmentEpoch, undefined);
			} catch (err) {
				setServerError((err as Error).message);
				return;
			}

			let fulfilmentTimeMinutes: number | undefined;
			if (value.deliveryMethod === "delivery") {
				const parsed = timeMinutesFromHhmm(value.fulfilmentTime);
				if (Number.isNaN(parsed)) {
					setServerError(
						collectsFromCustomer
							? "Pick a collection time."
							: "Pick a delivery time.",
					);
					return;
				}
				const verb = collectsFromCustomer ? "collect" : "deliver";
				const window = selectableTimeWindow(openingHours, fulfilmentEpoch);
				if (!window) {
					const day = hoursForDate(openingHours, fulfilmentEpoch);
					setServerError(
						day && !isAllDay(day)
							? `${storeName} has closed for today — pick another day.`
							: `There's no time left to ${verb} today — pick tomorrow.`,
					);
					return;
				}
				if (parsed < window.min) {
					setServerError(
						`The earliest we can ${verb} is ${formatFulfilmentTime(window.min)} — pick that or later.`,
					);
					return;
				}
				if (parsed > window.max) {
					setServerError(
						`${storeName} closes at ${formatFulfilmentTime(window.max)} that day — pick an earlier time.`,
					);
					return;
				}
				fulfilmentTimeMinutes = parsed;
			}

			const trimmedNote = value.note?.trim();
			setSubmitting(true);
			try {
				const { trackingToken, confirmedAtCreate } = await commitClaim({
					token,
					buyerName: value.name.trim(),
					deliveryMethod: value.deliveryMethod,
					deliveryAddress: sanitizedAddress,
					pickupLocationId: resolvedPickupLocationId,
					fulfilmentDate: fulfilmentEpoch,
					fulfilmentTimeMinutes,
					customerNote:
						trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined,
					deliveryQuoteId:
						value.deliveryMethod === "delivery" && liveQuote.state === "quoted"
							? liveQuote.quoteId
							: undefined,
				});
				// Same handoff as the storefront checkout: the order page is where
				// payment happens (push path: no wa.me redirect; legacy: ?send=1).
				navigate({
					to: "/track/$token",
					params: { token: trackingToken },
					search: confirmedAtCreate ? {} : { send: 1 },
				});
			} catch (err) {
				setSubmitting(false);
				setServerError(convexErrorMessage(err));
			}
		},
	});

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

	// --- Delivery fee preview (same collapse as the storefront checkout) -----
	const watchedMethod = useStore(form.store, (s) => s.values.deliveryMethod);
	const quickDays = useMemo(
		() =>
			quickPickDays(minYmd, maxYmd, todayYmd, 3, (ymd) =>
				isDaySelectable(ymd, watchedMethod),
			),
		[minYmd, maxYmd, todayYmd, watchedMethod, isDaySelectable],
	);
	const watchedLat = useStore(form.store, (s) => s.values.address.latitude);
	const watchedLng = useStore(form.store, (s) => s.values.address.longitude);
	const watchedState = useStore(form.store, (s) => s.values.address.state);
	const watchedDate = useStore(form.store, (s) => s.values.fulfilmentDate);
	const watchedTime = useStore(form.store, (s) => s.values.fulfilmentTime);
	const watchedTimeMinutes = (() => {
		const t = timeMinutesFromHhmm(watchedTime);
		return Number.isNaN(t) ? undefined : t;
	})();

	// Same stale-slot repair as the storefront checkout (86eyp5rav): a date
	// change or the moving lead floor pulls an impossible time to that day's
	// default; a deliberately chosen valid time is never touched.
	// biome-ignore lint/correctness/useExhaustiveDependencies: form identity is stable; values read fresh inside.
	useEffect(() => {
		if (!watchedDate) return;
		const dayEpoch = mytMidnightFromYmd(watchedDate);
		if (Number.isNaN(dayEpoch)) return;
		const repair = () => {
			const current = timeMinutesFromHhmm(
				form.store.state.values.fulfilmentTime,
			);
			const window = selectableTimeWindow(openingHours, dayEpoch);
			if (window === null) return;
			if (
				Number.isNaN(current) ||
				current < window.min ||
				current > window.max
			) {
				const next = defaultTimeWithinHours(openingHours, dayEpoch);
				if (next !== null) {
					form.setFieldValue("fulfilmentTime", hhmmFromMinutes(next));
				}
			}
		};
		repair();
		const timer = setInterval(repair, 30_000);
		document.addEventListener("visibilitychange", repair);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", repair);
		};
	}, [watchedDate, openingHours]);

	const dateHoursIssue = useMemo(() => {
		if (!openingHours || !watchedDate) return null;
		const epoch = mytMidnightFromYmd(watchedDate);
		if (Number.isNaN(epoch)) return null;
		if (!isOpenOnDate(openingHours, epoch)) {
			return `${storeName} is closed on ${WEEKDAY_NAMES[weekdayIndexMyt(epoch)]}s — pick another day.`;
		}
		if (watchedMethod === "delivery") {
			const day = hoursForDate(openingHours, epoch);
			if (
				day &&
				!isAllDay(day) &&
				selectableTimeWindow(openingHours, epoch) === null
			) {
				return `${storeName} has closed for today — pick another day.`;
			}
		}
		return null;
	}, [openingHours, watchedDate, watchedMethod, storeName]);

	const latNum = watchedLat.trim().length > 0 ? Number(watchedLat) : NaN;
	const lngNum = watchedLng.trim().length > 0 ? Number(watchedLng) : NaN;
	const hasCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
	const deliveryQuote: PublicDeliveryQuote | undefined = useQuery(
		convexQuery(
			api.delivery.quote,
			deliveryAvailable && watchedMethod === "delivery"
				? {
						retailerId,
						latitude: hasCoords ? latNum : undefined,
						longitude: hasCoords ? lngNum : undefined,
						state:
							watchedState.trim().length > 0 ? watchedState.trim() : undefined,
						items: open.lines.map((line) => ({
							variantId: line.variantId,
							quantity: line.quantity,
						})),
						subtotal: open.itemsTotal,
					}
				: "skip",
		),
	).data;
	const rawQuote = watchedMethod === "delivery" ? deliveryQuote : undefined;
	const isLiveMode = rawQuote?.kind === "live";
	const liveQuote = useLiveDeliveryQuote({
		enabled: isLiveMode,
		retailerId,
		latitude: hasCoords ? latNum : undefined,
		longitude: hasCoords ? lngNum : undefined,
		getAddressLabel: () => {
			const a = form.store.state.values.address;
			return [
				a.line1,
				a.line2,
				`${a.postcode} ${a.city}`.trim(),
				displayAddressState(a),
			]
				.filter((part) => part && part.trim().length > 0)
				.join(", ");
		},
		fulfilmentDate: watchedDate ? mytMidnightFromYmd(watchedDate) : undefined,
		fulfilmentTimeMinutes: watchedTimeMinutes,
	});

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
			case "out_of_range":
				return { kind: "blocked", reason: "out_of_range" };
			case "store_unavailable":
				return { kind: "blocked", reason: "store_unavailable" };
			case "unavailable":
				return { kind: "blocked", reason: "unquotable" };
			default:
				return { kind: "calculating" };
		}
	})();
	const deliveryBlocked =
		quoteForDelivery?.kind === "blocked" ||
		quoteForDelivery?.kind === "calculating";
	const pinRequiredBlock =
		quoteForDelivery?.kind === "blocked" &&
		(quoteForDelivery.reason === "no_coords" ||
			quoteForDelivery.reason === "unquotable" ||
			quoteForDelivery.reason === "out_of_range" ||
			quoteForDelivery.reason === "store_unavailable");
	const allowManualAddressEntry =
		rawQuote !== undefined && !(!hasCoords && pinRequiredBlock);

	const watchedLine1 = useStore(form.store, (s) => s.values.address.line1);
	const addressIncomplete =
		watchedMethod === "delivery" && watchedLine1.trim().length === 0;
	const watchedPickupId = useStore(
		form.store,
		(s) => s.values.pickupLocationId,
	);

	// --- Money ---------------------------------------------------------------
	const selectedPickup =
		watchedMethod === "self_collect"
			? (singlePickup ?? sortedPickups.find((p) => p._id === watchedPickupId))
			: undefined;
	const pickupFee = selectedPickup ? pickupFeeOf(selectedPickup) : 0;
	const deliveryFee =
		watchedMethod === "delivery" && quoteForDelivery?.kind === "fee"
			? quoteForDelivery.fee
			: 0;
	const feeSettled =
		watchedMethod === "self_collect" ||
		quoteForDelivery === undefined ||
		quoteForDelivery.kind === "fee" ||
		quoteForDelivery.kind === "free";
	const displayTotal = open.itemsTotal + pickupFee + deliveryFee;

	const feeNounShort = collectsFromCustomer ? "collection fee" : "delivery fee";
	const deliveryBlockedLine = (() => {
		if (quoteForDelivery?.kind !== "blocked") return null;
		switch (quoteForDelivery.reason) {
			case "no_state":
				return `Choose your state so we can calculate your ${feeNounShort}`;
			case "over_bands":
				return "This order is too heavy for the store's delivery rates — message the store to arrange it";
			case "missing_weights":
			case "custom_item":
				return `Your ${feeNounShort} can't be worked out automatically — the store confirms it after you order`;
			default:
				return collectsFromCustomer
					? "We can't collect from this address — try another address"
					: "We can't deliver to this address — try another address";
		}
	})();

	const blockedReason: string | null = neitherAvailable
		? "This store isn't accepting orders right now"
		: addressIncomplete
			? collectsFromCustomer
				? "Add your collection address to continue"
				: "Add your delivery address to continue"
			: quoteForDelivery?.kind === "calculating"
				? collectsFromCustomer
					? "Calculating your collection fee…"
					: "Calculating your delivery fee…"
				: (deliveryBlockedLine ?? null);

	// The "arrange later" pending-fee states keep the CTA live — the server
	// commits fee-pending exactly like the storefront does; only hard blocks
	// and mid-calculation hold it.
	const ctaDisabled =
		submitting ||
		neitherAvailable ||
		addressIncomplete ||
		(watchedMethod === "delivery" && deliveryBlocked);

	// --- The read-only ticket ------------------------------------------------
	const ticket = (
		<section
			aria-label="Order summary"
			className="rounded-t-xl bg-card px-4 pb-3 pt-4 shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-border/40"
		>
			<div className="pb-3 text-center">
				<h2 className="font-heading text-base font-extrabold uppercase tracking-[0.06em]">
					{storeName}
				</h2>
				<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
					Order ticket · To complete
				</p>
			</div>
			<div className="border-t-2 border-dashed border-border" aria-hidden />
			<ul className="py-2">
				{open.lines.map((line, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: frozen list, never reordered.
						key={`${line.variantId}-${i}`}
						className={`flex items-baseline gap-2 py-1 ${CLAIM_LINES_TICKET}`}
					>
						<span className="min-w-0 truncate">
							{line.variantLabel
								? `${line.name} (${line.variantLabel})`
								: line.name}
							{line.quantity > 1 ? ` ×${line.quantity}` : ""}
						</span>
						<span
							aria-hidden
							className="flex-1 border-b-2 border-dotted border-border"
						/>
						<span className="shrink-0 tabular-nums">
							{((line.price * line.quantity) / 100).toFixed(2)}
						</span>
					</li>
				))}
				<li
					className={`flex items-baseline gap-2 py-1 text-muted-foreground ${CLAIM_LINES_TICKET}`}
				>
					<span className="min-w-0 truncate">
						{watchedMethod === "self_collect"
							? "Pickup"
							: collectsFromCustomer
								? "Collection"
								: "Delivery"}
					</span>
					<span
						aria-hidden
						className="flex-1 border-b-2 border-dotted border-border"
					/>
					<span className="shrink-0 tabular-nums">
						{watchedMethod === "self_collect"
							? pickupFee > 0
								? (pickupFee / 100).toFixed(2)
								: "free"
							: quoteForDelivery?.kind === "fee"
								? (quoteForDelivery.fee / 100).toFixed(2)
								: quoteForDelivery?.kind === "free"
									? "free"
									: quoteForDelivery?.kind === "calculating"
										? "calculating…"
										: quoteForDelivery?.kind === "pending"
											? "store confirms"
											: "after address"}
					</span>
				</li>
			</ul>
			<div className="flex items-baseline gap-2 border-t-2 border-dashed border-border pt-2.5">
				<p className="font-heading flex-1 text-sm font-extrabold uppercase tracking-[0.04em]">
					{feeSettled ? "Total" : "Items total"}
				</p>
				<p className="font-mono text-lg font-bold tabular-nums">
					{formatPrice(displayTotal, store.currency)}
				</p>
			</div>
			<p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
				Price set by {storeName} · items can't be changed
			</p>
		</section>
	);

	return (
		<form onSubmit={handleSubmit} noValidate>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
				{/* Desktop: sticky ticket right, sections left (storefront layout). */}
				<div className="lg:order-2 lg:w-96 lg:shrink-0">
					<div className="lg:sticky lg:top-16">{ticket}</div>
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-4 lg:order-1">
					<ClaimSection step={1} title="Your details">
						<form.AppField name="name">
							{(field) => (
								<field.TextField
									label="Your name"
									required
									autoComplete="name"
									description={`Appears on the order so ${storeName} knows who it's for.`}
								/>
							)}
						</form.AppField>
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium">WhatsApp number</p>
							<div
								{...MASK_PII}
								className="flex h-11 items-center rounded-xl border border-border bg-muted px-3.5 text-sm text-muted-foreground"
							>
								{formatMobile(open.waPhone)}
							</div>
							<p className="text-xs text-muted-foreground">
								This order link was sent to your WhatsApp — updates land in
								that same chat.
							</p>
						</div>
					</ClaimSection>

					<ClaimSection
						step={2}
						title={
							bothAvailable
								? "How do you want to get it?"
								: deliveryAvailable
									? collectsFromCustomer
										? "Collection address"
										: "Delivery address"
									: "Pickup point"
						}
					>
						{bothAvailable ? (
							<form.AppField name="deliveryMethod">
								{(field) => {
									const segment = (active: boolean) =>
										`flex flex-col items-center gap-1.5 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
											active
												? "bg-background text-accent-emphasis shadow-sm"
												: "text-muted-foreground hover:text-foreground"
										}`;
									return (
										<div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
											<button
												type="button"
												aria-pressed={field.state.value === "delivery"}
												onClick={() => field.handleChange("delivery")}
												className={segment(field.state.value === "delivery")}
											>
												<Truck className="size-5" aria-hidden />
												{collectsFromCustomer ? "Collection" : "Delivery"}
											</button>
											<button
												type="button"
												aria-pressed={field.state.value === "self_collect"}
												onClick={() => field.handleChange("self_collect")}
												className={segment(
													field.state.value === "self_collect",
												)}
											>
												<Package className="size-5" aria-hidden />
												Pickup
											</button>
										</div>
									);
								}}
							</form.AppField>
						) : null}

						{neitherAvailable ? (
							<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
								This store isn&apos;t accepting orders right now. Please
								message the store owner.
							</p>
						) : (
							<form.Subscribe selector={(s) => s.values.deliveryMethod}>
								{(deliveryMethod) =>
									deliveryMethod === "delivery" ? (
										<div className="flex flex-col gap-2">
											{collectsFromCustomer ? (
												<p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
													{storeName} collects from you — a rider picks your
													items up at this address and brings them to the
													store.
												</p>
											) : null}
											<AddressFieldset
												form={form}
												fields="address"
												retailerId={retailerId}
												country={country}
												allowManualEntry={allowManualAddressEntry}
												legend={
													bothAvailable
														? collectsFromCustomer
															? "Collection address"
															: "Delivery address"
														: undefined
												}
												collectsFromCustomer={collectsFromCustomer}
											/>
											{isLiveMode ? (
												<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
													{collectsFromCustomer
														? "Collection is by rider, so the fee depends on your address — you'll see it here once you pick a suggestion"
														: "Delivery is by rider, so the fee depends on your address — you'll see it here once you pick a suggestion"}
													{selfCollectAvailable ? " — pick up instead" : ""}.
												</p>
											) : null}
										</div>
									) : selfCollectAvailable ? (
										singlePickup ? (
											<PickupSummaryCard
												location={singlePickup}
												currency={store.currency}
											/>
										) : (
											<form.AppField name="pickupLocationId">
												{(field) => (
													<PickupLocationRadioList
														locations={sortedPickups}
														currency={store.currency}
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
					</ClaimSection>

					<ClaimSection
						step={3}
						title={
							watchedMethod === "self_collect"
								? "When will you collect?"
								: collectsFromCustomer
									? "When should we collect it?"
									: "When do you need it delivered?"
						}
					>
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
						<div
							className={
								watchedMethod === "delivery"
									? "grid grid-cols-2 gap-3"
									: undefined
							}
						>
							<form.AppField name="fulfilmentDate">
								{(field) => (
									<field.DateField
										label="Date"
										min={minYmd}
										max={maxYmd}
										required
										description={
											minNoticeDays > 0
												? `${storeName} needs ${minNoticeDays} day${minNoticeDays === 1 ? "" : "s"}' notice — that's the earliest date you can pick.`
												: "Pick the date you need this order."
										}
									/>
								)}
							</form.AppField>
							{watchedMethod === "delivery"
								? (() => {
										const dayEpoch = watchedDate
											? mytMidnightFromYmd(watchedDate)
											: Number.NaN;
										const window = Number.isNaN(dayEpoch)
											? null
											: selectableTimeWindow(openingHours, dayEpoch);
										const day = Number.isNaN(dayEpoch)
											? null
											: hoursForDate(openingHours, dayEpoch);
										const constrained = day !== null && !isAllDay(day);
										return (
											<form.AppField name="fulfilmentTime">
												{(field) => (
													<field.TimeField
														label="Time"
														required
														min={
															window ? hhmmFromMinutes(window.min) : undefined
														}
														max={
															constrained && window
																? hhmmFromMinutes(window.max)
																: undefined
														}
														description={
															(collectsFromCustomer
																? "When the rider should come to you."
																: "When you'd like it to arrive.") +
															(constrained && day
																? ` ${storeName} is open ${formatDayWindow(day)} that day.`
																: "")
														}
													/>
												)}
											</form.AppField>
										);
									})()
								: null}
						</div>
						{dateHoursIssue ? (
							<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
								{dateHoursIssue}
							</p>
						) : null}
					</ClaimSection>

					<ClaimSection title="Anything else?">
						<form.AppField name="note">
							{(field) => (
								<field.TextareaField
									label="Note to the store"
									rows={2}
									maxLength={500}
									description="Optional — anything the store should know."
								/>
							)}
						</form.AppField>
					</ClaimSection>

					{serverError ? (
						<p
							role="alert"
							className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
						>
							{serverError}
						</p>
					) : null}

					{/* Desktop CTA under the sections (mobile uses the fixed bar). */}
					<div className="hidden flex-col gap-2 lg:flex">
						{blockedReason ? (
							<p className="text-center text-xs font-medium text-destructive">
								{blockedReason}
							</p>
						) : null}
						<Button
							type="submit"
							disabled={ctaDisabled}
							className="h-12 w-full text-base"
						>
							{submitting
								? "Confirming…"
								: feeSettled
									? `Confirm order · ${formatPrice(displayTotal, store.currency)}`
									: `Confirm order · ${formatPrice(displayTotal, store.currency)} + ${feeNounShort}`}
						</Button>
						<p className="text-center text-xs text-muted-foreground">
							Nothing is charged yet — you pay on your order page next, online
							or by bank transfer. Your price hold continues there until
							payment.
						</p>
					</div>
				</div>
			</div>

			{/* Fixed mobile CTA bar — same pattern (and CSS variable) as every
			    other storefront bottom bar, so the page padding clears it. */}
			<div
				ref={barRef}
				className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
			>
				<div className="mx-auto flex max-w-md flex-col gap-1.5">
					{blockedReason ? (
						<p className="text-center text-xs font-medium text-destructive">
							{blockedReason}
						</p>
					) : null}
					<Button
						type="submit"
						disabled={ctaDisabled}
						className="h-12 w-full text-base"
					>
						{submitting
							? "Confirming…"
							: feeSettled
								? `Confirm order · ${formatPrice(displayTotal, store.currency)}`
								: `Confirm order · ${formatPrice(displayTotal, store.currency)} + ${feeNounShort}`}
					</Button>
					<p className="text-center text-[11px] text-muted-foreground">
						Nothing is charged yet — you pay next; the hold continues until
						payment.
					</p>
				</div>
			</div>
		</form>
	);
}
