/**
 * Upload-side image validation + normalization (ClickUp 86eyr6zm8).
 *
 * The bug this exists for: a seller uploaded `IMG_0056.HEIC` straight from a
 * Mac's Downloads folder. It stored fine and then rendered as a broken image.
 * HEIC is not a web image format — no browser except Safari can decode it in an
 * `<img>` — and macOS Finder shows a thumbnail because the OS decodes it
 * natively, so it looks like a perfectly good photo right up until it hits the
 * page. `accept="image/*"` does not exclude it.
 *
 * Neither image PR can save this downstream. The retry (86eypxgff) correctly
 * retries and then gives up, because there is nothing to recover — the bytes
 * are undecodable. The Cloudflare proxy (86eypxght) can't be relied on either:
 * its whole safety property is that an un-runnable transform returns the
 * ORIGINAL bytes, and the original is the thing that doesn't render.
 *
 * So the rule here is: **we never store bytes we haven't proven this browser
 * can decode.** We prove it the only way that actually answers the question —
 * by decoding the file the same way an `<img>` will, and refusing anything that
 * fails. That's deliberately a capability test rather than a format allowlist:
 * an allowlist only ever knows about the formats we thought of, and HEIC is
 * precisely the format nobody thought of.
 */

/** Pre-decode sanity ceiling. Stops us handing a 200 MB file to the decoder. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Ceiling for formats we deliberately don't re-encode (see PASSTHROUGH_TYPES). */
export const MAX_PASSTHROUGH_BYTES = 5 * 1024 * 1024;

/**
 * Longest edge we keep. Comfortably above every surface that renders one
 * (the widest is the full-bleed store cover) while cutting a modern phone
 * photo — routinely 3000–8000 px — down by an order of magnitude.
 */
export const MAX_IMAGE_EDGE = 1600;

const WEBP_QUALITY = 0.82;

/**
 * Fallback encoder quality. Only used when the browser can't encode WebP —
 * `canvas.toBlob` is specified to silently fall back to PNG for an unsupported
 * type, and a 1600px PNG of a photograph is megabytes, which would quietly undo
 * the entire point of normalizing on exactly the platform our sellers use most.
 */
const JPEG_QUALITY = 0.82;

/**
 * Source formats we may keep BYTE-FOR-BYTE when re-encoding would make the file
 * bigger and no resize was needed.
 *
 * A positive allowlist, not an exclusion list. The earlier shape of this check
 * excluded `image/heic` by name, which is the same allowlist-shaped mistake the
 * decode test exists to avoid — it only knows the format someone thought of.
 * Safari decodes HEIF and TIFF too, so both would pass the decode test and then
 * be kept as-is, storing bytes Chrome can't render: precisely the bug this
 * module was written to kill. Listing what is safe to keep makes
 * "we never store bytes other browsers can't decode" true by construction.
 *
 * These are `IMAGE_ACCEPT` minus the passthrough types, which never reach here.
 */
const KEEP_ORIGINAL_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
] as const;

/**
 * Formats with no alpha channel to lose, so a JPEG fallback is safe.
 *
 * PNG/WebP/AVIF sources may carry transparency — a store logo especially — and
 * JPEG would flatten it onto black. Those keep whatever the encoder produced.
 */
const ALPHA_FREE_SOURCE_TYPES = ["image/jpeg", "image/heic", "image/heif"];

/**
 * Formats we store byte-for-byte instead of re-encoding.
 *
 * SVG is vector — drawing it to a canvas would rasterize it and throw away the
 * only reason to use one. GIF may be animated, and a canvas re-encode silently
 * keeps just the first frame, which is a worse bug than the weight it saves.
 * Both are size-capped instead.
 */
export const PASSTHROUGH_TYPES = ["image/svg+xml", "image/gif"] as const;

/**
 * `accept` for file inputs.
 *
 * Deliberately explicit rather than `image/*`: the OS picker greys out `.HEIC`
 * instead of offering a file we're about to refuse, which is the earliest and
 * clearest possible feedback. The runtime decode test below still stands behind
 * it, because drag-and-drop and the picker's "All Files" escape hatch bypass
 * `accept` entirely.
 */
export const IMAGE_ACCEPT =
	"image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml";

export type ImageRejectReason =
	| "not_an_image"
	| "undecodable"
	| "too_large"
	| "encode_failed";

export type PreparedImage = {
	ok: true;
	/** What to upload. Either a re-encoded WebP or the original file. */
	blob: Blob;
	contentType: string;
	/** True when the bytes were re-encoded rather than passed through. */
	normalized: boolean;
};

export type RejectedImage = {
	ok: false;
	reason: ImageRejectReason;
	message: string;
};

/** Human-facing reason. Every rejection names the fix, not just the problem. */
export function imageRejectMessage(
	reason: ImageRejectReason,
	fileName?: string,
): string {
	const named = fileName ? `"${fileName}"` : "That file";
	switch (reason) {
		case "not_an_image":
			return `${named} isn't an image.`;
		case "undecodable":
			// By far the most common cause, and the one worth naming outright:
			// a photo straight off an iPhone. Telling someone "unsupported
			// format" leaves them stuck; telling them which menu converts it
			// does not.
			return `${named} is in a format browsers can't show — iPhone photos (.HEIC) are the usual cause. Open it in Preview and choose File → Export as JPEG, then upload that.`;
		case "too_large":
			return `${named} is too large. Please use an image under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
		case "encode_failed":
			return `${named} couldn't be processed. Try saving it as a JPEG or PNG first.`;
	}
}

