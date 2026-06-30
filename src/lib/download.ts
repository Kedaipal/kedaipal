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
