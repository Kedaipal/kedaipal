/**
 * One image upload, start to finish, with every step BOUNDED (ClickUp
 * z8r3fdtk85).
 *
 * The bug this exists for: during the Campfest admin pass a product photo
 * tile sat on "Uploading…" forever and DevTools showed no upload request at
 * all. Prod was quiet at the time (single-digit uploads an hour), so it was not
 * a busy server — it was a step that never settled. Every upload site ran the
 * same four awaits: prepare the image (`img.decode()` + `canvas.toBlob`), mint
 * an upload URL (a Convex mutation, which the client QUEUES while its socket is
 * reconnecting or its auth token is refreshing — and which, riding the
 * WebSocket, never appears as a request in the Network tab), POST the bytes,
 * read the storage id. None had a deadline, so any one of them stalling left a
 * spinner with nothing behind it and the `catch` never ran.
 *
 * So every step here races a deadline, and the answer is always one of two
 * shapes: the storage id, or a sentence the person can act on plus whether a
 * retry can help. A spinner can now only ever mean work that is happening.
 *
 * Every image upload in the app goes through this — eleven sites used to carry
 * their own copy of the four awaits, which is how none of them got a deadline.
 */

import { isRateLimitError } from "@convex-dev/rate-limiter";
import { convexErrorMessage } from "./format";
import {
	type ImageRejectReason,
	type PreparedImage,
	prepareImageUpload,
} from "./image-upload";

/** Decoding + re-encoding a 25 MB phone photo on a low-end phone takes a few
 * seconds; thirty means it is stuck, not slow. */
export const PREPARE_TIMEOUT_MS = 30_000;
/** Minting the URL is one small mutation. Twenty seconds without an answer is
 * a socket that isn't coming back on its own. */
export const MINT_TIMEOUT_MS = 20_000;
/** The POST carries the bytes. A prepared image is at most a few hundred KB
 * (passthrough GIF/SVG cap at 5 MB), so ninety seconds covers weak mobile data
 * with room to spare. */
export const POST_TIMEOUT_MS = 90_000;

export type UploadStep = "prepare" | "mint" | "post";

export type UploadedImage = {
	ok: true;
	storageId: string;
	/** The bytes actually stored — preview THESE, not the picked file (a
	 * converted file and its original differ). */
	blob: Blob;
};

/**
 * Why an upload stopped, for a surface that speaks its own words (the buyer's
 * payment-proof dialog is bilingual). Everything else uses `message`.
 */
export type UploadFailureReason =
	| { kind: "rejected"; reject: ImageRejectReason }
	| { kind: "timeout"; step: UploadStep }
	| { kind: "offline" }
	| { kind: "refused"; rateLimited: boolean }
	| { kind: "transport" };

export type FailedUpload = {
	ok: false;
	reason: UploadFailureReason;
	/** Can tapping Retry plausibly work? False for a file we refuse (HEIC, too
	 * large) or a server refusal that names its own fix (a locked store) —
	 * offering Retry there would be a wrong-but-enabled button. */
	retryable: boolean;
	/** The sentence to show: what happened and what to do. */
	message: string;
};

export type UploadResult = UploadedImage | FailedUpload;

class StepTimeout extends Error {
	constructor(readonly step: UploadStep) {
		super(`upload step "${step}" timed out`);
	}
}

/** A mint that the SERVER refused (as opposed to one that never answered). */
class MintRefused extends Error {
	constructor(readonly refusal: unknown) {
		super("upload URL refused");
	}
}

/**
 * Race `promise` against a deadline. The losing promise is abandoned, not
 * cancelled — a mint that answers late only leaves an unused upload URL,
 * which expires by itself.
 */
