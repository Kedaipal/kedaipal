// Client-side "save this blob to a file" helpers, shared by the receipt /
// invoice / CSV download buttons and the tracking page's payment-QR save. The
// DOM/share plumbing has no unit tests — the data shaping it hands off is
// tested upstream (convex/lib/pdf, convex/lib/orderCsv); the pure filename
// helpers below are covered in download.test.ts.

import { slugify } from "./slug";

/** UTF-8 byte-order mark — prepended to CSV so Excel reads non-ASCII correctly. */
const UTF8_BOM = "﻿";

/** Trigger a browser download of `blob` as `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoke after the click has been handled so the download isn't cancelled.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download raw PDF bytes (from an action) as a `.pdf` file. */
export function downloadPdfBytes(filename: string, bytes: ArrayBuffer): void {
	downloadBlob(filename, new Blob([bytes], { type: "application/pdf" }));
}

/** Download a CSV string. Prepends a UTF-8 BOM so Excel reads non-ASCII
 * (customer names, notes) correctly. */
export function downloadCsv(filename: string, csv: string): void {
	downloadBlob(
		filename,
		new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8" }),
	);
}

/** Whether this device CAN share `file` via the OS share sheet (Web Share API
 * level 2) — capability only. Note this is true on macOS Safari too, so it is
 * NOT a proxy for "is a phone"; see `prefersShareSheet`. */
function canShareFile(file: File): boolean {
	if (typeof navigator === "undefined" || !navigator.canShare) return false;
	try {
		return navigator.canShare({ files: [file] });
	} catch {
		return false;
	}
}

/**
 * Whether the OS share sheet is the RIGHT way to SAVE a file here, as opposed
 * to a plain download. Capability alone isn't the question — macOS Safari can
 * share files, but a desktop user who taps "Save" wants the file in their
 * Downloads folder, not a share-sheet popup they have to dismiss.
 *
 * Share-first only earns its place on touch devices, where "Save Image" puts
 * the file in the photo gallery — which is where e-wallet / banking
 * scan-from-gallery pickers look. Requires BOTH a touch digitiser and a coarse
 * primary pointer, so a touchscreen laptop (touch points, but driven by a
 * mouse, and it has a real Downloads folder) correctly gets the download.
 * iPadOS reports a macOS UA but has touch points + a coarse pointer, so it is
 * classified as the tablet it is.
 */
export function prefersShareSheet(): boolean {
	if (typeof navigator === "undefined" || typeof window === "undefined")
		return false;
	if (!(navigator.maxTouchPoints > 0)) return false;
	return window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * Whether this device can share PDF files via the OS share sheet (incl. the
 * counter iPad — the sheet lists WhatsApp, AirDrop, etc.).
 */
export function canSharePdf(): boolean {
	try {
		return canShareFile(
			new File([new Uint8Array()], "probe.pdf", { type: "application/pdf" }),
		);
	} catch {
		return false;
	}
}

/**
 * Share raw PDF bytes through the OS share sheet. Returns:
 *  - "shared"    the sheet completed (or the browser doesn't report the target);
 *  - "cancelled" the user dismissed the sheet (not an error — stay quiet);
 *  - "unsupported" no file-share capability, so the caller should download instead.
 */
export async function sharePdfBytes(
	filename: string,
	bytes: ArrayBuffer,
	opts?: { title?: string; text?: string },
): Promise<"shared" | "cancelled" | "unsupported"> {
	if (!canSharePdf()) return "unsupported";
	const file = new File([bytes], filename, { type: "application/pdf" });
	try {
		await navigator.share({
			files: [file],
			title: opts?.title,
			text: opts?.text,
		});
		return "shared";
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError")
			return "cancelled";
		return "unsupported";
	}
}

/** Filename extension for an image MIME type. Defaults to png — payment-QR
 * uploads are png/jpeg in practice. */
export function imageExtension(mimeType: string): string {
	switch (mimeType) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/svg+xml":
			return "svg";
		default:
			return "png";
	}
}

/** Filename base for a saved payment-QR image: the slugified method label with
 * a `-qr` suffix when the label doesn't already say QR ("DuitNow QR" →
 * "duitnow-qr", "TNG" → "tng-qr", "" → "payment-qr"). */
export function qrFilenameBase(label: string): string {
	const slug = slugify(label) || "payment";
	return /(^|-)qr(-|$)/.test(slug) ? slug : `${slug}-qr`;
}

export type SaveImageOutcome = "shared" | "cancelled" | "downloaded" | "failed";

/**
 * Save a remote image to the buyer's device.
 *
 * **Touch devices** get the OS share sheet first: "Save Image" lands the file
 * in the photo gallery, which is where e-wallet / banking scan-from-gallery
 * pickers look. **Desktop gets a plain download** to the browser's download
 * folder — even on macOS Safari, which *can* share files but where a sheet
 * would be an unwanted popup in front of someone who just asked to save
 * (see `prefersShareSheet`). Returns what happened so the caller can toast
 * appropriately:
 *  - "shared"     the OS sheet took over — say nothing;
 *  - "cancelled"  the user dismissed the sheet — intentional, stay quiet;
 *  - "downloaded" saved as a file — worth a confirming toast;
 *  - "failed"     the image couldn't be fetched — surface an error.
 */
export async function saveImageFromUrl(
	url: string,
	baseFilename: string,
): Promise<SaveImageOutcome> {
	let blob: Blob;
	try {
		const res = await fetch(url);
		if (!res.ok) return "failed";
		blob = await res.blob();
	} catch {
		return "failed";
	}
	// Some responses come back untyped — File/share need a concrete image type.
	const type = blob.type.startsWith("image/") ? blob.type : "image/png";
	const filename = `${baseFilename}.${imageExtension(type)}`;
	const file = new File([blob], filename, { type });
	if (prefersShareSheet() && canShareFile(file)) {
		try {
			await navigator.share({ files: [file] });
			return "shared";
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError")
				return "cancelled";
			// Anything else (e.g. lost user activation) → fall through to download.
		}
	}
	downloadBlob(filename, blob);
	return "downloaded";
}
