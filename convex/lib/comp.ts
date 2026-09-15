// Comp accounts (z8r3fdeub2) — the pure catalog shared by the server
// (subscriptions.setComp validation) and the client (the admin comp dialog,
// chips, the seller billing tab). No Convex imports, mirroring lib/plans.ts.
//
// A comp is a SUBSCRIPTION STATE, not a user type: `subscriptions.comped` is
// the read seam every consumer already gates on (cron skips, self-serve
// refuses, meter hides), and the `comp` object stamps who/why/until so an
// admin grant survives the backfill and can expire on a date.

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
