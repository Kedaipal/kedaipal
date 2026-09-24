import { convexQuery } from "@convex-dev/react-query";
import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Package, Truck } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicDeliveryQuote } from "../../../convex/delivery";
import { closureOn } from "../../../convex/lib/closedDates";
import { toDomesticContactPhone } from "../../../convex/lib/courierContact";
import {
	assertValidFulfilmentDate,
	defaultFulfilmentTimeMinutes,
	fulfilmentDateBounds,
	hhmmFromMinutes,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	defaultTimeWithinHours,
	hoursForDate,
	isAllDay,
	selectableTimeWindow,
} from "../../../convex/lib/openingHours";
import { distinctPickupNotes } from "../../../convex/lib/pickupNote";
import { slowestPrep } from "../../../convex/lib/prepFloor";
import type { ClaimPagePayload } from "../../../convex/orderClaims";
import { usePublishedHeight } from "../../hooks/usePublishedHeight";
import { displayAddressState } from "../../lib/address-display";
import { MASK_PII } from "../../lib/analytics-privacy";
import { addDaysYmd, quickPickDays } from "../../lib/checkout-dates";
import {
	asksForTime,
	type FulfilmentKind,
	fulfilmentDayCopy,
	fulfilmentKind,
	fulfilmentTimeCopy,
	isFulfilmentDaySelectable,
	prepForFulfilment,
	prepHint,
} from "../../lib/checkout-fulfilment";
import {
	convexErrorMessage,
	formatMobile,
	formatPrice,
} from "../../lib/format";
import {
	type CopyPart,
	fulfilmentInputsKey,
	planTimeRepair,
	type TimeMove,
	timeMovedCopy,
} from "../../lib/fulfilment-time-issue";
import { overseasCourierNote } from "../../lib/overseas-courier-note";
import { claimFormSchemaFor } from "../../lib/schemas";
import { useLiveDeliveryQuote } from "../../lib/use-live-delivery-quote";
import { submitThenFocusError } from "../forms/focus-error";
import { useAppForm } from "../forms/form";
import { CopyText, DayWindowsInline } from "../hours/hours-text";
import { PickupNotes } from "../order/pickup-notes";
import { AddressFieldset } from "../storefront/address-fieldset";
import { sanitizeAddress } from "../storefront/checkout-form";
import { CheckoutHint } from "../storefront/checkout-hint";
import {
	PickupLocationRadioList,
	PickupSummaryCard,
	type PublicPickupLocation,
	pickupFeeOf,
} from "../storefront/pickup-location-options";
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

