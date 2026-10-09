import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ArrowLeft, Lock, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatFulfilmentDateTime } from "../../../convex/lib/fulfilmentDate";
import { useCreditGate } from "../../hooks/useCreditGate";
import {
	cancelCreditLine,
	lockCta,
	orderGatedLine,
	ordersWaitingLabel,
} from "../../lib/credits-ui";
import {
	convexErrorMessage,
	formatOrderTimestamp,
	formatPrice,
} from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

/**
 * The order page for an order WAITING ON CREDITS (Credits T3.1).
 *
 * Not the normal page with its buttons greyed out — a whole screen of its own,
 * because the order is INVISIBLE rather than un-actionable (Zaki, 6 Oct 2026).
 * The server already redacted it: there is no buyer name, no phone, no address,
 * no line items and no tracking token in the payload this renders from, so
 * there is no normal page left to grey out. Rendering one would be a grid of
 * empty fields, which reads as a broken page rather than a deliberate state.
 *
 * What it does show is what survives the redaction on purpose — the reference,
 * when it arrived, what it's worth, how it leaves — plus the two things the
 * seller can actually do about it:
 *
 *  - TOP UP, with this order's own position named ("waiting on 3 credits"), so
 *    a seller buying one credit knows whether it will be this one;
 *  - CANCEL, which is never gated. A seller who can't see an order must still
 *    be able to release the buyer waiting on it — that is the mitigation the
 *    whole invisibility rule rests on, and a page without it would make the
 *    gate something to escape rather than something to pay to clear.
 *
 * Once it IS cancelled the screen changes rather than going stale. The
 * redaction is keyed on the credit sequence and deliberately survives the
 * cancel (those buyer details were never paid for), so `creditGated` stays
 * true — but nothing is waiting on credits any more and both controls are
 * spent. Leaving them up is how this first shipped: a cancelled order still
 * reading "Waiting on 1 credit" and still offering to cancel itself.
 */
