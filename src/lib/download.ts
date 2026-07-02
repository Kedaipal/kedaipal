// Client-side "save this blob to a file" helpers, shared by the receipt /
// invoice / CSV download buttons. DOM-only (no unit tests) — the data shaping
// they hand off is tested upstream (convex/lib/pdf, convex/lib/orderCsv).

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

/**
 * Whether this device can share files via the OS share sheet (Web Share API
 * level 2). True on most phones/tablets (incl. the counter iPad — the sheet
 * lists WhatsApp, AirDrop, etc.), typically false on desktop browsers, where
 * the caller should fall back to a plain download.
 */
export function canSharePdf(): boolean {
	if (typeof navigator === "undefined" || !navigator.canShare) return false;
	try {
		const probe = new File([new Uint8Array()], "probe.pdf", {
			type: "application/pdf",
		});
		return navigator.canShare({ files: [probe] });
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
