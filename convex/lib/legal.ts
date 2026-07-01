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
export const PRIVACY_VERSION = "2026-07-01";
export const AUP_VERSION = "2026-05-26";

/** Contact address shown in Terms, Privacy, and the AUP. */
export const LEGAL_CONTACT_EMAIL = "hello@kedaipal.com";
