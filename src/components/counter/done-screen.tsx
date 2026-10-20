// The counter checkout's Done screen — what the cashier sees the moment a
// sale is rung up, and the ONE place that says what happened to the buyer's
// WhatsApp.
//
// Two rules it exists to make visible:
//
// 1. A counter sale handed over on the spot is born COMPLETED (counterCheckout
//    .createOrderFromSession → `delivered`, reads "Completed"). Only a sale
//    where nothing changed hands yet — a collection dated for later, an RSVP —
//    stays confirmed, and this screen says why and keeps the one-tap close.
//
// 2. The buyer's one WhatsApp (86eyd63r8) is not assumed delivered. The order
//    carries its real outcome (`confirmationPushStatus`, stamped by
//    whatsapp.notifyCounterOrderCreated), so this screen reads it LIVE:
//    sending → sent → failed. A failure is the cashier's problem to solve while
//    the buyer is still standing there, so it comes with the order link to
//    share or copy — the previous screen said "we sent the buyer one WhatsApp"
//    before anything had been sent at all, which is how a silently rejected
//    message (no 24h window) went unnoticed for weeks.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CheckCircle2, Loader2, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import { MASK_PII } from "../../lib/analytics-privacy";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { shareLink } from "../../lib/share";
import { storefrontOrigin } from "../../lib/storefront-url";
import { OrderDocumentActions } from "../order/order-document-actions";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";

export type DoneScreenProps = {
	/** Known for an order created in THIS screen; absent when a completed
	 * session is reopened from the list (the row only carries `orderId`). */
	shortId: string | undefined;
	orderId: Id<"orders"> | undefined;
	/** What the cashier chose — the live order overrides it once loaded. */
	paidInPerson: boolean;
	/** The mutation's own answer, so the heading is right on the first paint
	 * (before the order query resolves) and never flickers. */
	completed?: boolean;
	/** RSVP — completion happens at the event, so the one-tap close is hidden. */
	eventRsvp?: boolean;
	/** Free order — the WhatsApp said "no payment needed", not "how to pay". */
	free?: boolean;
	buyerName: string | undefined;
	/** Anonymous cash sale — no buyer to notify (86ey8vqp6), so not even the
	 * one confirmation goes out and the document below is their only copy. */
	anonymous?: boolean;
	onBackToList: () => void;
};

/** The buyer's own order page — the link the WhatsApp carries. */
export function buyerOrderLink(trackingToken: string): string {
	return `${storefrontOrigin()}/track/${trackingToken}`;
}

