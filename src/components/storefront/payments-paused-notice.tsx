import { PauseCircle } from "lucide-react";
import {
	PAYMENTS_PAUSED_HEADING,
	paymentsPausedCheckoutLine,
} from "../../../convex/lib/buyerPayments";

/**
 * Checkout's half of "payments paused while the store is lapsed" (z8r3fdr6gg).
 * The buyer can still place the order; what changes is that they'll pay later,
 * from the order page, once the store is back — and they're told that BEFORE
 * they commit, not after. Sits in the summary column of every checkout (cart,
 * booking, RSVP, claim link), beside the total and the CTA it qualifies.
 *
 * The SeasonalBreakNotice's visual sibling: the same calm "paused" callout, so
 * two store states that stop one thing read as one family. Renders nothing
 * when payments are open, or for a free order, which has nothing to pay.
 */
export function PaymentsPausedNotice({
	paused,
	storeName,
	free = false,
}: {
	paused: boolean | undefined;
	storeName: string;
	free?: boolean;
}) {
	if (!paused || free) return null;
	return (
		<div
			role="note"
			className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3"
		>
			<PauseCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
			<div className="flex flex-col gap-0.5">
				<p className="text-sm font-semibold">{PAYMENTS_PAUSED_HEADING}</p>
				<p className="text-sm text-muted-foreground">
					{paymentsPausedCheckoutLine(storeName)}
				</p>
			</div>
		</div>
	);
}
