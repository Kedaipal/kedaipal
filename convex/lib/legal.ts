/**
 * Legal document versions and contact details — single source of truth.
 *
 * IMPORTANT: Keep in sync with `src/lib/legal.ts`. Both files must stay
 * identical in their version/contact values — they exist separately because
 * Convex functions bundle from the `convex/` directory and the frontend
 * bundles from `src/`.
 *
 * Bump a version string here (and in the mirror) when a document's content
 * materially changes. createRetailer / recordConsentAcceptance stamp these
 * server-side onto the retailer, and `consentIsStale` compares stored versions
 * against them to trigger the re-acceptance banner.
 *
 * Versions are ISO dates (YYYY-MM-DD), matching the "Last updated" shown on
 * each legal page.
 */

// 2026-09-30 (Credits T5, z8r3fdfu31): added "Kedaipal Credits" (what a credit
// is, non-transferable, never cash, plan vs purchased expiry, the refund rule,
// the negative balance, restrictions at zero, buying credits — never
// automatic, never on the saved card (T4 auto top-up was cancelled 1 Oct
// 2026, before this version shipped) — price changes) and
// "Data Processing" (merchant = controller, Kedaipal = processor, security,
// breach notice, sub-processor categories, Kedaipal Pte Ltd + transfers).
// Drafted for Arif's / a lawyer's sign-off. Every store owner re-accepts.
export const TERMS_VERSION = "2026-09-30";
// 2026-08-04: added Microsoft Clarity (session replay) as a sub-processor, and
// disclosed session-recording collection + analytics cookies.
// 2026-08-17 (86eyn25fu, PDPA audit truth pass): processor list corrected to
// what actually ships (added Lalamove + Google, HitPay re-scoped to shopper
// payments; dropped unshipped PostHog/Stripe/Calendly), disclosed the
// localStorage address autofill, named Kedaipal as data user for analytics +
// the global opt-out list, added the SG PDPA line (SG-incorporated operator)
// and the DPO designation, and dropped the never-populated acceptanceIp field.
export const PRIVACY_VERSION = "2026-08-17";
// 2026-10-01 (Credits T6, z8r3fdkp8h): the 50-numbers-in-5-minutes rule
// exempted "the Scale tier", retired before it went public (it exempted
// nobody). A higher limit is now "agreed with you in writing" — how an
// Enterprise contract carries one — never a tier name. For Arif's sign-off;
// released alongside the T5 Terms bump, so it's the same one re-acceptance.
export const AUP_VERSION = "2026-10-01";

/** Contact address shown in Terms, Privacy, and the AUP. */
export const LEGAL_CONTACT_EMAIL = "hello@kedaipal.com";
