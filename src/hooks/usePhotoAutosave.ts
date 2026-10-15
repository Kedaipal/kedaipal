import { isRateLimitError } from "@convex-dev/rate-limiter";
import { useEffect, useRef, useState } from "react";
import type { ProductImage } from "../components/forms/product-images-field";
import { convexErrorMessage, retryWait } from "../lib/format";

export type PhotoAutosaveStatus =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "saved" }
	/** Throttled: the photos save by themselves once the window reopens. */
	| { kind: "waiting"; wait: string }
	| { kind: "error"; message: string };

/** A beat past `retryAfter`, so the retry lands after the window reopens. */
const RETRY_MARGIN_MS = 500;

/**
 * Saves an existing product's photos as soon as they change (z8r3fdtk82).
 *
 * Sellers treat a photo that shows up on screen as saved, the way WhatsApp
 * and every marketplace app work. On a phone, a seller who switches to
 * WhatsApp can have the tab killed with no "Leave site?" prompt, so the leave
 * guard alone can't protect a photo. Saving it straight away does.
 *
 * Single-flight, latest wins: while one save is in the air, newer changes
 * wait as ONE pending list and go up when it lands. A quick run of drag
 * reorders becomes at most two writes, and photos can never land out of
 * order (an older list overwriting a newer one).
 *
 * Throttled by the `productWrite` limit (shared with every other product
 * write), it does NOT tell the seller to tap Save, because Save would be
 * refused by the same limit. It says when it will try again, then retries by
 * itself with the newest list. Changes made while it waits join that one
 * retry instead of each hitting the limit again.
 *
 * `onSaved` hands back the list the server now has, so the form can move its
 * "unchanged" baseline. A failed or waiting save leaves the baseline alone,
 * so the photos stay an unsaved change: Save changes still saves them, and
 * the leave guard still warns.
 */
export function usePhotoAutosave({
	save,
	onSaved,
}: {
	save: (imageStorageIds: string[]) => Promise<void>;
	onSaved: (images: ProductImage[]) => void;
}) {
	const [status, setStatus] = useState<PhotoAutosaveStatus>({ kind: "idle" });
	const inFlight = useRef(false);
	const pending = useRef<ProductImage[] | null>(null);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Leaving the page abandons a scheduled retry: the leave guard already
	// asked, and the seller chose to discard.
	useEffect(
		() => () => {
			if (retryTimer.current) clearTimeout(retryTimer.current);
		},
		[],
	);

	async function run(images: ProductImage[]): Promise<void> {
		if (inFlight.current || retryTimer.current) {
			pending.current = images;
			return;
		}
		inFlight.current = true;
		setStatus({ kind: "saving" });
		try {
			await save(images.map((i) => i.id));
			onSaved(images);
			// A queued newer list will overwrite this one, so only claim "saved"
			// once nothing is left waiting.
			if (pending.current === null) setStatus({ kind: "saved" });
		} catch (err) {
			if (isRateLimitError(err)) {
				// Keep the newest list and try once the window reopens.
				pending.current = pending.current ?? images;
				const after = err.data.retryAfter;
				setStatus({ kind: "waiting", wait: retryWait(after) });
				retryTimer.current = setTimeout(() => {
					retryTimer.current = null;
					const next = pending.current;
					pending.current = null;
					if (next) void run(next);
				}, after + RETRY_MARGIN_MS);
				return;
			}
			// Drop the queue too: it would hit the same refusal, and Save changes
			// sends the current list anyway.
			pending.current = null;
			setStatus({ kind: "error", message: convexErrorMessage(err) });
		} finally {
			inFlight.current = false;
		}
		const next = pending.current;
		if (next !== null) {
			pending.current = null;
			await run(next);
		}
	}

	return {
		status,
		autosave: (images: ProductImage[]) => void run(images),
		saving: status.kind === "saving",
	};
}
