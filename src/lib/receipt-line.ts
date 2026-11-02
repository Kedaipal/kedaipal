/**
 * The one definition of a receipt line's left column, shared by every buyer
 * "Order Ticket": the storefront checkout (`checkout-summary.tsx`) and the
 * claim checkout (`claim/claim-checkout-page.tsx`).
 *
 * These two tickets render the same design — same masthead, same mono type,
 * same dotted leaders — from two separate components, and they DID drift:
 * `z8r3fdhpaj` fixed the truncated label on the storefront one and left the
 * claim one joining name, variant and quantity into a single `truncate`d
 * string, where a long name ate the variant AND the quantity. Both now build
 * the label and wear the classes from here, so the next change can't fix one
 * ticket and miss the other.
 */

/**
 * "1× Kek Batik" — quantity FIRST.
 *
 * The quantity leads for a reason: a trailing `×4` is the first thing a narrow
 * column cuts, and "how many am I buying" is not a detail a buyer may lose on
 * the last screen before they commit. It is always printed, including `1×`, so
 * the column reads the same down the whole ticket.
 *
 * The variant is deliberately NOT joined on: it renders as its own muted line
 * (`RECEIPT_VARIANT_CLASS`) so no amount of name length can push it out of
 * view — for a made-to-order seller the variant IS the order.
 */
export function receiptLineLabel(quantity: number, name: string): string {
	return `${quantity}× ${name}`;
}

/**
 * The label cell. `wrap-anywhere`, never `truncate` or `break-words`: only
 * `overflow-wrap: anywhere` shrinks a flex item's min-content size, so a
 * 60-char unbroken name breaks mid-word instead of forcing the ticket to
 * scroll sideways. `min-w-0` lets the cell shrink at all; the `flex-1` dotted
 * leader beside it then collapses to zero width on its own once a long label
 * claims the row, and returns when the name is short.
 */
export const RECEIPT_LABEL_CLASS = "min-w-0 wrap-anywhere";

/** The variant's own muted line, nested inside the label cell. */
export const RECEIPT_VARIANT_CLASS = "block text-muted-foreground";
