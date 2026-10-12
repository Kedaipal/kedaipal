import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { GATED_CELL_LABEL } from "../../convex/lib/credits";

/**
 * Why a bulk status change skipped rows, in the seller's words.
 *
 * This is a module rather than four inline ternaries in the inbox route
 * because the inline version silently lost one. `bulkUpdateStatus` grew a
 * `skippedCreditGated` counter for Credits T3.1, the route never read it, and
 * the toast shipped as "Updated 1 · skipped 1" with no reason — the exact
 * silent skip the house no-silent-skip rule exists to stop. The server test
 * asserted the counter was RETURNED, which is why a green suite missed that
 * nothing consumed it.
 *
 * So the completeness is now a TYPE. `SkipCounter` is derived from the
 * function's own return type, and `SKIP_PHRASES` is a `Record` over it: add a
 * `skipped*` counter to `convex/orders.ts` and this file fails to compile
 * until it has a phrase. Forgetting is no longer possible, which is worth more
 * than any test asserting today's four.
 */
type BulkResult = FunctionReturnType<typeof api.orders.bulkUpdateStatus>;

/**
 * Every per-reason counter the server reports. `skipped` itself is the TOTAL,
 * so it is excluded — it is the number the toast leads with, not a reason.
 */
export type SkipCounter = Exclude<
	Extract<keyof BulkResult, `skipped${string}`>,
	"skipped"
>;

/**
 * One phrase per counter. Key order IS display order (object key order is
 * insertion order for string keys), and `bulk-skip-reasons.test.ts` pins it —
 * credits first, because it is the only one of these the seller can clear,
 * and the only one with a price attached.
 */
const SKIP_PHRASES: Record<SkipCounter, (n: number) => string> = {
	// Credits T3.1. Lower-cased from the label so it reads inside the toast's
	// parenthetical ("skipped 2 (1 waiting on credits, 1 already cancelled)")
	// while still being the one phrase the rest of the app uses.
	skippedCreditGated: (n) => `${n} ${GATED_CELL_LABEL.toLowerCase()}`,
	skippedAwaitingCollection: (n) => `${n} still with your customer`,
	skippedRiderManaged: (n) => `${n} with a rider on the way`,
	// Cancelled orders can't be reopened — their stock is already back
	// (86eypn8ye). Named so the seller learns the rule rather than re-selecting
	// the same rows and watching nothing happen.
	skippedCancelled: (n) => `${n} already cancelled`,
	// A booking is never "Packed"; an RSVP is never "Packed" or "Ready for
	// Pickup" — those stages don't exist for them.
	skippedNoSuchStage: (n) => `${n} without that stage (bookings/RSVPs)`,
};

/**
 * The toast line for a bulk status change. A bare "skipped 2" leaves the
 * seller guessing why their action half-worked, so every skip names itself.
 */
export function bulkStatusToast(res: BulkResult): string {
	if (res.skipped <= 0)
		return `Updated ${res.updated} order${res.updated === 1 ? "" : "s"}`;
	const reasons = (Object.keys(SKIP_PHRASES) as SkipCounter[])
		.filter((key) => res[key] > 0)
		.map((key) => SKIP_PHRASES[key](res[key]));
	const why = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
	return `Updated ${res.updated} · skipped ${res.skipped}${why}`;
}
