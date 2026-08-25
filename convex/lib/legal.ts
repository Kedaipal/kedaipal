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

export const TERMS_VERSION = "2026-07-01";
// 2026-08-04: added Microsoft Clarity (session replay) as a sub-processor, and
// disclosed session-recording collection + analytics cookies.
// 2026-08-17 (86eyn25fu, PDPA audit truth pass): processor list corrected to
// what actually ships (added Lalamove + Google, HitPay re-scoped to shopper
// payments; dropped unshipped PostHog/Stripe/Calendly), disclosed the
// localStorage address autofill, named Kedaipal as data user for analytics +
// the global opt-out list, added the SG PDPA line (SG-incorporated operator)
// and the DPO designation, and dropped the never-populated acceptanceIp field.
export const PRIVACY_VERSION = "2026-08-17";
export const AUP_VERSION = "2026-05-26";

/** Contact address shown in Terms, Privacy, and the AUP. */
export const LEGAL_CONTACT_EMAIL = "hello@kedaipal.com";
