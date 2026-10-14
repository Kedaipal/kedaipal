import { useRef, useState } from "react";
import type { ProductImage } from "../components/forms/product-images-field";
import { convexErrorMessage } from "../lib/format";

export type PhotoAutosaveStatus =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "saved" }
	| { kind: "error"; message: string };

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
 * `onSaved` hands back the list the server now has, so the form can move its
 * "unchanged" baseline. A failed save leaves the baseline alone, so the
 * photos stay an unsaved change: Save changes still saves them, and the
 * leave guard still warns.
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

	async function run(images: ProductImage[]): Promise<void> {
		if (inFlight.current) {
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
