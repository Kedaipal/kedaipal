import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	Bike,
	Car,
	CircleAlert,
	ExternalLink,
	FlaskConical,
	Loader2,
	Phone,
	RefreshCw,
	Truck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	formatFulfilmentDateTime,
	hhmmFromMinutes,
	MAX_NOTICE_DAYS,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import { MASK_PII } from "../../lib/analytics-privacy";
import { dispatchBlockCopy } from "../../lib/dispatch-block";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/** How long "Confirm & dispatch" stays inert after it appears (86eypjfuf).
 * Long enough that a tap already in flight — the one that opened the dialog,
 * or a scroll-flick on the page behind it — can't land on a money action;
 * short enough that a seller reading the price never meets it. */
const SPEND_ARM_DELAY_MS = 600;

/** A live quotation the confirm dialog is holding. Mirrors `prepareBooking`'s
 * success payload, except `expiresAt` is resolved to a definite moment here —
 * see applyQuote. */
type QuoteState = {
	quotationId: string;
	senderStopId: string;
	recipientStopId: string;
	fee: number;
	buyerPaidFee: number;
	vehicleType: string;
	buyerContactFallback: boolean;
	/** The pickup moment this quote is scheduled for — undefined = the rider
	 * comes now (86eyg0n8e follow-up). */
	scheduledFor?: number;
	/** The buyer's own fulfilment moment, untouched by any override
	 * (86eyp5qd1) — drives the promise-mismatch warning below. */
	buyerRequestedMoment?: number;
	/** Resolved, always-present expiry (86eypncfy): Lalamove's own `expiresAt`
	 * when it gave one, else our own 5-minute clock from the moment the quote
	 * landed. Never optional here — a quote whose death we can't name is
	 * exactly the one that traps the seller. */
	expiresAt: number;
};

/**
 * Lalamove dispatch card on order detail (86eyb5hrf) — the seller's one-tap
 * "Book delivery": re-quote → confirm (price + variance vs what the buyer
 * paid) → rider booked; the webhook then drives shipped/delivered
 * automatically. Also the home of the live job (driver, plate, tracking
 * link), the failed-booking amber state with one-tap rebook, and every
 * disabled-with-reason state (no dead ends).
 *
 * Renders only on delivery orders. For sellers who never set up Lalamove it
 * collapses to a one-line discoverability hint on bookable orders.
 */
