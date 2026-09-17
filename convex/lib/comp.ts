// Comp accounts (z8r3fdeub2) — the pure catalog shared by the server
// (subscriptions.setComp validation) and the client (the admin comp dialog,
// chips, the seller billing tab). No Convex imports, mirroring lib/plans.ts.
//
// A comp is a SUBSCRIPTION STATE, not a user type, and it is a TOGGLE: an
// admin turns the "comp upgrade" on for a store and it stays on until an admin
// turns it off — there is no end date. While on, the store gets exactly what a
// Kedaipal admin's own store gets (`FULL_ACCESS_PLAN` features +
// `fullAccessCaps()`, lib/plans.ts), is never billed, and has nothing to
// subscribe to, change, pause or cancel — just no admin access. Turning it off
// makes the store an EXPIRED seller: `past_due` with no invoice, the same lock
// a lapsed subscription is in (storefront + buyer ordering live, growth-writes
// refused until the seller picks a plan and pays).

export type CompKind = "partner" | "sponsor" | "pilot" | "internal";

export const COMP_KINDS: CompKind[] = [
	"partner",
	"sponsor",
	"pilot",
	"internal",
];

/** Dialog + chip label per kind — capitalised, in the admin's words. */
export const COMP_KIND_LABEL: Record<CompKind, string> = {
	partner: "Partner",
	sponsor: "Sponsor",
	pilot: "Pilot",
	internal: "Internal",
};

/** Seller-facing sponsor line, e.g. "Sponsored by Maybank SME". Short enough
 * for the directory chip and the billing tab's one-liner. */
export const COMP_LABEL_MAX = 60;

/** Admin-only context (deal terms, contact person). Never on seller payloads. */
export const COMP_NOTE_MAX = 500;
