/**
 * Customer display helpers for the dashboard — re-exported from
 * `convex/lib/customer.ts`, the one author. This used to be a hand-kept mirror
 * ("keep in sync"), which is how the two sides would have drifted the first
 * time the phone format changed; the module is pure (its only Convex import is
 * the `ConvexError` class the client already bundles), so there is nothing to
 * mirror around.
 */

export {
	type DisplayableCustomer,
	formatPhone,
	getDisplayName,
	orderCustomerLabel,
} from "../../convex/lib/customer";