export function BookDeliveryCard({
	order,
	bookRequestToken = 0,
	advanceWithoutRider,
	onAdvanceBookUnavailable,
}: {
	order: Doc<"orders">;
	/** Increment to request the booking flow from OUTSIDE the card — the
	 * order stepper raises it when the seller advances a bookable Lalamove
	 * order by hand, so they land in THIS modal (live price, vehicle switch,
	 * variance) instead of an intermediate prompt. Same guarded entry as the
	 * packed prompt (bookable status, keys ok, no active job), so it can
	 * never book more than the card itself would allow. */
	bookRequestToken?: number;
	/** Offered inside the booking modal only when the seller got here by
	 * advancing the order themselves: they may be delivering this one without
	 * a rider, and dismissing the modal would otherwise leave the order stuck
	 * with no way forward. Label carries their stage vocabulary. */
	advanceWithoutRider?: { label: string; onConfirm: () => void };
	/** The quote failed on that same manual-advance path (out of service area,
	 * provider down). The seller asked to move the order and got a toast — the
	 * page owes them the other route out, so it reopens its own prompt. */
	onAdvanceBookUnavailable?: () => void;
}) {
	const dispatch = useQuery(
		convexQuery(api.lalamove.getDeliveryJob, { shortId: order.shortId }),
	).data;
	const prepareBooking = useAction(api.lalamove.prepareBooking);
	const confirmBooking = useAction(api.lalamove.confirmBooking);
	const cancelBooking = useAction(api.lalamove.cancelBooking);
	// AC2 of the rebook fix (86eyp63xn): booking at a seller-picked moment can
	// also move the ORDER's promise in the same action — see syncOrderTime.
	const rescheduleFulfilment = useMutation(api.orders.rescheduleFulfilment);

	const [preparing, setPreparing] = useState(false);
	const [quote, setQuote] = useState<QuoteState | null>(null);
	const [booking, setBooking] = useState(false);
	// In-dialog vehicle switch → fresh quote (prices are per-vehicle). Keeps
	// the dialog open with the price row loading instead of bouncing the
	// seller back to settings to change vehicle for one order.
	const [requoting, setRequoting] = useState(false);
	// Seller's pickup-time override (86eyp5qd1): null = the buyer's moment
	// (the default), a number = "come at this exact moment", "now" = dispatch
	// immediately. Quotes are bound to their scheduleAt, so a change re-quotes.
	const [scheduleOverride, setScheduleOverride] = useState<
		number | "now" | null
	>(null);
	const [editSchedule, setEditSchedule] = useState(false);
	const [schedDate, setSchedDate] = useState("");
	const [schedTime, setSchedTime] = useState("");
	// Inline validation for the editor (86eyp63xn follow-up): the native
	// input's min can be bypassed by typing/stepping, so past picks are
	// refused here with a visible reason, never a silent book-now.
	const [scheduleError, setScheduleError] = useState<string | null>(null);
	// "Also update the delivery time the buyer sees": booking at a picked
	// moment first reschedules the ORDER to it (86eyp63xn AC2), so the trip
	// and the buyer's promise move together. Defaulted at prepare time —
	// ON when the order's own moment is stale (past, or a failed booking
	// exists: the rebook path, where the old time is wrong by definition),
	// OFF when the buyer's moment is still ahead (a rider leaving earlier
	// than the promise is legitimate and must not rewrite it silently).
	const [syncOrderTime, setSyncOrderTime] = useState(false);
	// Did this quote flow start from the seller trying to ADVANCE the order
	// (vs. tapping the card's own book button / the packed prompt)? Only then
	// does dismissing leave them stuck, so only then does the modal offer the
	// no-rider way out.
	const [fromAdvance, setFromAdvance] = useState(false);
	// Bumped when the seller closes the modal mid-quote, so the in-flight
	// result knows it's orphaned.
	const prepareGenRef = useRef(0);
	const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	// A failed confirm used to be a toast and nothing else, while the dialog
	// stayed open holding the dead quote — so the seller's obvious next move
	// (press the same button again) re-sent an expired quotationId forever, and
	// the copy pointed at a Book button hidden behind the overlay. Wagyu Walid
	// did exactly this five times in 5m23s before giving up (86eypncfy). The
	// reason now lives IN the dialog and swaps the primary action to a re-quote.
	const [bookingError, setBookingError] = useState<string | null>(null);
	// Ticks only while the dialog is open, so a quote can visibly lapse instead
	// of silently rotting behind a button that still looks armed.
	const [now, setNow] = useState<number>(() => Date.now());
	// Spend guard (86eypjfuf): "Confirm & dispatch" is the one control here that
	// moves real money out of the seller's Lalamove wallet, on a single tap with
	// no second step. It can also appear UNDER a finger — the dialog auto-opens
	// on the packed transition (promptBookOnPacked) and on a manual advance —
	// so the tap that opened it, or a scroll-flick on the page behind, can carry
	// straight through into a dispatch. Arming it a beat after it appears makes
	// that impossible while costing a deliberate seller nothing: they still have
	// to read the price.
	const [spendArmed, setSpendArmed] = useState(false);

	// Prompt-to-book-on-packed (opt-in): when the seller marks a PAID, due-today
	// delivery order Packed, auto-open the confirm dialog (today's price) so they
	// see the cost and tap to spend — never a silent booking. Fires only on a
	// live transition INTO packed observed by this mounted card; a page load of
	// an already-packed order never prompts (baseline the status first).
	const prevStatusRef = useRef<string | undefined>(undefined);
	// biome-ignore lint/correctness/useExhaustiveDependencies: handlePrepare is a stable hoisted closure; prompt keys off the status transition only.
	useEffect(() => {
		const prev = prevStatusRef.current;
		prevStatusRef.current = order.status;
		if (!dispatch || prev === undefined) return; // loading / mount baseline
		const justPacked = prev !== "packed" && order.status === "packed";
		if (!justPacked) return;
		if (!dispatch.promptBookOnPacked) return;
		if (order.paymentStatus !== "received") return; // only paid orders
		if (dispatch.blockReason !== null) return; // not bookable (keys/pin/plan/…)
		// COLLECTION orders never auto-prompt. The prompt means "you packed it,
		// now send it out" — but here the rider brings goods IN, so packing
		// happens AFTER they arrive: before collection it would offer a trip at
		// the wrong moment, and after it would dispatch a SECOND one (the order
		// sits at confirmed/packed forever, so it can't self-close the way a
		// standard order does by reaching `delivered`). The seller books from
		// the card's own "Send rider to collect".
		if (
			order.deliveryDirection === "collection" ||
			dispatch.job?.deliveryDirection === "collection"
		) {
			return; // see orderCollection below — this order's own nature
		}
		const hasActiveJob =
			!!dispatch.job &&
			!["completed", "canceled", "expired", "rejected"].includes(
				dispatch.job.status,
			);
		if (hasActiveJob) return;
		const futureDated =
			order.fulfilmentDate !== undefined &&
			order.fulfilmentDate > todayMytMidnight();
		if (futureDated) return; // book manually on the delivery day
		void handlePrepare();
	}, [order.status, order.paymentStatus, dispatch]);

	// Quote countdown — a 1s tick while the confirm dialog holds a quote, so
	// "locked for 5 minutes" is a live fact rather than a claim.
	useEffect(() => {
		if (quote === null) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [quote]);

	// Keyed on quote PRESENCE, not identity: the button arms once when it first
	// appears and stays armed across vehicle/time re-quotes, so switching
	// Motorcycle→Car doesn't keep re-disabling dispatch. Re-arms on a fresh
	// open because `quote` returns to null in between.
	const hasQuote = quote !== null;
	useEffect(() => {
		if (!hasQuote) {
			setSpendArmed(false);
			return;
		}
		const id = setTimeout(() => setSpendArmed(true), SPEND_ARM_DELAY_MS);
		return () => clearTimeout(id);
	}, [hasQuote]);

	// External book request — the stepper raises it when the seller advances a
	// bookable order by hand, so THIS modal answers "how is it going out?".
	// Token baseline on mount so a remount never re-fires a stale request; the
	// same bookability guards as above, minus the paid/due-today conditions —
	// this is an explicit seller tap, not an automatic prompt.
	const prevTokenRef = useRef(bookRequestToken);
	// biome-ignore lint/correctness/useExhaustiveDependencies: handlePrepare is a stable hoisted closure; the effect keys off the token only.
	useEffect(() => {
		const prev = prevTokenRef.current;
		prevTokenRef.current = bookRequestToken;
		if (bookRequestToken === prev) return;
		if (!dispatch || dispatch.blockReason !== null) return;
		// Same collection stop as the packed prompt. Unreachable today (a
		// collection order's advance never raises this token) — kept as defence
		// in depth so a future caller can't auto-dispatch a collection the
		// seller didn't ask for.
		if (
			order.deliveryDirection === "collection" ||
			dispatch.job?.deliveryDirection === "collection"
		) {
			return; // see orderCollection below — this order's own nature
		}
		const hasActiveJob =
			!!dispatch.job &&
			!["completed", "canceled", "expired", "rejected"].includes(
				dispatch.job.status,
			);
		if (hasActiveJob) return;
		if (order.status !== "confirmed" && order.status !== "packed") return;
		void handlePrepare({ fromAdvance: true });
	}, [bookRequestToken, dispatch, order.status]);

	if (order.deliveryMethod !== "delivery" || !dispatch) return null;
	const { job, blockReason, promptBookOnPacked } = dispatch;
	// TEST KEYS (86eypncfy). Not a warning we can afford to leave in Settings:
	// a sandbox booking looks identical to a real one right up until no rider
	// ever arrives, and the buyer has already been charged a fee the test
	// environment priced. So it is stated on the card AND inside the confirm
	// dialog — every surface where the seller is about to spend. Undefined env
	// (row not yet stamped) renders nothing rather than a false all-clear.
	const sandbox = dispatch.env === "sandbox";
	// Collection service (86eyg0n8e): the rider collects FROM the customer and
	// brings the goods here. TWO questions, two sources — they only diverge
	// after a seller switches modes (and will diverge routinely once direction
	// varies per order):
	//  · `collection` — what booking NOW would do (the store's live setting):
	//    drives the button, the confirm dialog and the prompt hint, so a label
	//    can never promise a different trip than the one dispatch books.
	//  · `jobCollection` — what THIS trip actually was (frozen on the job):
	//    drives every line that describes it, so a past delivery is never
	//    narrated as a collection.
	const collection = dispatch.deliveryDirection === "collection";
	const jobCollection = dispatch.job
		? dispatch.job.deliveryDirection === "collection"
		: collection;
	//  · `orderCollection` — what THIS ORDER is (frozen at create, and at
	//    booking if the seller switched modes in between). Everything that
	//    GATES or PROMISES behaviour for this order keys off it, so the card,
	//    the stepper and the server can't disagree about one order.
	const orderCollection =
		order.deliveryDirection === "collection" ||
		dispatch.job?.deliveryDirection === "collection";
	const activeJob =
		job &&
		!["completed", "canceled", "expired", "rejected"].includes(job.status)
			? job
			: null;
	const failedJob =
		job && ["canceled", "expired", "rejected"].includes(job.status)
			? job
			: null;
	const completedJob = job && job.status === "completed" ? job : null;
	const bookable = order.status === "confirmed" || order.status === "packed";
	// A completed COLLECTION trip is TERMINAL for this order: the goods are
	// already at the outlet, so "Send rider to collect" would dispatch a second
	// pointless trip to the buyer's address (and charge for it). Standard orders
	// close themselves — the webhook advances them to shipped/delivered, which
	// fails `bookable` — but a collection order deliberately never advances, so
	// the stop has to be explicit. A FAILED collection still offers Rebook (no
	// rider ever came); only success ends it.
	// "The goods are with the seller" — however they got here: a completed rider
	// trip, or the seller collecting in person (which stamps the same field).
	// Either way there is nothing left to fetch, so the book CTA must retire.
	const collectionDone =
		(jobCollection && completedJob !== null) ||
		(orderCollection && order.collectedAt !== undefined);
	// Auto-book never fires before the buyer's chosen date (pre-orders get
	// packed the night before) — the hint below says so instead of surprising.
	const isFutureDated =
		order.fulfilmentDate !== undefined &&
		order.fulfilmentDate > todayMytMidnight();

	// Seller never set Lalamove up: a quiet hint on bookable orders
	// (discoverability without shouting at non-Lalamove sellers), nothing
	// otherwise.
	if (!job && blockReason === "booking_disabled") {
		if (!bookable) return null;
		return (
			<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
				<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
				Book Lalamove riders in one tap from here — choose <b>Lalamove</b> as
				your delivery charge in{" "}
				<Link
					to="/app/settings"
					search={{ tab: "fulfilment" }}
					className="font-medium text-accent hover:underline"
				>
					Settings → Fulfilment
				</Link>
				.
			</p>
		);
	}
	if (!job && !bookable) return null;

	/** Lalamove honours a quotation for exactly 5 minutes; used as the fallback
	 * when the provider's own `expiresAt` is absent. */
	const QUOTE_TTL_MS = 5 * 60 * 1000;

	/** The single place an action result becomes quote state, so every path
	 * (first quote, vehicle switch, time change, re-quote after a failure)
	 * carries an expiry and none can reintroduce the deathless quote. */
	function applyQuote(
		result: Omit<QuoteState, "expiresAt"> & { expiresAt?: number },
	) {
		setQuote({
			...result,
			expiresAt: result.expiresAt ?? Date.now() + QUOTE_TTL_MS,
		});
		setBookingError(null);
	}

	/** Drop every schedule-editor state — a fresh open must start from the
	 * buyer's moment, never a leftover override from a dismissed dialog. */
	function resetScheduleState() {
		setScheduleOverride(null);
		setEditSchedule(false);
		setSchedDate("");
		setSchedTime("");
		setScheduleError(null);
		setSyncOrderTime(false);
	}

	async function handlePrepare(opts?: {
		fromAdvance?: boolean;
		/** Rebook path (86eyp63xn): the failed booking's schedule is stale by
		 * definition, so the time editor opens straight away instead of hiding
		 * behind "Change time". */
		autoEditSchedule?: boolean;
	}) {
		setFromAdvance(opts?.fromAdvance === true);
		resetScheduleState();
		setBookingError(null);
		setPreparing(true);
		const gen = prepareGenRef.current;
		try {
			const result = await prepareBooking({ shortId: order.shortId });
			if (gen !== prepareGenRef.current) return; // dismissed while quoting
			if (!result.ok) {
				toast.error(result.message ?? dispatchBlockCopy(result.reason));
				// No quote means no modal — and on the advance path that would
				// leave the seller's tap with nothing but a toast.
				if (opts?.fromAdvance) onAdvanceBookUnavailable?.();
				return;
			}
			applyQuote(result);
			// Default the order-sync choice from THIS quote's reality (the
			// docblock on syncOrderTime): stale promise or a failed booking →
			// moving the order with the trip is almost certainly the intent.
			const promiseStale =
				result.buyerRequestedMoment === undefined ||
				result.buyerRequestedMoment <= Date.now();
			setSyncOrderTime(failedJob !== null || promiseStale);
			if (opts?.autoEditSchedule) openScheduleEditor(result);
		} finally {
			setPreparing(false);
		}
	}

	// In-dialog re-quote — a vehicle switch or a pickup-time change (each
	// quotation is bound to both). On failure the previous quote (and its
	// schedule) stays. Returns whether the fresh quote landed.
	async function handleRequote(next: {
		vehicleType?: "MOTORCYCLE" | "CAR";
		scheduleOverride?: number | "now" | null;
	}): Promise<boolean> {
		if (!quote || requoting) return false;
		const vehicleType =
			next.vehicleType ??
			(quote.vehicleType === "CAR" ? "CAR" : "MOTORCYCLE");
		const override =
			next.scheduleOverride !== undefined
				? next.scheduleOverride
				: scheduleOverride;
		setRequoting(true);
		try {
			const result = await prepareBooking({
				shortId: order.shortId,
				vehicleType,
				scheduleAtOverride: override === null ? undefined : override,
			});
			if (!result.ok) {
				toast.error(result.message ?? dispatchBlockCopy(result.reason));
				return false;
			}
			setScheduleOverride(override);
			applyQuote(result);
			return true;
		} finally {
			setRequoting(false);
		}
	}

	function handleSwitchVehicle(vehicleType: "MOTORCYCLE" | "CAR") {
		if (!quote || quote.vehicleType === vehicleType || requoting) return;
		void handleRequote({ vehicleType });
	}

	/** Open the pickup-time editor prefilled with the moment the quote is
	 * currently scheduled for (falling back to the buyer's ask, then "in an
	 * hour" for orders with no time at all). `from` lets handlePrepare seed
	 * off a fresh result before React state has settled (the rebook path). */
	function openScheduleEditor(from?: {
		scheduledFor?: number;
		buyerRequestedMoment?: number;
	}) {
		const src = from ?? quote ?? undefined;
		let seed =
			src?.scheduledFor ??
			(src?.buyerRequestedMoment !== undefined &&
			src.buyerRequestedMoment > Date.now()
				? src.buyerRequestedMoment
				: Date.now() + 60 * 60 * 1000);
		// Never prefill a moment that has already passed (a stale scheduledFor
		// from an order whose day rolled over) — the editor would open onto a
		// value its own validation rejects.
		if (seed < Date.now()) seed = Date.now() + 60 * 60 * 1000;
		const day = todayMytMidnight(seed);
		setSchedDate(ymdFromEpoch(day));
		// Round to the input's 5-min step, clamped below midnight — a seed in
		// the day's last minutes must not round up to the invalid "24:00".
		setSchedTime(
			hhmmFromMinutes(
				Math.min(1435, Math.round((seed - day) / 60000 / 5) * 5),
			),
		);
		setScheduleError(null);
		setEditSchedule(true);
	}

	async function handleApplySchedule() {
		const day = mytMidnightFromYmd(schedDate);
		const minutes = timeMinutesFromHhmm(schedTime);
		if (Number.isNaN(day) || Number.isNaN(minutes)) {
			setScheduleError("Pick a valid date and time first.");
			return;
		}
		const moment = day + minutes * 60000;
		// The native input's `min` only greys the picker — typed, stepped or
		// seeded values below it still land here. A past moment would silently
		// degrade to an immediate booking (and offer the ORDER a past promise
		// via the sync checkbox), so it is refused with the honest way out.
		if (moment < Date.now()) {
			setScheduleError(
				"That time has already passed — pick a moment ahead, or use “Send the rider now” for an immediate pickup.",
			);
			return;
		}
		setScheduleError(null);
		if (await handleRequote({ scheduleOverride: moment })) {
			setEditSchedule(false);
		}
	}

	async function handleConfirm() {
		if (!quote) return;
		setBooking(true);
		try {
			// Order-sync BEFORE the booking (86eyp63xn AC2): once the booking
			// lands there is an ACTIVE job and rescheduleFulfilment refuses by
			// design — this is the one moment both can move together. A failed
			// sync aborts the dispatch: booking a trip whose promise update was
			// refused would recreate exactly the mismatch this fix exists for.
			if (
				typeof scheduleOverride === "number" &&
				syncOrderTime &&
				order.source !== "counter"
			) {
				const day = todayMytMidnight(scheduleOverride);
				try {
					await rescheduleFulfilment({
						orderId: order._id,
						fulfilmentDate: day,
						fulfilmentTimeMinutes: Math.round(
							(scheduleOverride - day) / 60000,
						),
					});
				} catch (err) {
					toast.error(convexErrorMessage(err));
					return;
				}
			}
			const result = await confirmBooking({
				shortId: order.shortId,
				quotationId: quote.quotationId,
				senderStopId: quote.senderStopId,
				recipientStopId: quote.recipientStopId,
				vehicleType: quote.vehicleType === "CAR" ? "CAR" : "MOTORCYCLE",
				scheduledFor: quote.scheduledFor,
			});
			if (!result.ok) {
				// Deliberately NOT a toast: the seller's next action is decided by
				// this message, and a toast is gone before they get back from the
				// Lalamove app. It also retires the quote as a bookable thing —
				// the primary action becomes "Get a fresh price" below.
				setBookingError(result.message ?? dispatchBlockCopy(result.reason));
				return;
			}
			setQuote(null);
			setBookingError(null);
			resetScheduleState();
			toast.success(
				"Rider booking placed — you'll see the driver here once one accepts.",
			);
		} finally {
			setBooking(false);
		}
	}

	async function handleCancelBooking() {
		setCancelling(true);
		try {
			const result = await cancelBooking({ shortId: order.shortId });
			if (result.ok) toast.success("Lalamove booking cancelled.");
			else toast.error(result.message ?? "Couldn't cancel the booking.");
		} finally {
			setCancelling(false);
		}
	}

	const variance = quote ? quote.fee - quote.buyerPaidFee : 0;
	// A quote past its window can't be dispatched, and neither can one whose
	// confirm already failed — both need a fresh price, not another press.
	const quoteStale = quote !== null && now >= quote.expiresAt;
	const needsFreshQuote = bookingError !== null || quoteStale;

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					{jobCollection ? "Lalamove Collection" : "Lalamove Delivery"}
				</p>
				{activeJob ? (
					<JobStatusPill status={activeJob.status} collection={jobCollection} />
				) : completedJob ? (
					<JobStatusPill status="completed" collection={jobCollection} />
				) : null}
			</div>

			{sandbox ? (
				<div className="flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
					<FlaskConical className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">Test mode — no real rider.</span> Your
						Lalamove keys are sandbox keys (they start with{" "}
						<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
							pk_test_
						</code>
						), so bookings are simulated and buyers are quoted test prices.
						Topping up your real wallet won&apos;t change that — paste your live
						keys in{" "}
						<Link
							to="/app/settings"
							search={{ tab: "fulfilment" }}
							className="font-medium underline underline-offset-2"
						>
							Settings → Fulfilment
						</Link>
						.
					</span>
				</div>
			) : null}

			{/* Failed booking — amber, with the one-tap rebook the ticket asks for. */}
			{failedJob && !activeJob ? (
				<div className="flex flex-col gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
					<p className="flex items-start gap-2">
						<CircleAlert className="mt-0.5 size-4 shrink-0" />
						<span>
							<span className="font-medium">
								Booking didn&apos;t go through
							</span>
							{failedJob.failureReason ? ` — ${failedJob.failureReason}` : ""}.
							Your buyer was not notified; the order is unchanged.
						</span>
					</p>
				</div>
			) : null}

			{activeJob ? (
				<div className="flex flex-col gap-2 text-sm">
					{activeJob.driver ? (
						<div className="flex items-center justify-between gap-3">
							{/* MASK_PII: the rider is a third party. */}
							<span {...MASK_PII} className="flex items-center gap-2">
								<Bike className="size-4 text-accent" />
								<span className="font-medium">{activeJob.driver.name}</span>
								{activeJob.driver.plateNumber ? (
									<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
										{activeJob.driver.plateNumber}
									</span>
								) : null}
							</span>
							{activeJob.driver.phone ? (
								<a
									href={`tel:${activeJob.driver.phone}`}
									className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-accent hover:bg-accent/10"
								>
									<Phone className="size-3.5" /> Call
								</a>
							) : null}
						</div>
					) : activeJob.scheduledAt !== undefined &&
						activeJob.scheduledAt > Date.now() ? (
						<p className="text-muted-foreground">
							Scheduled pickup —{" "}
							<span className="font-medium text-foreground">
								{formatScheduledMoment(activeJob.scheduledAt)}
							</span>
							. Lalamove assigns a rider closer to the time
							{jobCollection
								? "; they'll collect from your customer's address and bring it here."
								: "; the buyer gets the shipped message with live tracking at pickup."}
						</p>
					) : (
						<p className="text-muted-foreground">
							{jobCollection
								? "Finding a rider… this usually takes a few minutes. They'll collect from your customer's address and bring it here — you advance the order status yourself once it arrives."
								: "Finding a rider… this usually takes a few minutes. When one picks up, the order moves itself to Shipped and the live tracking link appears on the buyer's order page — nothing for you to do."}
						</p>
					)}
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Booking cost {formatPrice(activeJob.costActual, order.currency)}
						</span>
						{activeJob.shareLink ? (
							<a
								href={activeJob.shareLink}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 font-medium text-accent hover:underline"
							>
								Live tracking <ExternalLink className="size-3" />
							</a>
						) : null}
					</div>
					<Button
						type="button"
						variant="outline"
						className="h-10 w-full text-destructive"
						onClick={() => setConfirmCancelOpen(true)}
						disabled={cancelling}
					>
						{cancelling ? "Cancelling…" : "Cancel booking"}
					</Button>
				</div>
			) : null}

			{/* Completed — the settled record: what it cost the seller, who
			    delivered, and the trip link. Without this a delivered order rendered
			    an empty "Lalamove Delivery" card (job is neither active nor failed). */}
			{completedJob ? (
				<div className="flex flex-col gap-2 text-sm">
					<p className="text-muted-foreground">
						{jobCollection
							? "A Lalamove rider collected this order from your customer and dropped it off with you."
							: "This order was delivered by a Lalamove rider."}
					</p>
					{/* The question this state raises — "so how do I get it back to
					    them?" — answered honestly: a return order created here would
					    be another COLLECTION (the store-wide direction), so today the
					    return leg is booked in the vendor's own Lalamove app. See the
					    Leg 2 follow-up in docs/delivery-lalamove.md. */}
					{jobCollection ? (
						<p className="text-xs text-muted-foreground">
							Sending it back after your work? Book that trip in your Lalamove
							app — return trips aren&apos;t handled here yet.
						</p>
					) : null}
					{completedJob.driver ? (
						<div
							{...MASK_PII}
							className="flex items-center gap-2 text-xs text-muted-foreground"
						>
							<Bike className="size-3.5 text-accent" />
							<span className="font-medium text-foreground">
								{completedJob.driver.name}
							</span>
							{completedJob.driver.plateNumber ? (
								<span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">
									{completedJob.driver.plateNumber}
								</span>
							) : null}
						</div>
					) : null}
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Booking cost{" "}
							{formatPrice(completedJob.costActual, order.currency)}
						</span>
						{completedJob.shareLink ? (
							<a
								href={completedJob.shareLink}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 font-medium text-accent hover:underline"
							>
								Trip details <ExternalLink className="size-3" />
							</a>
						) : null}
					</div>
					{/* Rider's drop-off photo (proof of delivery) — never WhatsApp'd
					    (86eyd63r8). Standard: the same shot renders on the buyer's order
					    page. Collection (86eyg0n8e): seller-only — it shows the
					    hand-over at THIS outlet, and orders.get hides it from the buyer. */}
					{completedJob.podImageUrls?.length ? (
						<div className="flex flex-col gap-1.5">
							<p className="text-xs text-muted-foreground">
								{jobCollection
									? "Drop-off photo from the rider (kept for your records — not sent to the buyer)"
									: "Delivery photo from the rider — the buyer sees this on their order page too"}
							</p>
							<div className="flex gap-2">
								{completedJob.podImageUrls.map((url) => (
									<a
										key={url}
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										className="block h-20 w-20 overflow-hidden rounded-xl border border-border"
									>
										<AppImage
											src={url}
											alt="Proof of delivery"
											aspect="h-20 w-20"
										/>
									</a>
								))}
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{/* Book / rebook — or the disabled-with-reason state. */}
			{!activeJob && bookable && !collectionDone ? (
				blockReason === null || blockReason === "job_active" ? (
					<Button
						type="button"
						className="h-11 w-full"
						// Rebook (86eyp63xn): the failed trip's schedule is stale, so
						// the dialog opens with the time editor already showing.
						onClick={() =>
							handlePrepare(failedJob ? { autoEditSchedule: true } : undefined)
						}
						disabled={preparing}
					>
						{preparing ? (
							<>
								<Loader2 className="size-4 animate-spin" /> Getting today&apos;s
								price…
							</>
						) : failedJob ? (
							<>
								<RefreshCw className="size-4" />{" "}
								{collection ? "Rebook collection" : "Rebook delivery"}
							</>
						) : (
							<>
								<Truck className="size-4" />{" "}
								{collection ? "Send rider to collect" : "Book delivery"}
							</>
						)}
					</Button>
				) : (
					<div className="flex flex-col gap-2">
						<Button type="button" className="h-11 w-full" disabled>
							<Truck className="size-4" />{" "}
							{collection ? "Send rider to collect" : "Book delivery"}
							{blockReason === "plan_gated" ? <ProBadge /> : null}
						</Button>
						<p className="text-xs text-muted-foreground">
							{dispatchBlockCopy(blockReason)}
						</p>
					</div>
				)
			) : null}

			{/* Prompt-on-packed heads-up — tells the seller the booking dialog will
			    pop when they mark this order packed (never a silent charge). */}
			{promptBookOnPacked && !activeJob && bookable && !orderCollection ? (
				<p className="text-xs text-muted-foreground">
					⚡ You'll be asked to book a rider (with today's price) the moment
					this order is <span className="font-medium">Packed</span> and{" "}
					<span className="font-medium">paid</span>
					{isFutureDated
						? " — but as it's for a later day, book it manually on the delivery morning"
						: order.status === "packed" && order.paymentStatus !== "received"
							? " (waiting on payment)"
							: order.paymentStatus === "received" &&
									order.status === "confirmed"
								? " (waiting on Packed)"
								: ""}
					.
				</p>
			) : null}

			{/* Confirm dialog — fresh price + variance vs what the buyer paid. */}
			<Dialog
				open={quote !== null || preparing}
				onOpenChange={(o) => {
					if (o) return;
					// Dismissed mid-quote: the action can't be recalled, so mark this
					// attempt stale and let its result land nowhere.
					if (preparing) prepareGenRef.current += 1;
					setQuote(null);
					setBookingError(null);
					resetScheduleState();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{collection
								? "Send a rider to collect?"
								: "Book a Lalamove rider?"}
						</DialogTitle>
						<DialogDescription>
							{collection
								? "Today's price to collect from your customer's address. The price is locked for 5 minutes — confirm to dispatch."
								: "Today's price for this delivery. The price is locked for 5 minutes — confirm to dispatch."}
						</DialogDescription>
					</DialogHeader>
					{sandbox ? (
						<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							<FlaskConical className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-medium">Test keys.</span> This dispatches a
								simulated trip — no rider will come and nothing is charged.
							</span>
						</p>
					) : null}
					{quote === null ? (
						<div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Getting today&apos;s price from Lalamove…
						</div>
					) : (
						<div className="flex flex-col gap-1.5 text-sm">
							{/* A scheduled pickup and a rider-now dispatch are different
							    purchases — say which one this confirm buys, and let the
							    seller buy a different slot (86eyp5qd1): advance-book a
							    sane time, leave earlier than the promise, or send now. */}
							<div
								className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-xs ${
									quote.scheduledFor
										? "bg-accent/10 text-accent-emphasis"
										: "bg-muted text-muted-foreground"
								}`}
							>
								<span>
									{quote.scheduledFor
										? `Scheduled pickup — the rider comes ${formatScheduledMoment(
												quote.scheduledFor,
											)}, ${
												scheduleOverride !== null
													? "the time you picked."
													: "the time the buyer asked for."
											}`
										: scheduleOverride === "now"
											? "The rider comes now — dispatching immediately, at your choice."
											: scheduleOverride !== null
												? "The rider comes now — the time you picked is less than 15 minutes away, so this books an immediate pickup."
												: "The rider comes now — the buyer's requested time is already here (or none was set)."}
								</span>
								<button
									type="button"
									className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
									disabled={requoting || booking}
									onClick={() =>
										editSchedule ? setEditSchedule(false) : openScheduleEditor()
									}
								>
									{editSchedule ? "Close" : "Change time"}
								</button>
							</div>
							{editSchedule ? (
								<div className="flex flex-col gap-2 rounded-xl border border-border p-3">
									{/* Inputs and actions share one 2-col grid rhythm and one
									    height (field inputs are min-h-11), so the four controls
									    read as a set instead of mismatched sizes. */}
									<div className="grid grid-cols-2 gap-2">
										<Input
											type="date"
											variant="field"
											aria-label="Pickup date"
											min={ymdFromEpoch(todayMytMidnight())}
											max={ymdFromEpoch(
												todayMytMidnight() +
													MAX_NOTICE_DAYS * 24 * 60 * 60 * 1000,
											)}
											value={schedDate}
											onChange={(e) => {
												setSchedDate(e.target.value);
												setScheduleError(null);
											}}
										/>
										<Input
											type="time"
											variant="field"
											aria-label="Pickup time"
											step={300}
											value={schedTime}
											onChange={(e) => {
												setSchedTime(e.target.value);
												setScheduleError(null);
											}}
										/>
									</div>
									{scheduleError ? (
										<p className="text-xs font-medium text-destructive">
											{scheduleError}
										</p>
									) : null}
									<div className="grid grid-cols-2 gap-2">
										<Button
											type="button"
											className="h-11 w-full"
											disabled={requoting || booking}
											onClick={() => void handleApplySchedule()}
										>
											{requoting ? "Updating price…" : "Use this time"}
										</Button>
										<Button
											type="button"
											variant="outline"
											className="h-11 w-full"
											disabled={requoting || booking}
											onClick={() =>
												void handleRequote({ scheduleOverride: "now" }).then(
													(ok) => ok && setEditSchedule(false),
												)
											}
										>
											Send the rider now
										</Button>
									</div>
									{scheduleOverride !== null ? (
										<button
											type="button"
											className="flex min-h-9 items-center self-start text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60"
											disabled={requoting || booking}
											onClick={() =>
												void handleRequote({ scheduleOverride: null }).then(
													(ok) => ok && setEditSchedule(false),
												)
											}
										>
											Use the buyer&apos;s time instead
										</button>
									) : null}
								</div>
							) : null}
							{/* The one choice AC2 hangs on: a picked moment can also move
							    the ORDER's promise (rescheduled just before dispatch, so
							    the trip and the buyer's page agree). Own row outside the
							    editor so it survives the editor closing and is visible at
							    the moment of confirm. Never for "now" — an immediate
							    dispatch is not a promise to write. */}
							{typeof scheduleOverride === "number" &&
							order.source !== "counter" ? (
								<label className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
									<input
										type="checkbox"
										className="mt-0.5 size-4 shrink-0 accent-accent"
										checked={syncOrderTime}
										disabled={booking || requoting}
										onChange={(e) => setSyncOrderTime(e.target.checked)}
									/>
									<span>
										Also update the delivery time the buyer sees — the order
										becomes{" "}
										<span className="font-medium">
											{formatScheduledMoment(scheduleOverride)}
										</span>{" "}
										when you book, and their order page follows instantly.
									</span>
								</label>
							) : null}
							{/* The trip being bought no longer matches what the order
							    promises the buyer — say so BEFORE the money moves. With
							    the sync checkbox ON the mismatch resolves itself at
							    confirm, so the warning only fires when the seller has
							    deliberately left the promise untouched (or chose "now",
							    where there is nothing to write). */}
							{scheduleOverride !== null &&
							!(typeof scheduleOverride === "number" && syncOrderTime) &&
							quote.buyerRequestedMoment !== undefined &&
							quote.buyerRequestedMoment > Date.now() &&
							quote.scheduledFor !== quote.buyerRequestedMoment ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									The order still promises the buyer{" "}
									<span className="font-medium">
										{formatScheduledMoment(quote.buyerRequestedMoment)}
									</span>
									{typeof scheduleOverride === "number" ? (
										<>
											. Tick the box above to update it when you book —
											otherwise their order page keeps the old time.
										</>
									) : (
										<>
											. If you&apos;ve agreed a new delivery time with them,
											use <span className="font-medium">Reschedule</span> on
											this page before booking — their order page keeps the
											old time otherwise.
										</>
									)}
								</p>
							) : null}
							{/* Per-order vehicle choice — defaults to the settings vehicle;
							    switching re-quotes (prices are per-vehicle). */}
							<div className="grid grid-cols-2 gap-2">
								{(
									[
										["MOTORCYCLE", "Motorcycle", Bike],
										["CAR", "Car", Car],
									] as const
								).map(([value, label, Icon]) => (
									<button
										key={value}
										type="button"
										aria-pressed={quote.vehicleType === value}
										disabled={requoting || booking}
										onClick={() => handleSwitchVehicle(value)}
										className={`flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-medium transition-colors ${
											quote.vehicleType === value
												? "border-accent bg-accent/5 text-accent"
												: "border-border text-foreground hover:border-accent/40"
										} ${requoting || booking ? "opacity-60" : ""}`}
									>
										<Icon className="size-4" /> {label}
									</button>
								))}
							</div>
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">
									Rider ({quote.vehicleType === "CAR" ? "Car" : "Motorcycle"})
								</span>
								<span className="text-lg font-bold">
									{requoting ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										formatPrice(quote.fee, order.currency)
									)}
								</span>
							</div>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>
									{collection
										? "Buyer paid for collection"
										: "Buyer paid for delivery"}
								</span>
								<span>{formatPrice(quote.buyerPaidFee, order.currency)}</span>
							</div>
							{order.paymentStatus !== "received" ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									Heads-up: this order isn&apos;t marked as paid yet — booking
									now means you&apos;re fronting the delivery before the money
									lands.
								</p>
							) : null}
							{quote.buyerContactFallback ? (
								<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
									This buyer&apos;s WhatsApp isn&apos;t a Malaysian number, and
									Lalamove only accepts +60 contacts — the rider will get{" "}
									<span className="font-medium">your store&apos;s number</span>{" "}
									instead, with the buyer&apos;s real number in the rider notes.
								</p>
							) : null}
							{variance !== 0 ? (
								<p
									className={`rounded-lg px-3 py-2 text-xs ${
										variance > 0
											? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
											: "bg-muted text-muted-foreground"
									}`}
								>
									{variance > 0
										? `Today's price is ${formatPrice(variance, order.currency)} more than the buyer paid — the difference comes out of your Lalamove wallet.`
										: `Today's price is ${formatPrice(-variance, order.currency)} less than the buyer paid — the difference stays with you.`}
								</p>
							) : null}
						</div>
					)}
					{/* The way out for an order going by hand. Its own full-width row,
					    not a third button in the footer: three side-by-side actions
					    read as three equal choices, and this label carries the
					    seller's stage vocabulary so it can be long. */}
					{fromAdvance && advanceWithoutRider ? (
						<Button
							type="button"
							variant="outline"
							// Buttons are `whitespace-nowrap` by default; this label carries
							// the seller's own stage vocabulary and can be long, so let it
							// wrap rather than force the modal wider than its max-width.
							className="h-auto min-h-11 w-full py-2 whitespace-normal"
							disabled={booking || quote === null}
							onClick={() => {
								setQuote(null);
								setBookingError(null);
								advanceWithoutRider.onConfirm();
							}}
						>
							{advanceWithoutRider.label}
						</Button>
					) : null}
					{/* The failure the seller must act on, and the way out. A dead
					    quote is the ordinary end state here: fixing a wallet or a
					    phone number takes longer than the 5 minutes Lalamove holds a
					    price, so the recovery action has to live in this dialog
					    rather than on the card behind it (86eypncfy). */}
					{bookingError ? (
						<div className="flex flex-col gap-1.5 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
							<p className="flex items-start gap-2">
								<CircleAlert className="mt-0.5 size-4 shrink-0" />
								<span>
									<span className="font-medium">
										Booking didn&apos;t go through
									</span>{" "}
									— {bookingError}
								</span>
							</p>
							<p className="pl-6 text-xs opacity-80">
								Nothing was charged and your buyer wasn&apos;t notified. Fix
								it, then get a fresh price — this one is no longer valid.
							</p>
						</div>
					) : quoteStale ? (
						<p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
							This price has expired — Lalamove only holds a quote for 5
							minutes. Get a fresh one to dispatch.
						</p>
					) : quote !== null ? (
						<p className="text-right text-xs text-muted-foreground tabular-nums">
							Price locked for {formatCountdown(quote.expiresAt - now)}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setQuote(null);
								setBookingError(null);
							}}
							disabled={booking}
						>
							Not now
						</Button>
						{/* One primary action, and it is always the one that can
						    actually succeed: dispatch while the price is live, a
						    re-quote once it isn't. Re-pressing a dead "Confirm" was
						    the trap. */}
						{needsFreshQuote ? (
							<Button
								type="button"
								onClick={() => void handleRequote({})}
								disabled={booking || requoting || quote === null}
							>
								{requoting ? (
									<>
										<Loader2 className="size-4 animate-spin" /> Getting a fresh
										price…
									</>
								) : (
									<>
										<RefreshCw className="size-4" /> Get a fresh price
									</>
								)}
							</Button>
						) : (
							<Button
								type="button"
								onClick={handleConfirm}
								// Disabled rather than an inert click handler: a button that
								// silently swallows a real tap reads as broken.
								disabled={
									booking || requoting || quote === null || !spendArmed
								}
							>
								{booking ? "Booking…" : "Confirm & dispatch"}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={confirmCancelOpen}
				onOpenChange={setConfirmCancelOpen}
				title="Cancel this Lalamove booking?"
				description="If a rider has already been assigned, Lalamove may charge a cancellation fee. The order itself stays as-is."
				confirmLabel="Cancel booking"
				cancelLabel="Keep booking"
				destructive
				onConfirm={handleCancelBooking}
			/>
		</section>
	);
}

/** "4:32" / "0:07" from a remaining-ms figure, floored at zero so a lapsed
 * quote never renders a negative clock. */
function formatCountdown(remainingMs: number): string {
	const total = Math.max(0, Math.floor(remainingMs / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "4 Aug 2026 · 3:30 PM" from an epoch moment — the card's one spelling for
 * a scheduled pickup (86eyg0n8e follow-up). */
function formatScheduledMoment(moment: number): string {
	const day = todayMytMidnight(moment);
	return formatFulfilmentDateTime(day, Math.round((moment - day) / 60000), {
		weekday: false,
	});
}

function JobStatusPill({
	status,
	collection,
}: {
	status: string;
	collection: boolean;
}) {
	// Delivered is a terminal, settled state — match the order status badge's
	// green rather than the in-progress mint. Collection trips end at the
	// SELLER's outlet, so "Delivered" would misread — "Arrived" it is.
	if (status === "completed") {
		return (
			<span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
				{collection ? "Arrived" : "Delivered"}
			</span>
		);
	}
	const label =
		status === "assigning"
			? "Finding rider"
			: status === "ongoing"
				? collection
					? "Heading to customer"
					: "Rider on the way"
				: status === "picked_up"
					? collection
						? "Collected"
						: "Picked up"
					: status;
	return (
		<span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent-emphasis">
			{label}
		</span>
	);
}
