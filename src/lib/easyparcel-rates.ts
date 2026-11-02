/**
 * The dispatch card's courier-choosing rules. They live in
 * `convex/lib/easyparcelRates.ts` because the CHECKOUT prices the same
 * service the card pre-selects (z8r3fdr5yy) — one author, so the fee the
 * buyer pays and the booking the seller is offered can't drift.
 */
export * from "../../convex/lib/easyparcelRates";
