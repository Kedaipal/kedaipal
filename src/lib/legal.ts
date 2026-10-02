/**
 * Legal document versions, contact details, and the consent-staleness helper.
 *
 * IMPORTANT: Keep the version/contact values in sync with `convex/lib/legal.ts`
 * (the server-side source of truth). They exist separately because Convex
 * functions bundle from the `convex/` directory and the frontend bundles from
 * `src/`.
 *
 * Versions are ISO dates (YYYY-MM-DD), matching the "Last updated" shown on
 * each legal page.
 */

export const TERMS_VERSION = "2026-09-30";
export const PRIVACY_VERSION = "2026-08-17";
export const AUP_VERSION = "2026-05-26";

/** Contact address shown in Terms, Privacy, and the AUP. */
export const LEGAL_CONTACT_EMAIL = "hello@kedaipal.com";

/**
 * Section anchors other surfaces deep-link to. A contract, not decoration:
 * the credit top-up picker (Credits T2) links `/terms#credits`, and the
 * Terms' data-processing section links the Privacy Policy's processor list —
 * renaming an id here moves every link with it.
 */
export const TERMS_ANCHOR = {
	credits: "credits",
	dataProcessing: "data-processing",
} as const;

export const PRIVACY_ANCHOR = {
	processors: "processors",
} as const;

/** Versions a retailer has accepted, as stored on the retailer record. */
export type AcceptedLegalVersions = {
	termsVersion?: string;
	privacyVersion?: string;
	aupVersion?: string;
};

/**
 * Returns true when the retailer's accepted versions don't all match the
 * current document versions — i.e. any document was bumped (or never accepted).
 * Used to gate the re-acceptance banner in the dashboard.
 */
export function consentIsStale(accepted: AcceptedLegalVersions): boolean {
	return (
		accepted.termsVersion !== TERMS_VERSION ||
		accepted.privacyVersion !== PRIVACY_VERSION ||
		accepted.aupVersion !== AUP_VERSION
	);
}
