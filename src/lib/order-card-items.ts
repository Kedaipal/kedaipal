/**
 * Line-item summary for the order inbox card (ClickUp 86ey9uny8).
 *
 * The card shows what was ordered — qty × product · variant, with a per-line
 * amount — inside a tinted block, capped so a 10-item counter order can't turn
 * the card into a receipt. Overflow folds into one "+N more items" row that
 * carries the aggregated amount of the folded lines, so the visible amounts
 * always sum to the items subtotal.
 */

export type OrderCardItem = {
	/** Snapshot ids, used only for stable React keys (variantId ?? productId). */
	productId?: string;
	variantId?: string;
	name: string;
	/** Chosen option values ("1kg / Fillet"); empty/undefined for single-variant. */
	variantLabel?: string;
	/** Per-unit price in minor units (sen), frozen at order create. */
	price: number;
	quantity: number;
};

export type OrderCardItemLine = OrderCardItem & {
	/** price × quantity, minor units — the amount shown on the row. */
	lineTotal: number;
};

export type OrderCardItemSummary = {
	lines: OrderCardItemLine[];
	/** Items folded into the "+N more" row (0 = no overflow row). */
	moreCount: number;
	/** Aggregated price × quantity of the folded items, minor units. */
	moreAmount: number;
};

/** Item rows shown on a card before folding into "+N more items". */
export const ORDER_CARD_MAX_ITEM_LINES = 2;

/**
 * Folding only kicks in when it saves vertical space: an order with exactly
 * `max + 1` items shows all of them, because a "+1 more" row would occupy the
 * same line the item itself fits on — the seller would rather see the item.
 * Card height is therefore capped at `max + 1` rows either way.
 */
export function summarizeOrderCardItems(
	items: OrderCardItem[],
	max: number = ORDER_CARD_MAX_ITEM_LINES,
): OrderCardItemSummary {
	const withTotals = items.map((it) => ({
		...it,
		lineTotal: it.price * it.quantity,
	}));
	if (withTotals.length <= max + 1) {
		return { lines: withTotals, moreCount: 0, moreAmount: 0 };
	}
	const lines = withTotals.slice(0, max);
	const folded = withTotals.slice(max);
	return {
		lines,
		moreCount: folded.length,
		moreAmount: folded.reduce((sum, it) => sum + it.lineTotal, 0),
	};
}
