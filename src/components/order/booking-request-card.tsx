// The seller's Approve / Decline card for a booking request (S3 `86eyn4kcn`;
// design 86eym0pjg §4). Takes the stepper's slot while an order sits in
// `booking_requested` — approve/decline IS the stage control until the
// request is answered. Approve leads (the mint primary); decline opens a
// dialog whose reason is REQUIRED because it's quoted verbatim to the guest.

import { useMutation } from "convex/react";
import { CalendarRange, Check, Clock, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BOOKING_REQUEST_TTL_MS } from "../../../convex/lib/bookingAvailability";
import {
	DAY_MS,
	formatFulfilmentDate,
} from "../../../convex/lib/fulfilmentDate";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { FilterChip } from "../ui/filter-chip";

const QUICK_REASONS = [
	"Those dates aren't available",
	"We're closed for maintenance",
	"Group size is too large for this site",
];

export function BookingRequestCard({
	order,
}: {
	order: {
		_id: Id<"orders">;
		shortId: string;
		createdAt: number;
		total: number;
		securityDeposit?: number;
		currency: string;
		bookingCheckIn?: number;
		bookingCheckOut?: number;
		bookingContext?: {
			capacityPerNight: number;
			peakOtherBookings: number;
			nights: number;
		};
		items: { name: string }[];
	};
}) {
	const approve = useMutation(api.bookings.approveBookingRequest);
	const decline = useMutation(api.bookings.declineBookingRequest);
	const [pending, setPending] = useState<"approve" | "decline" | null>(null);
	const [declineOpen, setDeclineOpen] = useState(false);
	const [reason, setReason] = useState("");

	const nights =
		order.bookingCheckIn !== undefined && order.bookingCheckOut !== undefined
			? Math.round((order.bookingCheckOut - order.bookingCheckIn) / DAY_MS)
			: 0;
	// The 24 h promise, counted from the request — red once it's about to lapse
	// (the expiry cron releases the hold at zero).
	const msLeft = order.createdAt + BOOKING_REQUEST_TTL_MS - Date.now();
	const hoursLeft = Math.max(0, Math.ceil(msLeft / 3_600_000));
	const context = order.bookingContext;

	async function handleApprove() {
		setPending("approve");
		try {
			await approve({ orderId: order._id });
			toast.success(
				"Booking approved — the guest can pay from their order page",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPending(null);
		}
	}

	async function handleDecline() {
		setPending("decline");
		try {
			await decline({ orderId: order._id, reason });
			toast.success("Request declined — the dates are free again");
			setDeclineOpen(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPending(null);
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-card p-4 dark:border-amber-800">
			<div className="flex items-center justify-between gap-2">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
					<CalendarRange className="size-3.5" aria-hidden />
					Booking request
				</span>
				<span
					className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
						hoursLeft <= 4
							? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
							: "bg-muted text-muted-foreground"
					}`}
				>
					<Clock className="size-3.5" aria-hidden />
					{msLeft <= 0 ? "Expiring…" : `Expires in ${hoursLeft}h`}
				</span>
			</div>

			{order.bookingCheckIn !== undefined &&
			order.bookingCheckOut !== undefined ? (
				<div className="flex flex-col gap-1.5 border-y-2 border-dashed border-border py-3 text-sm tabular-nums">
					<div className="flex items-baseline gap-1.5">
						<span className="font-medium">Check-in</span>
						<span className="flex-1 border-b-2 border-dotted border-border" />
						<span className="font-semibold">
							{formatFulfilmentDate(order.bookingCheckIn)}
						</span>
					</div>
					<div className="flex items-baseline gap-1.5">
						<span className="font-medium">Check-out</span>
						<span className="flex-1 border-b-2 border-dotted border-border" />
						<span className="font-semibold">
							{formatFulfilmentDate(order.bookingCheckOut)}
						</span>
					</div>
					<div className="flex items-baseline gap-1.5">
						<span className="text-muted-foreground">
							{order.items[0]?.name ?? "Listing"} · {nights} night
							{nights === 1 ? "" : "s"}
						</span>
						<span className="flex-1 border-b-2 border-dotted border-border" />
						<span className="font-heading font-extrabold">
							{formatPrice(order.total, order.currency)}
						</span>
					</div>
					{(order.securityDeposit ?? 0) > 0 ? (
						<p className="text-xs text-muted-foreground">
							incl.{" "}
							{formatPrice(order.securityDeposit ?? 0, order.currency)}{" "}
							refundable security deposit — returned after check-out.
						</p>
					) : null}
				</div>
			) : null}

			<p className="text-xs leading-relaxed text-muted-foreground">
				{context
					? context.peakOtherBookings > 0
						? `${context.peakOtherBookings} of ${context.capacityPerNight} spot${context.capacityPerNight === 1 ? "" : "s"} already booked on those nights. `
						: `No other bookings on those nights (capacity ${context.capacityPerNight}). `
					: null}
				Approving confirms the booking and unlocks payment on the guest&apos;s
				order page. Nothing has been charged yet; unanswered requests release
				automatically after 24 hours.
			</p>

			<Button
				className="tap-target h-12 w-full"
				disabled={pending !== null}
				isLoading={pending === "approve"}
				onClick={handleApprove}
			>
				<Check className="size-4" aria-hidden />
				Approve booking
			</Button>
			<Button
				variant="outline"
				className="tap-target w-full text-destructive"
				disabled={pending !== null}
				onClick={() => setDeclineOpen(true)}
			>
				<X className="size-4" aria-hidden />
				Decline…
			</Button>

			<Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Decline this request?</DialogTitle>
						<DialogDescription>
							The guest sees your reason word-for-word, and the dates open up
							again. Nothing was charged.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-wrap gap-1.5">
						{QUICK_REASONS.map((quick) => (
							<FilterChip
								key={quick}
								selected={reason === quick}
								onClick={() => setReason(quick)}
							>
								{quick}
							</FilterChip>
						))}
					</div>
					<textarea
						value={reason}
						onChange={(e) => setReason(e.target.value.slice(0, 200))}
						rows={2}
						placeholder="Reason (required) — e.g. We're closed for a private event that weekend"
						className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
					/>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={pending !== null}
							onClick={() => setDeclineOpen(false)}
						>
							Keep the request
						</Button>
						<Button
							variant="destructive"
							disabled={reason.trim().length === 0 || pending !== null}
							isLoading={pending === "decline"}
							onClick={handleDecline}
						>
							Decline &amp; notify guest
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

/** After a request resolves without an approval, the seller still sees WHY the
 * order reads cancelled — especially the reason they typed. */
export function BookingResolutionNote({
	resolution,
	reason,
}: {
	resolution: "declined" | "expired";
	reason?: string;
}) {
	return (
		<section className="flex flex-col gap-1 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
			<p className="font-semibold">
				{resolution === "declined"
					? "Booking request declined"
					: "Booking request expired"}
			</p>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{resolution === "declined"
					? `Reason sent to the guest: “${reason ?? ""}”`
					: "No answer within 24 hours, so the hold was released automatically and the guest was told the dates are free again."}
			</p>
		</section>
	);
}
