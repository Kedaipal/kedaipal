import { formatPrice } from "../../lib/format";

// An order's money as a LIST CARD shows it: the amount transacted, plus a note
// naming the part of it that isn't the seller's.
//
// The bold figure stays `order.total` — what the buyer paid and what lands in
// the seller's bank. Netting the deposit out of it here would put the card at
// odds with the receipt PDF, the CSV `Total` column, the order detail, the
// WhatsApp confirmation and the actual transfer, which is the same class of
// bug as the by-source leak this branch fixed, pointing the other way.
//
// What the deposit needs is a NAME, not a subtraction: without it RM110 reads
// as revenue when RM20 of it is held money the seller returns after check-out.
// The wording matches `booking-request-card.tsx`, which already says it this
// way — one idiom for one idea, trimmed here because a card is scanned rather
// than read (the detail page carries the full sentence).
//
// Renders exactly as before on any order without a deposit.

export function OrderTotal({
	total,
	securityDeposit,
	currency,
}: {
	total: number;
	/** Refundable booking deposit inside `total` (booking S5). */
	securityDeposit?: number;
	currency: string;
}) {
	const deposit = securityDeposit ?? 0;
	return (
		<span className="flex shrink-0 flex-col items-end leading-tight">
			<span className="text-[15px] font-bold tabular-nums">
				{formatPrice(total, currency)}
			</span>
			{deposit > 0 ? (
				<span className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
					incl. {formatPrice(deposit, currency)} refundable deposit
				</span>
			) : null}
		</span>
	);
}
