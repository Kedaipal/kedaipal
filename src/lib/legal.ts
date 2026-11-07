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
export const PRIVACY_VERSION = "2026-11-02";
export const AUP_VERSION = "2026-10-01";

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

/** A legal document the seller re-accepts, in the order the banner names them. */
export type LegalDocument = "terms" | "privacy" | "aup";

/**
 * The documents whose current version the retailer has NOT accepted (bumped,
 * or never accepted), in display order. The re-acceptance banner names exactly
 * these: telling every seller that their Terms and AUP changed when only the
 * Privacy Policy did is a false statement about a legal document.
 */
export function staleLegalDocuments(
	accepted: AcceptedLegalVersions,
): LegalDocument[] {
	const stale: LegalDocument[] = [];
	if (accepted.termsVersion !== TERMS_VERSION) stale.push("terms");
	if (accepted.privacyVersion !== PRIVACY_VERSION) stale.push("privacy");
	if (accepted.aupVersion !== AUP_VERSION) stale.push("aup");
	return stale;
}

/**
 * Returns true when any document was bumped (or never accepted). Used to gate
 * the re-acceptance banner in the dashboard.
 */
export function consentIsStale(accepted: AcceptedLegalVersions): boolean {
	return staleLegalDocuments(accepted).length > 0;
}