export function DoneScreen({
	shortId,
	orderId,
	paidInPerson,
	completed: completedAtCreate = false,
	eventRsvp,
	free,
	buyerName,
	anonymous,
	onBackToList,
}: DoneScreenProps) {
	// The seller read of the order (shortId door). Reactive, so the WhatsApp
	// outcome lands here the moment the scheduled send records it.
	const order = useQuery(
		convexQuery(api.orders.get, shortId ? { shortId } : "skip"),
	).data;
	const updateStatus = useMutation(api.orders.updateStatus);
	const [completing, setCompleting] = useState(false);
	// Local echo for the one case the query can't answer: a reopened session
	// with no shortId, closed out from this screen.
	const [completedHere, setCompletedHere] = useState(false);

	const status = order?.status;
	const isCompleted =
		status === "delivered" ||
		(status === undefined && completedAtCreate) ||
		completedHere;
	const paymentReceived = order
		? (order.paymentStatus ?? "unpaid") === "received"
		: paidInPerson;
	const isFree = order ? order.total <= 0 : free === true;
	const stillToPay = !paymentReceived && !isFree;
	const amount = order ? formatPrice(order.total, order.currency) : undefined;
	const buyer = buyerName?.trim() || "the buyer";
	const trackingUrl = order?.trackingToken
		? buyerOrderLink(order.trackingToken)
		: undefined;
	// Offer the one-tap close only where the LIVE order says it is still open
	// (a collection dated for later) — never on a guess, so a reopened session
	// whose order can't be read offers nothing it can't vouch for. RSVPs
	// complete at the event, never here.
	const canComplete =
		status === "confirmed" &&
		!completedHere &&
		!eventRsvp &&
		!!orderId &&
		!completing;

	async function markCompleted() {
		if (!orderId) return;
		setCompleting(true);
		try {
			await updateStatus({ orderId, status: "delivered" });
			setCompletedHere(true);
			toast.success("Order marked as completed.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setCompleting(false);
		}
	}

	// A reopened legacy row whose order can't be read: say only what is true.
	const unknown = shortId === undefined;
	const heading = unknown
		? "Checkout saved"
		: isCompleted
			? "Sale complete"
			: eventRsvp
				? "RSVP saved"
				: "Order created";

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-6">
			<div className="flex items-start gap-4">
				<span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
					<CheckCircle2 className="size-7" />
				</span>
				<div className="min-w-0">
					<p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
						Counter sale
					</p>
					<h2 className="mt-1 text-2xl font-bold text-emerald-950">
						{heading}
					</h2>
					<p className="mt-1 text-sm text-emerald-800">
						<OrderLine
							shortId={shortId}
							isCompleted={isCompleted}
							eventRsvp={eventRsvp}
							stillToPay={stillToPay}
							isFree={isFree}
							amount={amount}
							fulfilmentDate={order?.fulfilmentDate}
						/>
					</p>
				</div>
			</div>

			<WhatsAppOutcome
				anonymous={anonymous}
				known={shortId !== undefined}
				pushStatus={order?.confirmationPushStatus}
				failureKind={order?.confirmationPushFailureKind}
				buyer={buyer}
				stillToPay={stillToPay}
				isFree={isFree}
				trackingUrl={trackingUrl}
			/>

			{shortId ? (
				<div className="rounded-xl border border-emerald-200 bg-white/70 p-4">
					<p className="text-sm font-semibold text-emerald-950">
						{paymentReceived ? "Receipt" : "Invoice"}
					</p>
					<OrderDocumentActions
						shortId={shortId}
						paid={paymentReceived}
						buyerName={buyerName}
						hasBuyer={!anonymous}
						className="mt-3"
					/>
				</div>
			) : null}

			<div className="grid gap-2 sm:grid-cols-2">
				{canComplete ? (
					<div className="sm:col-span-2">
						<p className="mb-2 text-xs text-emerald-800">
							Collecting later — mark it completed once it&rsquo;s handed over.
						</p>
						<Button
							onClick={markCompleted}
							isLoading={completing}
							className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
						>
							{completing ? "Completing…" : "Mark as completed"}
						</Button>
					</div>
				) : null}
				<Button
					onClick={onBackToList}
					variant={canComplete ? "outline" : "default"}
					className="h-11"
				>
					Back to checkouts
				</Button>
				{shortId ? (
					<Button asChild variant="outline" className="h-11">
						<Link to="/app/orders/$shortId" params={{ shortId }}>
							View order
						</Link>
					</Button>
				) : orderId ? (
					<Button asChild variant="outline" className="h-11">
						<Link to="/app/orders">Go to orders</Link>
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** "Order ORD-XXXX is complete and paid." — one sentence, every state. */
function OrderLine({
	shortId,
	isCompleted,
	eventRsvp,
	stillToPay,
	isFree,
	amount,
	fulfilmentDate,
}: {
	shortId: string | undefined;
	isCompleted: boolean;
	eventRsvp: boolean | undefined;
	stillToPay: boolean;
	isFree: boolean;
	amount: string | undefined;
	fulfilmentDate: number | undefined;
}) {
	const money = stillToPay
		? amount
			? ` — ${amount} still to pay.`
			: " — payment still to come."
		: isFree
			? " — nothing to pay."
			: " and paid.";
	const state = isCompleted
		? `is complete${money}`
		: eventRsvp
			? "is confirmed — the guest checks in at the event."
			: fulfilmentDate !== undefined
				? `is confirmed — collecting ${formatFulfilmentDate(fulfilmentDate, { year: false })}. It stays open until it's handed over.`
				: "is confirmed and stays open until it's handed over.";
	if (!shortId)
		return (
			<>
				The order is saved — open it for its status and the buyer&rsquo;s
				WhatsApp.
			</>
		);
	return (
		<>
			Order <span className="font-mono font-semibold">{shortId}</span> {state}
		</>
	);
}

/**
 * What happened to the buyer's WhatsApp — read from the order, never assumed.
 * The failed state carries the way out: the link, to share or copy while the
 * buyer is still at the counter.
 */
function WhatsAppOutcome({
	anonymous,
	known,
	pushStatus,
	failureKind,
	buyer,
	stillToPay,
	isFree,
	trackingUrl,
}: {
	anonymous: boolean | undefined;
	/** False when the screen was reached with no shortId (reopened session). */
	known: boolean;
	pushStatus: string | undefined;
	failureKind: string | undefined;
	buyer: string;
	stillToPay: boolean;
	isFree: boolean;
	trackingUrl: string | undefined;
}) {
	if (anonymous) {
		return (
			<Row icon={<MessageCircle className="size-4 text-emerald-700" />}>
				Cash sale with no contact — nothing was sent. The{" "}
				{stillToPay ? "invoice" : "receipt"} below is their only copy.
			</Row>
		);
	}
	const payTail = stillToPay
		? " — with how to pay."
		: isFree
			? " — nothing to pay."
			: ".";
	// Only a legacy row whose order can't be read any more lands here — the
	// order line above already says to open it; claim nothing more.
	if (!known) return null;
	if (pushStatus === "failed") {
		const ours = failureKind === "system";
		return (
			<div
				{...MASK_PII}
				className="rounded-xl border border-amber-200 bg-amber-50 p-4"
			>
				<p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
					<MessageCircle className="size-4 text-amber-700" />
					WhatsApp couldn&rsquo;t reach {buyer}
				</p>
				<p className="mt-1 text-sm text-amber-900">
					{ours
						? "A WhatsApp problem on our side stopped the message — their number looks fine. "
						: "That number may have a typo or no WhatsApp — check it with them. "}
					Share their order link another way
					{stillToPay ? " — it's how they pay" : ""}.
				</p>
				{trackingUrl ? (
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							onClick={() => void shareLink(trackingUrl)}
							className="h-11 bg-amber-600 text-white hover:bg-amber-700"
						>
							<Share2 className="size-4" />
							Share link
						</Button>
						<CopyButton
							value={trackingUrl}
							label="Copy link"
							ariaLabel="Copy the buyer's order link"
							successMessage="Order link copied"
							className="h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm text-amber-950 hover:bg-amber-100"
						/>
					</div>
				) : null}
			</div>
		);
	}
	if (pushStatus === "sent" || pushStatus === "recovered") {
		return (
			<Row icon={<CheckCircle2 className="size-4 text-emerald-700" />}>
				<span {...MASK_PII}>{buyer}</span> has their order link on WhatsApp
				{payTail}
			</Row>
		);
	}
	// `sending` — and the instant before the order query resolves.
	return (
		<Row
			icon={<Loader2 className="size-4 animate-spin text-emerald-700" />}
			live
		>
			Sending <span {...MASK_PII}>{buyer}</span> their order link on WhatsApp…
		</Row>
	);
}

function Row({
	icon,
	live,
	children,
}: {
	icon: React.ReactNode;
	live?: boolean;
	children: React.ReactNode;
}) {
	return (
		<p
			className="flex items-start gap-2 text-sm text-emerald-900"
			aria-live={live ? "polite" : undefined}
		>
			<span className="mt-0.5 shrink-0">{icon}</span>
			<span>{children}</span>
		</p>
	);
}
