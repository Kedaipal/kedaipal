import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	Bike,
	Car,
	CircleAlert,
	ExternalLink,
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
	todayMytMidnight,
} from "../../../convex/lib/fulfilmentDate";
import { MASK_PII } from "../../lib/analytics-privacy";
import { dispatchBlockCopy } from "../../lib/dispatch-block";
import { formatPrice } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

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

	const [preparing, setPreparing] = useState(false);
	const [quote, setQuote] = useState<{
		quotationId: string;
		senderStopId: string;
		recipientStopId: string;
		fee: number;
		buyerPaidFee: number;
		vehicleType: string;
		buyerContactFallback: boolean;
		/** The pickup moment this quote is scheduled for — undefined = the
		 * rider comes now (86eyg0n8e follow-up). */
		scheduledFor?: number;
	} | null>(null);
	const [booking, setBooking] = useState(false);
	// In-dialog vehicle switch → fresh quote (prices are per-vehicle). Keeps
	// the dialog open with the price row loading instead of bouncing the
	// seller back to settings to change vehicle for one order.
	const [requoting, setRequoting] = useState(false);
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

	async function handlePrepare(opts?: { fromAdvance?: boolean }) {
		setFromAdvance(opts?.fromAdvance === true);
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
			setQuote(result);
		} finally {
			setPreparing(false);
		}
	}

	// Vehicle switch inside the open dialog — re-quote for the chosen vehicle
	// (each quotation is vehicle-bound). On failure the previous quote stays.
	async function handleSwitchVehicle(vehicleType: "MOTORCYCLE" | "CAR") {
		if (!quote || quote.vehicleType === vehicleType || requoting) return;
		setRequoting(true);
		try {
			const result = await prepareBooking({
				shortId: order.shortId,
				vehicleType,
			});
			if (!result.ok) {
				toast.error(result.message ?? dispatchBlockCopy(result.reason));
				return;
			}
			setQuote(result);
		} finally {
			setRequoting(false);
		}
	}

	async function handleConfirm() {
		if (!quote) return;
		setBooking(true);
		try {
			const result = await confirmBooking({
				shortId: order.shortId,
				quotationId: quote.quotationId,
				senderStopId: quote.senderStopId,
				recipientStopId: quote.recipientStopId,
				vehicleType: quote.vehicleType === "CAR" ? "CAR" : "MOTORCYCLE",
				scheduledFor: quote.scheduledFor,
			});
			if (!result.ok) {
				toast.error(result.message ?? dispatchBlockCopy(result.reason));
				return;
			}
			setQuote(null);
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
								: "Finding a rider… this usually takes a few minutes. When one picks up, the buyer gets the shipped message with live tracking automatically."}
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
					{/* Rider's drop-off photo (proof of delivery). Standard: the buyer
					    got the same shot on WhatsApp. Collection: seller-only — it
					    shows the hand-over at THIS outlet, never sent to the buyer. */}
					{completedJob.podImageUrls?.length ? (
						<div className="flex flex-col gap-1.5">
							<p className="text-xs text-muted-foreground">
								{jobCollection
									? "Drop-off photo from the rider (kept for your records — not sent to the buyer)"
									: "Delivery photo from the rider"}
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
						onClick={() => handlePrepare()}
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
					{quote === null ? (
						<div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Getting today&apos;s price from Lalamove…
						</div>
					) : (
						<div className="flex flex-col gap-1.5 text-sm">
							{/* A scheduled pickup and a rider-now dispatch are different
							    purchases — say which one this confirm buys. */}
							<p
								className={`rounded-lg px-3 py-2 text-xs ${
									quote.scheduledFor
										? "bg-accent/10 text-accent-emphasis"
										: "bg-muted text-muted-foreground"
								}`}
							>
								{quote.scheduledFor
									? `Scheduled pickup — the rider comes ${formatScheduledMoment(
											quote.scheduledFor,
										)}, the time the buyer asked for.`
									: "The rider comes now — the buyer's requested time is already here (or none was set)."}
							</p>
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
								advanceWithoutRider.onConfirm();
							}}
						>
							{advanceWithoutRider.label}
						</Button>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setQuote(null)}
							disabled={booking}
						>
							Not now
						</Button>
						<Button
							type="button"
							onClick={handleConfirm}
							disabled={booking || requoting || quote === null}
						>
							{booking ? "Booking…" : "Confirm & dispatch"}
						</Button>
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
