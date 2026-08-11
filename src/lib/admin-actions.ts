// Client-side visibility rules for Kedaipal-admin-only actions. These mirror a
// server guard and are never the guard themselves — the server rejects a
// non-admin caller regardless of what the dashboard chose to render. Keeping the
// rule here (rather than inline in each route) means the two hard-delete surfaces
// — order detail and the inbox bulk bar — can't drift apart.

/**
 * Whether to show the permanent-erase actions ("Delete permanently" on order
 * detail, the inbox bulk-bar item). Mirrors the server gate on
 * `orders.deleteOrder` / `orders.bulkDeleteOrders`, which is admin MEMBERSHIP
 * (`isAdmin`), not act-as: an admin may erase in ANY store, including one they
 * personally own.
 *
 * Both inputs are accepted because neither alone is right:
 * - `actingAsAdmin` (from the retailer payload) is the fast path — another
 *   store's order detail renders the action with no extra round-trip — but it is
 *   `false` when an admin views their OWN store, which resolves through
 *   `requireRetailerAccess`'s owner branch.
 * - `amIAdmin` (`api.billing.amIAdmin`) covers that own-store case, but is
 *   `undefined` until the query resolves.
 *
 * Undefined on both sides means "not yet known" and yields `false`, so the
 * action never flashes in for a plain seller mid-load. ClickUp `86eyhz189`.
 */
export function canHardDeleteOrders(input: {
	actingAsAdmin?: boolean;
	amIAdmin?: boolean;
}): boolean {
	return input.actingAsAdmin === true || input.amIAdmin === true;
}