export function GatedOrderPage({
	order,
}: {
	order: {
		_id: Id<"orders">;
		shortId: string;
		createdAt: number;
		total: number;
		currency: string;
		creditsToUnlock?: number;
		deliveryMethod?: string;
		fulfilmentDate?: number;
		/** Whole-day orders leave this undefined — see the Fulfilment fact. */
		fulfilmentTimeMinutes?: number;
		status: string;
	};
}) {
	const gate = useCreditGate();
	const updateStatus = useMutation(api.orders.updateStatus);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const cta = lockCta(gate.route);
	const isBooking = order.deliveryMethod === "booking";
	// A CANCELLED gated order is a different screen, not this one with a stale
	// headline. The redaction is seq-based and deliberately survives the
	// cancel (the buyer's details were never paid for), so `creditGated` stays
	// true — but nothing is waiting on credits any more, both CTAs are spent,
	// and leaving them up offered "Cancel and tell the buyer" on an order
	// already cancelled while still claiming "Waiting on 1 credit".
	const cancelled = order.status === "cancelled";
	// This order is itself one of the waiting orders — unless it's cancelled,
	// which `countOrdersAwaitingCredit` excludes. So "others are waiting" is a
	// different threshold on each screen.
	const othersWaiting = gate.ordersWaiting - (cancelled ? 0 : 1);
	// Deliberately NOT "Booking request" vs "RSVP request": `eventRsvp` is not
	// on the redaction allowlist and is not worth widening it for a label.
	// "Awaiting your answer" is true of both and says what to do about it.
	const statusFact =
		order.status === "booking_requested" ? "Awaiting your answer" : null;
	// The credit outlook is NOT gated (cancel and refund never are), so the
	// dialog can say whether this order's credit comes back before the tap —
	// the same sentence the normal cancel dialog shows.
	const outlook = useQuery(
		convexQuery(
			api.creditLock.cancelOutlook,
			cancelOpen ? { orderId: order._id } : "skip",
		),
	).data;

	async function cancel() {
		setBusy(true);
		try {
			await updateStatus({
				orderId: order._id,
				status: "cancelled",
				cancellationNote: note.trim() || undefined,
			});
			toast.success(`${order.shortId} cancelled — the buyer has been told.`);
			setCancelOpen(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<Link
				to="/app/orders"
				className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="size-4" aria-hidden="true" />
				Back to orders
			</Link>

			<section className="flex flex-col gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-5">
				<div className="flex items-start gap-3">
					<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
						{cancelled ? (
							<XCircle
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						) : (
							<Lock
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						)}
					</span>
					<div className="min-w-0">
						<h1 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
							{cancelled
								? "Cancelled"
								: orderGatedLine(order.creditsToUnlock ?? 1)}
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{cancelled
								? "This order was cancelled and the buyer has been told on their tracking page. Its details stay closed, but nothing here is waiting on credits any more."
								: gate.canAct
									? "This order arrived after your credits ran out, so its details stay closed until credits land. They open oldest first."
									: "This order arrived after the store's credits ran out, so its details stay closed until the owner adds credits. They open oldest first."}
						</p>
					</div>
				</div>

				{/* What the row is, in the three facts the redaction keeps. Enough
				    to recognise the order and to decide it is worth topping up for;
				    nothing that would let it be fulfilled by hand. */}
				<dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-3.5 sm:grid-cols-4">
					<Fact label="Order" value={`#${order.shortId}`} mono />
					<Fact
						label="Arrived"
						value={formatOrderTimestamp(order.createdAt, Date.now())}
					/>
					<Fact
						label="Total"
						value={formatPrice(order.total, order.currency)}
						mono
					/>
					{/* `formatFulfilmentDateTime`, NOT `formatOrderTimestamp`: a
					    fulfilment DATE is stored at MYT midnight with the time (if the
					    buyer gave one) in a separate `fulfilmentTimeMinutes`. Running
					    it through a timestamp formatter printed "8 Oct, 12:00 am" on a
					    whole-day order — a pickup time the buyer never asked for and
					    the seller would plan around. */}
					<Fact
						label="Fulfilment"
						value={
							order.fulfilmentDate !== undefined
								? formatFulfilmentDateTime(
										order.fulfilmentDate,
										order.fulfilmentTimeMinutes,
										{ weekday: false },
									)
								: isBooking
									? "Booking"
									: "—"
						}
					/>
					{/* Status only when it carries something "Arrived" doesn't. A
					    gated order is almost always new — the seller can't move it —
					    so a permanent "New" would be a field that never varies.
					    `cancelled` is in the headline; a booking REQUEST is the one
					    state worth a fact, because it means a buyer is waiting on an
					    answer the seller can still give (declining is never gated). */}
					{statusFact !== null ? (
						<Fact label="Status" value={statusFact} />
					) : null}
				</dl>

				{/* Both controls are about THIS order, so a cancelled one shows
				    neither: topping up can't open an order that no longer needs
				    opening, and cancelling is what already happened. */}
				{cancelled ? null : (
					<div className="flex flex-col gap-2 sm:flex-row">
						{gate.canAct ? (
							<Button asChild size="lg" className="h-11 w-full px-4 sm:w-auto">
								<Link to="/app/settings" search={cta.search}>
									{cta.label}
								</Link>
							</Button>
						) : null}
						{/* Always available, whatever the balance — see the component note. */}
						<Button
							variant="outline"
							size="lg"
							className="h-11 w-full px-4 sm:w-auto"
							onClick={() => setCancelOpen(true)}
						>
							Cancel and tell the buyer
						</Button>
					</div>
				)}
				{/* The way on from here, and on a cancelled order the ONLY one — so
				    the threshold counts the OTHERS, not the total. */}
				{othersWaiting > 0 ? (
					<p className="text-xs text-muted-foreground">
						<Link
							to="/app/orders"
							search={{ creditGated: true }}
							className="underline underline-offset-2"
						>
							{ordersWaitingLabel(gate.ordersWaiting)}
						</Link>{" "}
						— the oldest opens first.
					</p>
				) : null}
			</section>

			<Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Cancel {order.shortId}?</DialogTitle>
						<DialogDescription>
							The buyer is told on their tracking page, and any stock goes back.
							{outlook ? ` ${cancelCreditLine(outlook) ?? ""}` : ""}
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						{/* Plain `label` + the house classes — there is no Label
						    primitive in src/components/ui (every form in the app spells
						    it this way). */}
						<label
							htmlFor="gated-cancel-note"
							className="text-xs font-medium text-muted-foreground"
						>
							Reason for the buyer{isBooking ? "" : " (optional)"}
						</label>
						<Textarea
							id="gated-cancel-note"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="Sorry, we can't take this one on."
							rows={3}
						/>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setCancelOpen(false)}
							disabled={busy}
						>
							Keep it
						</Button>
						<Button
							variant="destructive"
							onClick={cancel}
							// A booking's cancellation reason is buyer-facing and
							// required by the server — say so before the tap rather
							// than failing on submit.
							disabled={busy || (isBooking && note.trim().length === 0)}
						>
							{busy ? "Cancelling…" : "Cancel this order"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function Fact({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="min-w-0">
			<dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd
				className={`mt-0.5 truncate text-sm font-medium ${mono ? "font-mono tabular-nums" : ""}`}
			>
				{value}
			</dd>
		</div>
	);
}
