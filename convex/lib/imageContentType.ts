import type { Id } from "../_generated/dataModel";

/**
 * Server-side check that a stored blob is something a browser can actually
 * render (ClickUp 86eyr6zm8).
 *
 * The client already refuses undecodable uploads by decoding them before they
 * are sent (`src/lib/image-upload.ts`), which covers every real user. This
 * exists for the one place that has a genuine trust boundary: the buyer's
 * payment proof. A buyer supplies it, a SELLER has to look at it to decide
 * whether money arrived, and the two are different people — so the seller's
 * ability to do their job shouldn't depend on the buyer's browser having
 * behaved. Everywhere else a seller uploads to their own store, where the only
 * person a bad file hurts is the uploader.
 *
 * Content types are the ones Convex records at upload from the request's
 * `Content-Type`. It's a coarse check — it trusts the declared type rather than
 * sniffing the bytes — but it costs one system read and closes the "crafted API
 * call" gap that the client guard structurally cannot.
 */
export const RENDERABLE_IMAGE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
	"image/gif",
	"image/svg+xml",
] as const;

export function isRenderableImageType(contentType: string | undefined | null): boolean {
	if (!contentType) return false;
	// Strip any `; charset=…` parameter before comparing.
	const base = contentType.split(";")[0].trim().toLowerCase();
	return (RENDERABLE_IMAGE_TYPES as readonly string[]).includes(base);
}

/** Message shown to the buyer when their proof isn't a renderable image. */
export const UNRENDERABLE_PROOF_MESSAGE =
	"That screenshot is in a format we can't display — iPhone photos (.HEIC) are the usual cause. Please upload a JPEG or PNG instead.";

type SystemReader = {
	db: { system: { get: (id: Id<"_storage">) => Promise<{ contentType?: string } | null> } };
};

/**
 * True unless the stored blob is *known* to be unrenderable.
 *
 * Deliberately fails OPEN on a missing row or a missing content type. This
 * guard sits in front of a buyer claiming they have paid, and the two errors
 * are not symmetric: wrongly blocking that claim stops a real payment from
 * being recorded, while wrongly allowing one shows the seller a broken image —
 * which is exactly the status quo this ticket improves on, not a regression.
 * So only a content type we can positively identify as unrenderable is refused.
 */
export async function isStoredImageRenderable(
	ctx: SystemReader,
	storageId: Id<"_storage">,
): Promise<boolean> {
	// A malformed id string throws rather than returning null (the arg is
	// `v.string()`, so a crafted direct call can pass anything). The fail-open
	// promise below should cover that too — an abuser getting a raw internal
	// error instead of the buyer-facing message helps nobody.
	let contentType: string | undefined;
	try {
		const meta = await ctx.db.system.get(storageId);
		contentType = meta?.contentType;
	} catch {
		return true;
	}
	if (!contentType) return true;
	return isRenderableImageType(contentType);
}
