/**
 * "Has the seller changed anything?" for the product form (z8r3fdtk82).
 *
 * The form keeps ~20 separate pieces of state, and the one place that
 * already gathers every one of them is the draft getter (`ProductFormDraft`)
 * the Preview and the wizard switch read. Dirtiness is that draft compared
 * against the draft the form opened with, so a field added to the draft is
 * covered here without anyone remembering to list it.
 *
 * Preview URLs are left out on purpose: a freshly uploaded photo previews
 * from a `blob:` URL while the saved copy has a storage URL, and the same
 * photo must not read as a change just because its preview moved. The
 * storage ID is what gets saved, and the storage ID is what's compared.
 */

import type { ProductFormDraft } from "../components/forms/product-form";

const PREVIEW_URL_KEYS = new Set(["url", "imageUrl", "imageUrls"]);

export function draftFingerprint(draft: ProductFormDraft): string {
	return JSON.stringify(draft, (key, value) =>
		PREVIEW_URL_KEYS.has(key) ? undefined : value,
	);
}

export function isDraftDirty(
	baseline: ProductFormDraft,
	current: ProductFormDraft,
): boolean {
	return draftFingerprint(baseline) !== draftFingerprint(current);
}

/** What leaving the form right now would throw away. */
export type UnsavedState = "none" | "changes" | "uploading";