export function isPassthroughType(type: string): boolean {
	return (PASSTHROUGH_TYPES as readonly string[]).includes(type);
}

/**
 * Scaled dimensions with the aspect ratio preserved, never upscaling — spending
 * bytes to invent pixels is the one thing a resize must not do.
 */
export function targetDimensions(
	width: number,
	height: number,
	maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge) return { width, height };
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * May we store `file`'s ORIGINAL bytes untouched?
 *
 * Only when it needed no resize, re-encoding gained nothing, and the format is
 * one every browser renders. The last clause is the load-bearing one — see
 * `KEEP_ORIGINAL_TYPES`.
 */
export function canKeepOriginal(
	fileType: string,
	resized: boolean,
	encodedSize: number,
	originalSize: number,
): boolean {
	if (resized) return false;
	if (encodedSize < originalSize) return false;
	return (KEEP_ORIGINAL_TYPES as readonly string[]).includes(fileType);
}

/**
 * The encoder returned something other than what we asked for (`toBlob` falls
 * back to PNG silently). Should we try JPEG instead?
 *
 * Only for sources with no alpha to lose. A transparent PNG or WebP keeps the
 * encoder's own output — flattening a store logo onto black to save bytes is a
 * worse outcome than the bytes.
 */
export function shouldTryJpegFallback(
	fileType: string,
	encodedType: string,
): boolean {
	if (encodedType === "image/webp") return false;
	return ALPHA_FREE_SOURCE_TYPES.includes(fileType);
}

/**
 * Decode `file` the way an `<img>` will, then re-encode it small.
 *
 * Resolves to the blob to upload, or a rejection naming what to do about it.
 * On Safari — which *can* decode HEIC — a HEIC file sails through this and
 * comes out the other side as a WebP, so those users get HEIC support for free
 * rather than a refusal.
 */
export async function prepareImageUpload(
	file: File,
): Promise<PreparedImage | RejectedImage> {
	const reject = (reason: ImageRejectReason): RejectedImage => ({
		ok: false,
		reason,
		message: imageRejectMessage(reason, file.name),
	});

	// A declared non-image type is refused outright, but an EMPTY type is not:
	// some pickers and drag sources supply none, and the decode below is a
	// stricter, more honest test than the label anyway. Judging on the label
	// alone is the habit this module exists to break.
	if (file.type !== "" && !file.type.startsWith("image/")) {
		return reject("not_an_image");
	}

	if (isPassthroughType(file.type)) {
		if (file.size > MAX_PASSTHROUGH_BYTES) return reject("too_large");
		return { ok: true, blob: file, contentType: file.type, normalized: false };
	}

	if (file.size > MAX_UPLOAD_BYTES) return reject("too_large");

	const objectUrl = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = objectUrl;
		// `decode()` is the faithful test: it succeeds exactly when an <img>
		// would render the file, and rejects on a format the browser can't read.
		try {
			await img.decode();
		} catch {
			return reject("undecodable");
		}

		const { width, height } = targetDimensions(
			img.naturalWidth,
			img.naturalHeight,
		);
		if (!width || !height) return reject("undecodable");

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return reject("encode_failed");
		ctx.drawImage(img, 0, 0, width, height);

		const encode = (type: string, quality: number) =>
			new Promise<Blob | null>((resolve) => {
				canvas.toBlob((b) => resolve(b), type, quality);
			});

		let encoded = await encode("image/webp", WEBP_QUALITY);

		// `canvas.toBlob` is specified to fall back to PNG *silently* when it
		// can't encode the requested type — the only way to know what you got is
		// to read the blob back. A 1600px PNG of a photo is megabytes, so on a
		// browser without WebP encoding this would store something far larger
		// than the WebP we claimed, while labelling it `image/webp`.
		// A source that may carry alpha is excluded from the fallback by
		// `shouldTryJpegFallback` and keeps whatever the encoder produced.
		if (encoded && shouldTryJpegFallback(file.type, encoded.type)) {
			const jpeg = await encode("image/jpeg", JPEG_QUALITY);
			// JPEG at this size still gets most of the win, and every browser can
			// encode it. Only take it if it's genuinely smaller.
			if (jpeg && jpeg.type === "image/jpeg" && jpeg.size < encoded.size) {
				encoded = jpeg;
			}
		}

		if (!encoded || encoded.size === 0) return reject("encode_failed");
		// Without a type we cannot label the upload honestly, and this module has
		// just made declared content types load-bearing (the server's
		// `isStoredImageRenderable` trusts them). Refuse rather than guess.
		if (!encoded.type) return reject("encode_failed");

		// Re-encoding can occasionally make an already-tight file bigger. When
		// the original needed no resize AND is a format every browser renders,
		// keep it — the point is to never ship MORE bytes than we were given.
		const resized = width !== img.naturalWidth || height !== img.naturalHeight;
		if (canKeepOriginal(file.type, resized, encoded.size, file.size)) {
			return {
				ok: true,
				blob: file,
				contentType: file.type,
				normalized: false,
			};
		}

		return {
			ok: true,
			blob: encoded,
			// The encoder's ACTUAL output, never an assumption.
			contentType: encoded.type,
			normalized: true,
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