/** What the time field asks, per fulfilment — the storefront checkout's words. */
const TIME_DESCRIPTION: Record<FulfilmentKind, string> = {
	delivery: "When you'd like it to arrive.",
	collection: "When the rider should come to you.",
	pickup: "When you'll collect it.",
};

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
	// A submit refusal about the chosen day or time, tied to the inputs it
	// judged — shown only while those stand, same as the storefront checkout
	// (z8r3fdff8r): fixing the time must clear "that time won't work".
	// Parts, not a flat string, wherever there are any: the banner must keep a
	// time range whole on a phone, like the inline notice above it.
	const [fulfilmentRefusal, setFulfilmentRefusal] = useState<{
		message: string | CopyPart[];
		inputs: string;
	} | null>(null);
	const [pickupError, setPickupError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const {
		retailerId,
		storeName,
		country,
		collectsFromCustomer,
		booksCouriers,
		minNoticeDays,
		openingHours,
		closedDates,
	} = store;

	// The claim's order rules, read live at load (z8r3fdff97): the slowest
	// line's prep window floors today's times, and the lines' pickup notes are
	// the "Before you collect" block — the same rules the storefront applies.
	const cartPrep = slowestPrep(open.lines);
	const claimPickupNotes = distinctPickupNotes(
		open.lines.map((line) => line.pickupNote),
	);
	// Read per render; the repair effect's `clockTick` re-renders on the 30s
	// beat and on tab return (a claim tab left open past midnight re-floors).
	const now = Date.now();
	const nowDayKey = ymdFromEpoch(now);
	// biome-ignore lint/correctness/useExhaustiveDependencies: recomputed per calendar day (nowDayKey), not per render.
	const { minYmd, maxYmd, todayYmd } = useMemo(() => {
		const bounds = fulfilmentDateBounds(minNoticeDays, now);
		return {
			minYmd: ymdFromEpoch(bounds.min),
			maxYmd: ymdFromEpoch(bounds.max),
			todayYmd: ymdFromEpoch(fulfilmentDateBounds(0, now).min),
		};
	}, [minNoticeDays, nowDayKey]);

	const selfCollectAvailable =
		store.offerSelfCollect && pickupLocations.length > 0;
	const deliveryAvailable = store.offerDelivery;
	const bothAvailable = deliveryAvailable && selfCollectAvailable;
	const neitherAvailable = !deliveryAvailable && !selfCollectAvailable;
	const defaultMethod: "delivery" | "self_collect" = deliveryAvailable
		? "delivery"
		: "self_collect";

	const sortedPickups = [...pickupLocations].sort(
		(a, b) => a.sortOrder - b.sortOrder,
	);
	const singlePickup =
		sortedPickups.length === 1 ? sortedPickups[0] : undefined;

	// How the "when" step behaves for a method + pickup point — the
	// storefront checkout's rule (z8r3fdff97): delivery always asks for a
	// time; a pickup asks when the store keeps hours or the claim needs prep;
	// a drop-off meet-up never does.
	const scheduleFor = (
		method: "delivery" | "self_collect",
		pickupLocationId: string,
	) => {
		const kind: FulfilmentKind = fulfilmentKind(method, collectsFromCustomer);
		const point =
			method === "self_collect"
				? (singlePickup ??
					sortedPickups.find((p) => p._id === pickupLocationId))
				: undefined;
		const isDropOff = point?.locationType === "drop_off";
		const prep = prepForFulfilment(cartPrep, kind);
		return {
			kind,
			point,
			isDropOff,
			prep,
			timed: asksForTime({
				kind,
				isDropOff,
				openingHours,
				prepMinutes: prep.minutes,
			}),
		};
	};
	type Schedule = ReturnType<typeof scheduleFor>;
	const isDaySelectable = (ymd: string, schedule: Schedule) => {
		const epoch = mytMidnightFromYmd(ymd);
		if (Number.isNaN(epoch)) return false;
		return isFulfilmentDaySelectable({
			hours: openingHours,
			closedDates,
			dateEpoch: epoch,
			now,
			prep: schedule.prep,
			timed: schedule.timed,
		});
	};
	const firstSelectableYmd = (schedule: Schedule) => {
		for (let ymd = minYmd; ymd <= maxYmd; ymd = addDaysYmd(ymd, 1)) {
			if (isDaySelectable(ymd, schedule)) return ymd;
		}
		return minYmd;
	};
	const defaultSchedule = scheduleFor(defaultMethod, "");
	const defaultYmd = firstSelectableYmd(defaultSchedule);

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
				defaultTimeWithinHours(
					openingHours,
					mytMidnightFromYmd(defaultYmd),
					now,
					defaultSchedule.prep.minutes,
				) ??
					defaultFulfilmentTimeMinutes(
						mytMidnightFromYmd(defaultYmd),
						now,
						defaultSchedule.prep.minutes,
					),
			),
			note: "",
		},
		validators: { onChange: claimFormSchemaFor(country) },
		onSubmit: async ({ value }) => {
			setServerError(null);
			setFulfilmentRefusal(null);
			setPickupError(null);
			const refuseFulfilment = (message: string | CopyPart[]) =>
				setFulfilmentRefusal({ message, inputs: fulfilmentInputsKey(value) });
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
				refuseFulfilment("That date isn't valid — pick a day from the picker.");
				return;
			}
			try {
				assertValidFulfilmentDate(fulfilmentEpoch, minNoticeDays);
			} catch (err) {
				refuseFulfilment((err as Error).message);
				return;
			}

			// Same shared ladder as the storefront checkout (z8r3fdff8r), with the
			// claim's prep floor threaded in and a pickup time whenever it asks
			// for one (z8r3fdff97): one set of rules, one set of words, and the
			// inline notice showed them first.
			const schedule = scheduleFor(
				value.deliveryMethod,
				value.pickupLocationId,
			);
			const judged = {
				hours: openingHours,
				closedDates,
				dateEpoch: fulfilmentEpoch,
				now: Date.now(),
				prep: schedule.prep,
				kind: schedule.kind,
				storeName,
			};
			const dayCopy = fulfilmentDayCopy({ ...judged, timed: schedule.timed });
			if (dayCopy) {
				refuseFulfilment(dayCopy);
				return;
			}
			let fulfilmentTimeMinutes: number | undefined;
			if (schedule.timed) {
				const parsed = timeMinutesFromHhmm(value.fulfilmentTime);
				const timeCopy = fulfilmentTimeCopy({
					...judged,
					timeMinutes: Number.isNaN(parsed) ? undefined : parsed,
				});
				if (timeCopy) {
					// Parts, never flattened: T1 keeps the CTA line's copy whole on a
					// phone, and a prep refusal carries a time too.
					refuseFulfilment(timeCopy);
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

	// A date below the floor (midnight, a raised notice) moves to the first day
	// that can actually be fulfilled; a date the buyer picked above it never
	// moves — if the clock rules it out, the inline notice says so.
	const watchedMethod = useStore(form.store, (s) => s.values.deliveryMethod);
	const watchedPickupId = useStore(
		form.store,
		(s) => s.values.pickupLocationId,
	);
	const watchedSchedule = scheduleFor(watchedMethod, watchedPickupId);
	const floorYmd = firstSelectableYmd(watchedSchedule);
	// biome-ignore lint/correctness/useExhaustiveDependencies: form identity is stable; value read fresh inside.
	useEffect(() => {
		const current = form.store.state.values.fulfilmentDate;
		if (!current || current < minYmd) {
			form.setFieldValue("fulfilmentDate", floorYmd);
		}
	}, [minYmd, floorYmd]);

	// The storefront checkout's overseas-number note (z8r3fdh274). Here the
	// number is KNOWN — the claim froze the WhatsApp it was sent to — so the
	// test is the courier's own: can a courier in the store's country phone it?
	const overseasNote = overseasCourierNote({
		booksCouriers,
		deliveryMethod: watchedMethod,
		localNumber: toDomesticContactPhone(open.waPhone, country) !== null,
		collectsFromCustomer,
		storeCountry: country,
		storeName,
		locale: store.locale,
	});

	function handleSubmit(e: FormEvent) {
		submitThenFocusError(form, e);
	}

	// --- Delivery fee preview (same collapse as the storefront checkout) -----
	const quickDays = quickPickDays(minYmd, maxYmd, todayYmd, 3, (ymd) =>
		isDaySelectable(ymd, watchedSchedule),
	);
	const watchedLat = useStore(form.store, (s) => s.values.address.latitude);
	const watchedLng = useStore(form.store, (s) => s.values.address.longitude);
	const watchedState = useStore(form.store, (s) => s.values.address.state);
	const watchedDate = useStore(form.store, (s) => s.values.fulfilmentDate);
	const watchedTime = useStore(form.store, (s) => s.values.fulfilmentTime);
	const watchedInputs = useStore(form.store, (s) =>
		fulfilmentInputsKey(s.values),
	);
	// The banner after a refused press: a day/time refusal only while the
	// buyer's choice is still the one refused, otherwise a server error.
	const refusal =
		fulfilmentRefusal?.inputs === watchedInputs
			? fulfilmentRefusal.message
			: serverError;
	const watchedTimeMinutes = (() => {
		const t = timeMinutesFromHhmm(watchedTime);
		return Number.isNaN(t) ? undefined : t;
	})();

	// Same ownership-aware repair as the storefront checkout (z8r3fdff8r).
	// A system-set time that goes stale moves FORWARD and says so; a
	// buyer-typed time is never rewritten, and the inline notice explains.
	const systemTimeRef = useRef(form.state.values.fulfilmentTime);
	const [timeMove, setTimeMove] = useState<TimeMove | null>(null);
	const [clockTick, setClockTick] = useState(0);
	// The claim's prep floors the repair too (z8r3fdff97), and a time is only
	// repaired while this fulfilment asks for one; the clock ticks either way.
	const repairPrep = watchedSchedule.prep.minutes;
	const repairTimed = watchedSchedule.timed;
	// Named in the move note when prep is why a prefilled time moved.
	const repairPrepName = watchedSchedule.prep.productName;
	// biome-ignore lint/correctness/useExhaustiveDependencies: form identity is stable; values read fresh inside.
	useEffect(() => {
		setTimeMove(null);
		const dayEpoch = watchedDate ? mytMidnightFromYmd(watchedDate) : Number.NaN;
		const repair = () => {
			setClockTick((t) => t + 1);
			if (!repairTimed || Number.isNaN(dayEpoch)) return;
			const plan = planTimeRepair({
				hours: openingHours,
				dayEpoch,
				currentHhmm: form.store.state.values.fulfilmentTime,
				systemHhmm: systemTimeRef.current,
				prepMinutes: repairPrep,
				prepItemName: repairPrepName,
			});
			if (!plan) return;
			systemTimeRef.current = plan.nextHhmm;
			form.setFieldValue("fulfilmentTime", plan.nextHhmm);
			if (plan.moved) setTimeMove(plan.moved);
		};
		repair();
		const timer = setInterval(repair, 30_000);
		document.addEventListener("visibilitychange", repair);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", repair);
		};
	}, [watchedDate, openingHours, repairTimed, repairPrep, repairPrepName]);

	// The day, then the time, in the submit refusal's exact words, the moment
	// the field holds it — the storefront's helpers, prep threaded in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: clockTick is the deliberate re-read of the wall clock.
	const dateHoursIssue = useMemo(() => {
		if (!watchedDate) return null;
		const dateEpoch = mytMidnightFromYmd(watchedDate);
		if (Number.isNaN(dateEpoch)) return null;
		return fulfilmentDayCopy({
			hours: openingHours,
			closedDates,
			dateEpoch,
			now: Date.now(),
			prep: watchedSchedule.prep,
			timed: watchedSchedule.timed,
			kind: watchedSchedule.kind,
			storeName,
		});
	}, [
		openingHours,
		closedDates,
		watchedDate,
		watchedSchedule.prep,
		watchedSchedule.timed,
		watchedSchedule.kind,
		storeName,
		clockTick,
	]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: clockTick is the deliberate re-read of the wall clock.
	const timeHoursIssue = useMemo(() => {
		if (!watchedDate || !watchedSchedule.timed) return null;
		if (watchedTimeMinutes === undefined) return null;
		const dateEpoch = mytMidnightFromYmd(watchedDate);
		if (Number.isNaN(dateEpoch)) return null;
		return fulfilmentTimeCopy({
			hours: openingHours,
			closedDates,
			dateEpoch,
			now: Date.now(),
			prep: watchedSchedule.prep,
			kind: watchedSchedule.kind,
			storeName,
			timeMinutes: watchedTimeMinutes,
		});
	}, [
		openingHours,
		closedDates,
		watchedDate,
		watchedSchedule.prep,
		watchedSchedule.timed,
		watchedSchedule.kind,
		watchedTimeMinutes,
		storeName,
		clockTick,
	]);
	const claimPrepHint = prepHint({
		hours: openingHours,
		closedDates,
		now,
		prep: watchedSchedule.prep,
		kind: watchedSchedule.kind,
		noticeDays: minNoticeDays,
		timed: watchedSchedule.timed,
	});
	const timeMoveNote =
		timeMove && watchedTime === hhmmFromMinutes(timeMove.to)
			? timeMovedCopy(timeMove, { storeName })
			: null;

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
		providerAware: rawQuote?.kind === "live" && rawQuote.providerAware,
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
		getAddressParts: () => {
			const a = form.store.state.values.address;
			return {
				city: a.city?.trim() || undefined,
				state: displayAddressState(a) || undefined,
				postcode: a.postcode?.trim() || undefined,
			};
		},
		// The claim's lines — without them Delyva has no weight to bid with,
		// and a claim link would price differently from the storefront for the
		// same cart (PR #253 review, HIGH).
		items: open.lines.map((line) => ({
			variantId: line.variantId,
			quantity: line.quantity,
		})),
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
			case "no_cold_service":
				return { kind: "blocked", reason: "no_cold_service" };
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
			quoteForDelivery.reason === "store_unavailable" ||
			quoteForDelivery.reason === "no_cold_service");
	const allowManualAddressEntry =
		rawQuote !== undefined && !(!hasCoords && pinRequiredBlock);

	const watchedLine1 = useStore(form.store, (s) => s.values.address.line1);
	const addressIncomplete =
		watchedMethod === "delivery" && watchedLine1.trim().length === 0;

	// --- Money ---------------------------------------------------------------
	const selectedPickup = watchedSchedule.point;
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
								This order link was sent to your WhatsApp — updates land in that
								same chat.
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
								This store isn&apos;t accepting orders right now. Please message
								the store owner.
							</p>
						) : (
							<form.Subscribe selector={(s) => s.values.deliveryMethod}>
								{(deliveryMethod) =>
									deliveryMethod === "delivery" ? (
										<div className="flex flex-col gap-2">
											{collectsFromCustomer ? (
												<p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
													{storeName} collects from you — a rider picks your
													items up at this address and brings them to the store.
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
											{overseasNote ? (
												<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
													{overseasNote}
												</p>
											) : null}
										</div>
									) : selfCollectAvailable ? (
										<div className="flex flex-col gap-2">
											{singlePickup ? (
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
											)}
											{/* The seller's collection instructions (z8r3fdff97) —
											    the storefront checkout's block, before commit. */}
											<PickupNotes
												audience="buyer"
												locale={store.locale}
												notes={claimPickupNotes}
											/>
										</div>
									) : null
								}
							</form.Subscribe>
						)}
					</ClaimSection>

					<ClaimSection
						step={3}
						title={
							watchedMethod === "self_collect"
								? watchedSchedule.isDropOff
									? "When should we meet?"
									: "When will you collect?"
								: collectsFromCustomer
									? "When should we collect it?"
									: "When do you need it delivered?"
						}
					>
						{/* The pickup point's recurring schedule, at the date step —
						    the storefront checkout has always shown it; the claim page
						    now does too (z8r3fdff97). */}
						{watchedSchedule.point?.scheduleNote ? (
							<CheckoutHint>
								<span className="font-medium">
									{watchedSchedule.point.label}
								</span>{" "}
								is available{" "}
								<span className="font-medium">
									{watchedSchedule.point.scheduleNote}
								</span>{" "}
								—{" "}
								{watchedSchedule.timed
									? "pick a matching date and time."
									: "pick a matching date."}
							</CheckoutHint>
						) : null}
						{claimPrepHint ? (
							<CheckoutHint>
								<CopyText parts={claimPrepHint} />
							</CheckoutHint>
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
						<div
							className={
								watchedSchedule.timed ? "grid grid-cols-2 gap-3" : undefined
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
											// The store's hours ride on the TIME field, never
											// the date (pickup asks for a time whenever the
											// store keeps hours).
											minNoticeDays > 0
												? `${storeName} needs ${minNoticeDays} day${minNoticeDays === 1 ? "" : "s"}' notice — that's the earliest date you can pick.`
												: "Pick the date you need this order."
										}
									/>
								)}
							</form.AppField>
							{watchedSchedule.timed
								? (() => {
										const dayEpoch = watchedDate
											? mytMidnightFromYmd(watchedDate)
											: Number.NaN;
										const window = Number.isNaN(dayEpoch)
											? null
											: selectableTimeWindow(
													openingHours,
													dayEpoch,
													now,
													watchedSchedule.prep.minutes,
												);
										// A closed date (z8r3fdhpm7) reads like a weekly
										// day off: no window, the date notice says why.
										const day =
											Number.isNaN(dayEpoch) || closureOn(closedDates, dayEpoch)
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
															<>
																{TIME_DESCRIPTION[watchedSchedule.kind]}
																{/* Both windows of a split day, each kept
																    whole on a narrow phone (z8r3fdff8r). */}
																{constrained && day ? (
																	<>
																		{" "}
																		{storeName} is open{" "}
																		<DayWindowsInline day={day} /> that day.
																	</>
																) : null}
															</>
														}
													/>
												)}
											</form.AppField>
										);
									})()
								: null}
						</div>
						{/* One slot, one message: day, then time, then the
						    "we moved your time" note. */}
						{/* `data-form-error`: a refused press scrolls here, to the
						    field being refused. */}
						{dateHoursIssue ? (
							<p
								data-form-error
								className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
							>
								<CopyText parts={dateHoursIssue} />
							</p>
						) : timeHoursIssue ? (
							<p
								data-form-error
								className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
							>
								<CopyText parts={timeHoursIssue} />
							</p>
						) : timeMoveNote ? (
							<p
								className="rounded-lg bg-accent/10 px-3 py-2 text-xs font-medium text-accent-emphasis"
								aria-live="polite"
							>
								<CopyText parts={timeMoveNote} />
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

					{refusal ? (
						<p
							role="alert"
							className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
						>
							{typeof refusal === "string" ? (
								refusal
							) : (
								<CopyText parts={refusal} />
							)}
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
