/**
 * Auto-open-on-scan helpers for Counter Checkout (86ey5neg6).
 *
 * When the cashier has the store-QR dialog open and a buyer scans it, a new
 * `store_qr` session lands in `listOpenSessions`. Instead of making the cashier
 * close the dialog and hunt for the new card, we diff the live list against a
 * baseline snapshot taken when the dialog opened, and jump straight into the
 * first walk-in that wasn't there before.
 *
 * Pure + list-shape-only so the diff logic is unit-testable without React/Convex.
 */

type OpenSessionLike = {
	sessionId: string;
	origin: "cashier" | "store_qr";
};

/**
 * The set of currently-open walk-in (store-QR) session ids — the baseline the
 * dialog captures when it opens. Manual-phone / anonymous (`cashier`) sessions
 * are excluded: they're created by the cashier's own action, which already
 * navigates into them, so they must never trigger an auto-open here.
 */
export function walkInSessionIds(
	sessions: readonly OpenSessionLike[],
): Set<string> {
	const ids = new Set<string>();
	for (const s of sessions) {
		if (s.origin === "store_qr") ids.add(s.sessionId);
	}
	return ids;
}

/**
 * The first walk-in session present now but absent from `baseline` — the buyer
 * who just scanned — or `null` if nothing new arrived. `listOpenSessions` is
 * sorted most-recently-active first, so a fresh scan sorts to the front and is
 * returned first.
 */
export function newWalkInSince(
	sessions: readonly OpenSessionLike[],
	baseline: ReadonlySet<string>,
): string | null {
	for (const s of sessions) {
		if (s.origin === "store_qr" && !baseline.has(s.sessionId)) {
			return s.sessionId;
		}
	}
	return null;
}