function withDeadline<T>(
	promise: Promise<T>,
	ms: number,
	step: UploadStep,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new StepTimeout(step)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

const TIMEOUT_MESSAGE: Record<UploadStep, string> = {
	prepare:
		"This photo took too long to process. Try again, or use a smaller photo.",
	mint: "Couldn't reach Kedaipal to start the upload. Check your connection and try again.",
	post: "The upload took too long. Check your connection and try again.",
};

const OFFLINE_MESSAGE =
	"You're offline. Reconnect and try again — nothing was uploaded.";

const TRANSPORT_MESSAGE =
	"The upload didn't go through. Check your connection and try again.";

/** What went wrong, in words, and whether Retry can help. */
function failure(err: unknown): FailedUpload {
	if (err instanceof StepTimeout) {
		return {
			ok: false,
			reason: { kind: "timeout", step: err.step },
			retryable: true,
			message: TIMEOUT_MESSAGE[err.step],
		};
	}
	// The server answered "no". The rate limiter's refusal says "try again in
	// Ns", so Retry is honest; any other refusal (a view-only store, signed
	// out) names a fix that isn't "tap again".
	if (err instanceof MintRefused) {
		const rateLimited = isRateLimitError(err.refusal);
		return {
			ok: false,
			reason: { kind: "refused", rateLimited },
			retryable: rateLimited,
			message: convexErrorMessage(err.refusal),
		};
	}
	// Anything else is transport: a dropped connection, a non-2xx from storage,
	// a body that wasn't JSON. All worth one more tap.
	return {
		ok: false,
		reason: { kind: "transport" },
		retryable: true,
		message: TRANSPORT_MESSAGE,
	};
}

function isOffline(): boolean {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * `prepareImageUpload` with a deadline: the decoded-and-shrunk bytes, or why
 * not. For a site that must prepare a whole set before uploading any of it
 * (the order mockup) or check the prepared size (the payment proof).
 */
export async function prepareImage(
	file: File,
): Promise<PreparedImage | FailedUpload> {
	try {
		const prepared = await withDeadline(
			prepareImageUpload(file),
			PREPARE_TIMEOUT_MS,
			"prepare",
		);
		if (prepared.ok) return prepared;
		// The file itself is the problem — no retry fixes a HEIC.
		return {
			ok: false,
			reason: { kind: "rejected", reject: prepared.reason },
			retryable: false,
			message: prepared.message,
		};
	} catch (err) {
		return failure(err);
	}
}

/**
 * Mint a URL with `mintUrl`, POST already-prepared bytes, return the storage
 * id. Never throws and never hangs.
 */
export async function uploadPrepared(
	prepared: PreparedImage,
	mintUrl: () => Promise<string>,
): Promise<UploadResult> {
	// Fail fast rather than wait out the mint deadline on a phone that has
	// plainly lost signal.
	if (isOffline()) {
		return {
			ok: false,
			reason: { kind: "offline" },
			retryable: true,
			message: OFFLINE_MESSAGE,
		};
	}
	try {
		const url = await withDeadline(
			mintUrl().catch((err: unknown) => {
				throw new MintRefused(err);
			}),
			MINT_TIMEOUT_MS,
			"mint",
		);

		const abort = new AbortController();
		const body = await withDeadline(
			(async () => {
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": prepared.contentType },
					body: prepared.blob,
					signal: abort.signal,
				});
				if (!res.ok) throw new Error(`storage answered ${res.status}`);
				return (await res.json()) as { storageId?: unknown };
			})(),
			POST_TIMEOUT_MS,
			"post",
		).catch((err: unknown) => {
			// Stop the bytes still going up after we've given up on them.
			abort.abort();
			throw err;
		});
		// Validate the shape before trusting it — an error body would otherwise
		// store `undefined` as a storage id and only surface server-side.
		if (typeof body.storageId !== "string") {
			throw new Error("storage answered without a storageId");
		}
		return { ok: true, storageId: body.storageId, blob: prepared.blob };
	} catch (err) {
		return failure(err);
	}
}

/**
 * Prepare `file`, then upload it — the whole trip, every step bounded. Never
 * throws and never hangs: every path ends in an `UploadResult` within the sum
 * of the step deadlines.
 */
export async function uploadImage(
	file: File,
	mintUrl: () => Promise<string>,
): Promise<UploadResult> {
	const prepared = await prepareImage(file);
	if (!prepared.ok) return prepared;
	return uploadPrepared(prepared, mintUrl);
}
