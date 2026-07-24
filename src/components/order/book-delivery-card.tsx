import { Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import {
	Bike,
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
import type { DispatchBlock } from "../../../convex/lalamove";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { formatPrice } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
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
export function BookDeliveryCard({ order }: { order: Doc<"orders"> }) {
	const dispatch = useQuery(api.lalamove.getDeliveryJob, {
		shortId: order.shortId,
	});
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
	} | null>(null);
	const [booking, setBooking] = useState(false);
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

	if (order.deliveryMethod !== "delivery" || !dispatch) return null;
	const { job, blockReason, promptBookOnPacked } = dispatch;
	const activeJob =
		job && !["completed", "canceled", "expired", "rejected"].includes(job.status)
			? job
			: null;
	const failedJob =
		job && ["canceled", "expired", "rejected"].includes(job.status)
			? job
			: null;
	const completedJob = job && job.status === "completed" ? job : null;
	const bookable = order.status === "confirmed" || order.status === "packed";
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

	async function handlePrepare() {
		setPreparing(true);
		try {
			const result = await prepareBooking({ shortId: order.shortId });
			if (!result.ok) {
				toast.error(result.message ?? blockCopy(result.reason));
				return;
			}
			setQuote(result);
		} finally {
			setPreparing(false);
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
			});
			if (!result.ok) {
				toast.error(result.message ?? blockCopy(result.reason));
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
					Lalamove Delivery
				</p>
				{activeJob ? (
					<JobStatusPill status={activeJob.status} />
				) : completedJob ? (
					<JobStatusPill status="completed" />
				) : null}
			</div>

			{/* Failed booking — amber, with the one-tap rebook the ticket asks for. */}
			{failedJob && !activeJob ? (
				<div className="flex flex-col gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
					<p className="flex items-start gap-2">
						<CircleAlert className="mt-0.5 size-4 shrink-0" />
						<span>
							<span className="font-medium">Booking didn&apos;t go through</span>
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
							<span className="flex items-center gap-2">
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
					) : (
						<p className="text-muted-foreground">
							Finding a rider… this usually takes a few minutes. When one picks
							up, the buyer gets the shipped message with live tracking
							automatically.
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
						This order was delivered by a Lalamove rider.
					</p>
					{completedJob.driver ? (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
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
				</div>
			) : null}

			{/* Book / rebook — or the disabled-with-reason state. */}
			{!activeJob && bookable ? (
				blockReason === null || blockReason === "job_active" ? (
					<Button
						type="button"
						className="h-11 w-full"
						onClick={handlePrepare}
						disabled={preparing}
					>
						{preparing ? (
							<>
								<Loader2 className="size-4 animate-spin" /> Getting today&apos;s
								price…
							</>
						) : failedJob ? (
							<>
								<RefreshCw className="size-4" /> Rebook delivery
							</>
						) : (
							<>
								<Truck className="size-4" /> Book delivery
							</>
						)}
					</Button>
				) : (
					<div className="flex flex-col gap-2">
						<Button type="button" className="h-11 w-full" disabled>
							<Truck className="size-4" /> Book delivery
							{blockReason === "plan_gated" ? <ProBadge /> : null}
						</Button>
						<p className="text-xs text-muted-foreground">
							{blockCopy(blockReason)}
						</p>
					</div>
				)
			) : null}

			{/* Prompt-on-packed heads-up — tells the seller the booking dialog will
			    pop when they mark this order packed (never a silent charge). */}
			{promptBookOnPacked && !activeJob && bookable ? (
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
			<Dialog open={quote !== null} onOpenChange={(o) => !o && setQuote(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Book a Lalamove rider?</DialogTitle>
						<DialogDescription>
							Today&apos;s price for this delivery. The price is locked for 5
							minutes — confirm to dispatch.
						</DialogDescription>
					</DialogHeader>
					{quote ? (
						<div className="flex flex-col gap-1.5 text-sm">
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">
									Rider ({quote.vehicleType === "CAR" ? "Car" : "Motorcycle"})
								</span>
								<span className="text-lg font-bold">
									{formatPrice(quote.fee, order.currency)}
								</span>
							</div>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Buyer paid for delivery</span>
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
						<Button type="button" onClick={handleConfirm} disabled={booking}>
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

function JobStatusPill({ status }: { status: string }) {
	// Delivered is a terminal, settled state — match the order status badge's
	// green rather than the in-progress mint.
	if (status === "completed") {
		return (
			<span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
				Delivered
			</span>
		);
	}
	const label =
		status === "assigning"
			? "Finding rider"
			: status === "ongoing"
				? "Rider on the way"
				: status === "picked_up"
					? "Picked up"
					: status;
	return (
		<span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent-emphasis">
			{label}
		</span>
	);
}

function blockCopy(reason: DispatchBlock | "not_found" | string): string {
	switch (reason) {
		case "no_coords":
			return "This address has no map pin, so a rider can't be routed to it. Ask the buyer to re-pick their address from the suggestions on their tracking page, or update it for them.";
		case "no_buyer_phone":
			return "This order has no buyer WhatsApp number for the rider to contact.";
		case "no_seller_phone":
			return "Add a Malaysian (+60) WhatsApp number in Settings → Store first — Lalamove riders need a local pickup contact.";
		case "plan_gated":
			return "Lalamove booking is a Pro feature. Upgrade to book riders in one tap.";
		case "no_credentials":
			return "Your Lalamove API key is missing — add it under Settings → Fulfilment → Delivery charge → Lalamove.";
		case "booking_disabled":
			return "Lalamove isn't your delivery method right now — choose it under Settings → Fulfilment → Delivery charge.";
		case "bad_status":
			return "Delivery can be booked once the order is confirmed.";
		default:
			return "Booking isn't available for this order.";
	}
}
