// pdf-lib drawing for Kedaipal's three documents (order receipt, subscription
// invoice, despatch label). Consumes the pure view-models from ./document.ts and
// ./awb.ts and returns the rendered bytes. pdf-lib is pure JS (no native deps) so
// this runs inside a Convex action. The brand lockup is embedded from an inlined
// PNG (./logo.ts) so rendering never depends on a network fetch.
//
// Design language mirrors the app: slate-900 ink, mint (#10B981) accent, a clean
// letterhead with the logo top-left and the document type top-right, a tinted
// line-item table, a highlighted total, and a bordered payment card.

import {
	PDFDocument,
	type PDFFont,
	type PDFImage,
	type PDFPage,
	rgb,
	StandardFonts,
} from "pdf-lib";
import type { AwbLabelData, AwbParty } from "./awb";
import type { AwbPaperSize } from "../awbConfig";
import { encodeCode128 } from "./barcode";
import {
	formatDocDate,
	formatMoney,
	type OrderReceiptData,
	type PaymentBlock,
	type SubscriptionInvoiceData,
} from "./document";
import { KEDAIPAL_LOGO_PNG_SIZE, kedaipalLogoPngBytes } from "./logo";
import { encodeQr } from "./qr";

// A4 in PostScript points.
const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const RIGHT = PAGE[0] - MARGIN;
const CONTENT_W = PAGE[0] - MARGIN * 2;

// Brand palette (matches src/styles.css).
const INK = rgb(0.059, 0.09, 0.165); // slate-900 #0F172A
const SLATE = rgb(0.39, 0.45, 0.55); // muted body
const FAINT = rgb(0.55, 0.6, 0.68); // labels
const HAIR = rgb(0.89, 0.91, 0.94); // hairline rules
const TINT = rgb(0.965, 0.973, 0.98); // table header / card fill (slate-50)
const GREEN = rgb(0.063, 0.725, 0.506); // #10B981
const GREEN_INK = rgb(0.03, 0.5, 0.36); // green text on light
const GREEN_TINT = rgb(0.9, 0.97, 0.94); // total bar fill
const AMBER = rgb(0.96, 0.62, 0.07);

// pdf-lib's standard fonts encode WinAnsi (Latin-1) only and THROW on anything
// outside it. Normalize common typographic glyphs to ASCII, then drop any
// remaining non-Latin-1 code points so a store name with emoji/CJK never crashes
// generation (it degrades to the encodable characters instead).
function sanitize(text: string): string {
	return (
		text
			.replace(/[‘’‚‛]/g, "'")
			.replace(/[“”„]/g, '"')
			.replace(/[–—]/g, "-")
			.replace(/…/g, "...")
			.replace(/×/g, "x")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional WinAnsi clamp
			.replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
	);
}

/** Everything the drawing helpers need. The despatch label is the SELLER's
 * document, so it draws with a `Pen` and never sees the Kedaipal lockup. */
type Pen = {
	page: PDFPage;
	font: PDFFont;
	bold: PDFFont;
};

type Doc = Pen & {
	doc: PDFDocument;
	logo: PDFImage;
};

async function newDoc(): Promise<Doc> {
	const doc = await PDFDocument.create();
	doc.setProducer("Kedaipal");
	doc.setCreator("Kedaipal");
	const page = doc.addPage(PAGE);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const logo = await doc.embedPng(kedaipalLogoPngBytes());
	return { doc, page, font, bold, logo };
}

// --- Primitives ------------------------------------------------------------

function draw(
	page: PDFPage,
	font: PDFFont,
	s: string,
	x: number,
	y: number,
	size: number,
	color = INK,
): void {
	page.drawText(sanitize(s), { x, y, size, font, color });
}

function widthOf(font: PDFFont, s: string, size: number): number {
	return font.widthOfTextAtSize(sanitize(s), size);
}

function drawRight(
	page: PDFPage,
	font: PDFFont,
	s: string,
	xRight: number,
	y: number,
	size: number,
	color = INK,
): void {
	draw(page, font, s, xRight - widthOf(font, s, size), y, size, color);
}

function drawCenter(
	page: PDFPage,
	font: PDFFont,
	s: string,
	cx: number,
	y: number,
	size: number,
	color = INK,
): void {
	draw(page, font, s, cx - widthOf(font, s, size) / 2, y, size, color);
}

function rule(page: PDFPage, y: number, x = MARGIN, xEnd = RIGHT, color = HAIR) {
	page.drawLine({
		start: { x, y },
		end: { x: xEnd, y },
		thickness: 0.75,
		color,
	});
}

/** A rounded rectangle via an SVG path. `yTop` is the top edge (PDF y-up). */
function roundedRect(
	page: PDFPage,
	x: number,
	yTop: number,
	w: number,
	h: number,
	r: number,
	opts: {
		color?: ReturnType<typeof rgb>;
		borderColor?: ReturnType<typeof rgb>;
		borderWidth?: number;
	},
): void {
	const rr = Math.min(r, h / 2, w / 2);
	const path = `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
	page.drawSvgPath(path, {
		x,
		y: yTop,
		color: opts.color,
		borderColor: opts.borderColor,
		borderWidth: opts.borderWidth,
	});
}

/** A status capsule. Returns its width (so callers can right-align it). */
function pill(d: Doc, label: string, xRight: number, yTop: number, fill: ReturnType<typeof rgb>) {
	const { page, bold } = d;
	const size = 8;
	const padX = 8;
	const h = 16;
	const text = label.toUpperCase();
	const w = widthOf(bold, text, size) + padX * 2;
	roundedRect(page, xRight - w, yTop, w, h, h / 2, { color: fill });
	draw(page, bold, text, xRight - w + padX, yTop - h + 5, size, rgb(1, 1, 1));
	return w;
}

/** Longest prefix of `s` that fits `maxWidth`, with "..." when it was cut. */
function clip(font: PDFFont, s: string, size: number, maxWidth: number): string {
	const clean = sanitize(s);
	if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
	let out = clean;
	while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
		out = out.slice(0, -1);
	}
	return `${out}...`;
}

function wrap(font: PDFFont, s: string, size: number, maxWidth: number): string[] {
	const words = sanitize(s).split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		const candidate = line ? `${line} ${w}` : w;
		if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
			lines.push(line);
			line = w;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	return lines.length > 0 ? lines : [""];
}

// --- Shared sections -------------------------------------------------------

/** Letterhead: brand lockup left, document type + ref + status right. Returns
 * the y below the header (after the accent rule). */
function header(
	d: Doc,
	docType: string,
	ref: string,
	status?: { label: string; fill: ReturnType<typeof rgb> },
): number {
	const { page, font, bold, logo } = d;
	const top = PAGE[1] - MARGIN;

	// Logo lockup, aspect-correct, anchored top-left.
	const logoH = 42;
	const logoW =
		(KEDAIPAL_LOGO_PNG_SIZE.width / KEDAIPAL_LOGO_PNG_SIZE.height) * logoH;
	page.drawImage(logo, { x: MARGIN, y: top - logoH, width: logoW, height: logoH });

	// Right-aligned document title + reference.
	drawRight(page, bold, docType.toUpperCase(), RIGHT, top - 16, 22, INK);
	drawRight(page, font, ref, RIGHT, top - 31, 9.5, SLATE);
	if (status) pill(d, status.label, RIGHT, top - 38, status.fill);

	const ruleY = top - logoH - 14;
	page.drawLine({
		start: { x: MARGIN, y: ruleY },
		end: { x: RIGHT, y: ruleY },
		thickness: 1.5,
		color: GREEN,
	});
	return ruleY - 26;
}

/** A labelled party/detail block (stacked label + value lines). Returns y below. */
function detailBlock(
	d: Doc,
	x: number,
	label: string,
	lines: Array<{ text: string; strong?: boolean; color?: ReturnType<typeof rgb> }>,
	startY: number,
	maxWidth: number,
): number {
	const { page, font, bold } = d;
	draw(page, bold, label.toUpperCase(), x, startY, 7.5, FAINT);
	let y = startY - 14;
	for (const ln of lines) {
		for (const w of wrap(font, ln.text, 9.5, maxWidth)) {
			draw(page, ln.strong ? bold : font, w, x, y, ln.strong ? 10.5 : 9.5, ln.color ?? (ln.strong ? INK : SLATE));
			y -= ln.strong ? 14 : 12.5;
		}
	}
	return y;
}

/** Table header band (tinted) with column labels. */
function tableHead(
	d: Doc,
	cols: Array<{ label: string; x: number; align: "left" | "right" }>,
	yTop: number,
): number {
	const { page, font } = d;
	const h = 22;
	roundedRect(page, MARGIN, yTop, CONTENT_W, h, 5, { color: TINT });
	const ty = yTop - h + 7.5;
	for (const c of cols) {
		if (c.align === "right") drawRight(page, font, c.label, c.x, ty, 7.5, FAINT);
		else draw(page, font, c.label, c.x, ty, 7.5, FAINT);
	}
	return yTop - h;
}

// Totals column geometry. The highlight bar spans [TOTALS_X, RIGHT]; labels and
// values are inset from those edges so nothing touches the bar's rounded corners,
// and the value column lines up with the item table's AMOUNT column.
const TOTALS_X = RIGHT - 235;
const TOTALS_LABEL_X = TOTALS_X + 18;
const TOTALS_VALUE_X = RIGHT - 14;
const TOTALS_BAR_H = 26;

/** A right-aligned totals row (label left, value right, both inset). */
function totalsRow(
	d: Doc,
	label: string,
	value: string,
	y: number,
	opts: { strong?: boolean; color?: ReturnType<typeof rgb> } = {},
): void {
	const { page, font, bold } = d;
	const f = opts.strong ? bold : font;
	const size = opts.strong ? 11 : 9.5;
	const color = opts.color ?? (opts.strong ? INK : SLATE);
	draw(page, f, label, TOTALS_LABEL_X, y, size, color);
	drawRight(page, f, value, TOTALS_VALUE_X, y, size, color);
}

/** Draw the highlighted "grand total" row: a tinted bar with the label + value
 * vertically centered in it. Returns the y below the bar. */
function totalBar(d: Doc, label: string, value: string, y: number): number {
	const { page } = d;
	const barTop = y + 8;
	roundedRect(page, TOTALS_X, barTop, 235, TOTALS_BAR_H, 6, { color: GREEN_TINT });
	// Baseline tuned so the cap-height text block is optically centered in the bar.
	totalsRow(d, label, value, barTop - TOTALS_BAR_H / 2 - 5, {
		strong: true,
		color: GREEN_INK,
	});
	return barTop - TOTALS_BAR_H - 18;
}

/** Payment-instruction card (bordered, tinted). Returns y below. */
function paymentCard(
	d: Doc,
	heading: string,
	blocks: PaymentBlock[],
	yTop: number,
): number {
	if (blocks.length === 0) return yTop;
	const { page, font, bold } = d;

	// Measure height first.
	let bodyLines = 0;
	for (const b of blocks) {
		bodyLines += 1;
		for (const l of b.lines) bodyLines += wrap(font, l, 9, CONTENT_W - 32).length;
	}
	const padTop = 28;
	const h = padTop + bodyLines * 12 + blocks.length * 4 + 8;

	roundedRect(page, MARGIN, yTop, CONTENT_W, h, 8, {
		color: rgb(0.985, 0.99, 0.995),
		borderColor: HAIR,
		borderWidth: 1,
	});
	draw(page, bold, heading, MARGIN + 16, yTop - 18, 10, INK);
	let y = yTop - padTop - 6;
	for (const block of blocks) {
		draw(page, bold, block.label, MARGIN + 16, y, 9, GREEN_INK);
		y -= 13;
		for (const line of block.lines) {
			for (const w of wrap(font, line, 9, CONTENT_W - 32)) {
				draw(page, font, w, MARGIN + 16, y, 9, SLATE);
				y -= 12;
			}
		}
		y -= 4;
	}
	return yTop - h;
}

/** Footer note near the bottom margin, above a hairline. */
function footer(d: Doc, note: string): void {
	const { page, font, bold } = d;
	const cx = PAGE[0] / 2;
	const lines = wrap(font, note, 8.5, CONTENT_W);
	const y0 = MARGIN + 18 + (lines.length - 1) * 11;
	rule(page, y0 + 16);
	let y = y0;
	for (const line of lines) {
		drawCenter(page, font, line, cx, y, 8.5, SLATE);
		y -= 11;
	}
	drawCenter(page, bold, "kedaipal.com", cx, MARGIN + 2, 8, FAINT);
}

// --- A: order receipt ------------------------------------------------------

export async function buildOrderReceiptPdf(
	data: OrderReceiptData,
): Promise<Uint8Array> {
	const d = await newDoc();
	const { page, font, bold } = d;

	const paid = data.paid;
	// Same builder prints two documents: a settled order is a "Receipt" (proof of
	// payment), an unpaid/claimed order is an "Invoice" (a bill the buyer still
	// has to pay). The "How to pay" block + amber status badge below already carry
	// the pay-me intent; the title makes it unambiguous.
	let y = header(d, paid ? "Receipt" : "Invoice", `Order ${data.orderShortId}`, {
		label: data.paymentStatusLabel,
		fill: paid ? GREEN : AMBER,
	});

	// Two parties / meta.
	const colW = CONTENT_W / 2 - 12;
	const leftBottom = detailBlock(
		d,
		MARGIN,
		"From",
		[{ text: data.storeName, strong: true }],
		y,
		colW,
	);
	const billedLines: Array<{ text: string; strong?: boolean }> = [
		{ text: data.customerName ?? "Customer", strong: true },
	];
	if (data.customerPhone) billedLines.push({ text: data.customerPhone });
	const rightBottom = detailBlock(d, MARGIN + CONTENT_W / 2 + 12, "Billed to", billedLines, y, colW);
	y = Math.min(leftBottom, rightBottom) - 10;

	// Dates strip.
	const dateBits: string[] = [`Order date: ${formatDocDate(data.orderDate)}`];
	if (data.paidDate) dateBits.push(`Paid: ${formatDocDate(data.paidDate)}`);
	if (data.fulfilmentDate)
		dateBits.push(`Fulfilment: ${formatDocDate(data.fulfilmentDate)}`);
	draw(page, font, dateBits.join("     "), MARGIN, y, 9, SLATE);
	y -= 24;

	// Line-item table.
	const qtyX = RIGHT - 190;
	const unitX = RIGHT - 95;
	const amtX = RIGHT;
	y = tableHead(
		d,
		[
			{ label: "ITEM", x: MARGIN + 12, align: "left" },
			{ label: "QTY", x: qtyX, align: "right" },
			{ label: "UNIT", x: unitX, align: "right" },
			{ label: "AMOUNT", x: amtX - 12, align: "right" },
		],
		y,
	);
	y -= 18;
	for (const item of data.items) {
		const nameLines = wrap(font, item.name, 10, qtyX - MARGIN - 28);
		draw(page, bold, nameLines[0], MARGIN + 12, y, 10);
		drawRight(page, font, String(item.quantity), qtyX, y, 10, SLATE);
		drawRight(page, font, formatMoney(item.unitPrice, data.currency), unitX, y, 10, SLATE);
		drawRight(page, bold, formatMoney(item.unitPrice * item.quantity, data.currency), amtX - 12, y, 10);
		y -= 13;
		for (const extra of nameLines.slice(1)) {
			draw(page, bold, extra, MARGIN + 12, y, 10);
			y -= 13;
		}
		if (item.variantLabel) {
			draw(page, font, item.variantLabel, MARGIN + 12, y, 8.5, FAINT);
			y -= 13;
		}
		y -= 5;
		rule(page, y + 6);
		y -= 6;
	}

	// Totals.
	y -= 6;
	if (data.subtotal !== data.total) {
		totalsRow(d, "Subtotal", formatMoney(data.subtotal, data.currency), y);
		y -= 18;
	}
	// Pickup fee gets a labelled row so the subtotal→total gap is explained on
	// paper too (mirrors the tracking page + order detail breakdown).
	if (data.pickupFee && data.pickupFee > 0) {
		totalsRow(
			d,
			data.pickupLabel ? `Pickup fee — ${data.pickupLabel}` : "Pickup fee",
			formatMoney(data.pickupFee, data.currency),
			y,
		);
		y -= 18;
	}
	// Delivery charge — same labelled-row rule as the pickup fee. Collection
	// orders (86eyg0n8e) print "Collection fee": the rider collected FROM the
	// buyer, so "Delivery fee" would read backwards on their receipt.
	const chargeNoun =
		data.deliveryDirection === "collection" ? "Collection" : "Delivery";
	if (data.deliveryFee && data.deliveryFee > 0) {
		totalsRow(
			d,
			`${chargeNoun} fee`,
			formatMoney(data.deliveryFee, data.currency),
			y,
		);
		y -= 18;
	}
	// Fee-pending order: the invoice total is not final — say so on paper so
	// the printed number is never mistaken for the amount owed.
	if (data.deliveryFeePending) {
		totalsRow(d, `${chargeNoun} charge`, "To be confirmed", y);
		y -= 18;
	}
	y = totalBar(d, "Total", formatMoney(data.total, data.currency), y);
	if (data.deliveryFeePending) {
		draw(
			d.page,
			d.font,
			`${chargeNoun} charge to be confirmed by the seller — it will be added to this total.`,
			MARGIN,
			y + 4,
			8.5,
			FAINT,
		);
		y -= 14;
	}

	if (data.customerNote) {
		y = detailBlock(
			d,
			MARGIN,
			"Order note",
			[{ text: data.customerNote }],
			y,
			CONTENT_W,
		);
		y -= 12;
	}

	paymentCard(d, paid ? "How you paid" : "How to pay", data.paymentBlocks, y);

	footer(
		d,
		paid
			? `Thank you for your purchase at ${data.storeName} via Kedaipal.`
			: `Please use ${data.orderShortId} as your payment reference. Thank you for ordering from ${data.storeName} via Kedaipal.`,
	);
	return d.doc.save();
}

// --- B: subscription invoice ----------------------------------------------

export async function buildSubscriptionInvoicePdf(
	data: SubscriptionInvoiceData,
): Promise<Uint8Array> {
	const d = await newDoc();
	const { page, font, bold } = d;

	let y = header(d, "Invoice", data.invoiceNumber);

	// Parties.
	const colW = CONTENT_W / 2 - 12;
	const billedLines: Array<{ text: string; strong?: boolean }> = [
		{ text: data.billedToName, strong: true },
	];
	if (data.billedToContact) billedLines.push({ text: data.billedToContact });
	const leftBottom = detailBlock(d, MARGIN, "Billed to", billedLines, y, colW);
	const rightBottom = detailBlock(
		d,
		MARGIN + CONTENT_W / 2 + 12,
		"From",
		[
			{ text: "Kedaipal Pte Ltd", strong: true },
			{ text: "UEN 202630712C" },
			{ text: "WhatsApp-first order hub" },
		],
		y,
		colW,
	);
	y = Math.min(leftBottom, rightBottom) - 10;

	// Dates strip.
	draw(
		page,
		font,
		[
			`Invoice date: ${formatDocDate(data.issuedAt)}`,
			`Due: ${formatDocDate(data.dueDate)}`,
			`Period: ${formatDocDate(data.periodStart)} - ${formatDocDate(data.periodEnd)}`,
		].join("     "),
		MARGIN,
		y,
		9,
		SLATE,
	);
	y -= 24;

	// Line-item table.
	const qtyX = RIGHT - 150;
	const amtX = RIGHT;
	y = tableHead(
		d,
		[
			{ label: "DESCRIPTION", x: MARGIN + 12, align: "left" },
			{ label: "QTY", x: qtyX, align: "right" },
			{ label: "AMOUNT", x: amtX - 12, align: "right" },
		],
		y,
	);
	y -= 18;
	const descLines = wrap(font, data.planLineLabel, 10, qtyX - MARGIN - 28);
	descLines.forEach((line, i) => {
		draw(page, bold, line, MARGIN + 12, y, 10);
		if (i === 0) {
			drawRight(page, font, "1", qtyX, y, 10, SLATE);
			drawRight(page, bold, formatMoney(data.amount, data.currency), amtX - 12, y, 10);
		}
		y -= 14;
	});
	y -= 2;
	rule(page, y + 6);
	y -= 12;

	if (data.foundingDiscount !== undefined) {
		totalsRow(d, "Subtotal", formatMoney(data.amount, data.currency), y);
		y -= 17;
		totalsRow(d, "Founding discount", formatMoney(-data.foundingDiscount, data.currency), y, {
			color: GREEN_INK,
		});
		y -= 18;
	}
	y = totalBar(d, "Total due", formatMoney(data.total, data.currency), y);

	y = paymentCard(d, "Payment instructions", data.issuerBank, y);

	// A cross-border (non-MYR) invoice carries no payment card — the MY rails in
	// billingConfig can't settle it — so the footer points at WhatsApp instead of
	// "any account above".
	footer(
		d,
		data.issuerBank.length > 0
			? `Please transfer to any account above and use ${data.invoiceNumber} as your payment reference.`
			: `We'll confirm payment details with you on WhatsApp — quote ${data.invoiceNumber} as your payment reference.`,
	);
	return d.doc.save();
}

// --- C: despatch label (86eyp63mp) -----------------------------------------
//
// A physical label is a FIXED-SIZE object, so this section never lets content
// push anything off the sheet: the header is fixed, the bottom stack (payment
// strip, barcode, meta, note, footer) is MEASURED before anything is drawn, and
// the recipient block gets exactly what is left — truncating lines rather than
// overflowing. That is the design system's "uniform cards" rule applied to
// paper.
//
// Everything on the label degrades on its own: no logo, no courier, no tracking
// number, no weight, no date, no note — each simply doesn't print, because
// sellers print labels BEFORE the courier handover at least as often as after.

/** A6, in PostScript points (105 × 148 mm) — the thermal-label standard. */
const A6: [number, number] = [297.64, 419.53];
/** One quadrant of A4 for the 4-up sheet — exactly A4 halved twice. */
const A4_QUADRANT: [number, number] = [PAGE[0] / 2, PAGE[1] / 2];

export type AwbRenderOptions = {
	paperSize: AwbPaperSize;
	/**
	 * The seller's own logo. Only PNG and JPEG can be embedded — pdf-lib has no
	 * SVG/WebP support — so anything else is skipped silently and the label
	 * leads with the store name, which is the part that matters on a parcel.
	 */
	logo?: Uint8Array;
};

/** The rectangle one label is drawn into. `y` is its BOTTOM edge (PDF y-up). */
type Box = { x: number; y: number; w: number; h: number };

const LABEL_PAD = 13;
const QR_SIDE = 52;
const BARCODE_H = 30;
/** Fixed height of the sender block, so every label's "deliver to" lines up. */
const SENDER_H = 46;
/** Contents lines printed before the "+ N more" summary takes over. */
const ITEM_LINES_MAX = 3;

/** Embed the seller's logo, sniffing the format from its magic bytes (a stored
 * blob's declared content-type can be absent or wrong). */
async function embedSellerLogo(
	doc: PDFDocument,
	bytes: Uint8Array | undefined,
): Promise<PDFImage | undefined> {
	if (!bytes || bytes.length < 4) return undefined;
	const isPng =
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47;
	const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	try {
		if (isPng) return await doc.embedPng(bytes);
		if (isJpg) return await doc.embedJpg(bytes);
	} catch {
		// A corrupt upload must not take a whole print job down.
	}
	return undefined;
}

/** Paint a module grid as merged horizontal runs — one rectangle per run of
 * adjacent dark modules rather than one per module, which keeps a 100-label
 * batch's content streams to hundreds of KB instead of megabytes. */
function drawModuleRows(
	page: PDFPage,
	rows: boolean[][],
	x: number,
	yTop: number,
	module: number,
): void {
	rows.forEach((row, r) => {
		let runStart = -1;
		for (let c = 0; c <= row.length; c++) {
			const dark = c < row.length && row[c];
			if (dark && runStart < 0) runStart = c;
			if (!dark && runStart >= 0) {
				page.drawRectangle({
					x: x + runStart * module,
					y: yTop - (r + 1) * module,
					width: (c - runStart) * module,
					height: module,
					color: INK,
				});
				runStart = -1;
			}
		}
	});
}

/** The QR to the buyer's tracking page. A payload we can't encode simply
 * doesn't print — the order number printed beside it is the fallback. */
function drawTrackingQr(page: PDFPage, url: string, x: number, yTop: number): void {
	let matrix: ReturnType<typeof encodeQr>;
	try {
		matrix = encodeQr(url);
	} catch {
		return;
	}
	drawModuleRows(page, matrix.modules, x, yTop, QR_SIDE / matrix.size);
}

/** Code 128 bars plus the human-readable number under them. */
function drawBarcode(
	pen: Pen,
	code: NonNullable<ReturnType<typeof encodeCode128>>,
	x: number,
	yTop: number,
	maxWidth: number,
): void {
	const module = maxWidth / code.modules;
	let cursor = x;
	// Runs alternate bar/space, starting with a bar.
	code.runs.forEach((width, i) => {
		if (i % 2 === 0) {
			pen.page.drawRectangle({
				x: cursor,
				y: yTop - BARCODE_H,
				width: width * module,
				height: BARCODE_H,
				color: INK,
			});
		}
		cursor += width * module;
	});
	// Letter-spaced under the bars, the way carriers print consignment numbers.
	drawCenter(
		pen.page,
		pen.font,
		code.text.split("").join(" "),
		x + maxWidth / 2,
		yTop - BARCODE_H - 10,
		8.5,
		INK,
	);
}

type PartyLine = {
	text: string;
	size: number;
	bold?: boolean;
	color: ReturnType<typeof rgb>;
	/** Distance from the previous baseline (or the block's top) to this one. */
	advance: number;
};

type PartyLayout = { lines: PartyLine[]; height: number };

/**
 * Resolve a party block to concrete lines and a height, WITHOUT drawing — so
 * the caller can size the tint behind it before painting anything.
 * `bodyLines` is the TOTAL budget for address + notes, so a long address can
 * never push the block past the space it was allocated.
 */
function layoutParty(
	pen: Pen,
	party: AwbParty,
	maxWidth: number,
	opts: { nameSize: number; bodySize: number; bodyLines: number },
): PartyLayout {
	const { font, bold } = pen;
	const { nameSize, bodySize, bodyLines } = opts;
	const lines: PartyLine[] = [
		{ text: party.heading.toUpperCase(), size: 6.5, bold: true, color: FAINT, advance: 7 },
		{
			text: clip(bold, party.name, nameSize, maxWidth),
			size: nameSize,
			bold: true,
			color: INK,
			advance: nameSize + 4,
		},
	];
	if (party.phone) {
		lines.push({
			text: party.phone,
			size: bodySize,
			bold: true,
			color: INK,
			advance: bodySize + 3,
		});
	}
	// Reserve one line for the address notes when there are any, so a gate code
	// never gets dropped by a long street address.
	const addressBudget = party.notes ? bodyLines - 1 : bodyLines;
	let used = 0;
	for (const line of party.lines) {
		if (used >= addressBudget) break;
		for (const wrapped of wrap(font, line, bodySize, maxWidth)) {
			if (used >= addressBudget) break;
			lines.push({
				text: wrapped,
				size: bodySize,
				color: SLATE,
				// The first body line clears the phone/name above it; the rest sit
				// tighter, as a block of address lines should.
				advance: used === 0 ? bodySize + 3 : bodySize + 2.5,
			});
			used++;
		}
	}
	if (party.notes && bodyLines > 0) {
		lines.push({
			text: clip(font, party.notes, bodySize - 1.5, maxWidth),
			size: bodySize - 1.5,
			color: FAINT,
			advance: bodySize + 2.5,
		});
	}
	// Every advance lands on a baseline, so the block runs from its top down to
	// the last baseline plus that line's descender, with a little breathing room.
	const height =
		lines.reduce((sum, l) => sum + l.advance, 0) +
		lines[lines.length - 1].size * 0.3 +
		6;
	return { lines, height };
}

function drawPartyLayout(
	pen: Pen,
	layout: PartyLayout,
	x: number,
	yTop: number,
): void {
	let y = yTop;
	for (const line of layout.lines) {
		y -= line.advance;
		draw(pen.page, line.bold ? pen.bold : pen.font, line.text, x, y, line.size, line.color);
	}
}

/** Draw one despatch label inside `box`. Never draws outside it. */
function drawLabel(
	pen: Pen,
	box: Box,
	data: AwbLabelData,
	logo: PDFImage | undefined,
): void {
	const { page, font, bold } = pen;
	const x = box.x + LABEL_PAD;
	const right = box.x + box.w - LABEL_PAD;
	const width = right - x;
	const top = box.y + box.h - LABEL_PAD;
	const bottom = box.y + LABEL_PAD;

	// The cut line, so a 4-up sheet says exactly where the scissors go.
	page.drawRectangle({
		x: box.x + 4,
		y: box.y + 4,
		width: box.w - 8,
		height: box.h - 8,
		borderColor: HAIR,
		borderWidth: 0.75,
	});

	// --- Header: brand + order number left, tracking QR right ----------------
	if (data.trackUrl) drawTrackingQr(page, data.trackUrl, right - QR_SIDE, top);
	const headWidth = width - QR_SIDE - 12;
	let y = top;
	if (logo) {
		const logoH = 15;
		const logoW = Math.min((logo.width / logo.height) * logoH, headWidth);
		page.drawImage(logo, { x, y: y - logoH, width: logoW, height: logoH });
		y -= logoH + 5;
	}
	draw(page, bold, clip(bold, data.storeName, 10.5, headWidth), x, y - 10.5, 10.5, INK);
	y -= 10.5 + 6;
	draw(page, bold, data.orderShortId, x, y - 16, 16, INK);
	y -= 16 + 6;
	// Keep clear of the QR's quiet zone (a QR needs ~4 light modules all round).
	let cursor = Math.min(y, top - QR_SIDE - 9);
	rule(page, cursor, x, right);
	cursor -= 12;

	// --- Bottom stack: measured BEFORE anything is drawn ---------------------
	const footerLines = data.footerText
		? wrap(font, data.footerText, 7, width).slice(0, 2)
		: [];
	const metaBits: string[] = [];
	if (data.fulfilmentLabel) metaBits.push(data.fulfilmentLabel);
	if (data.weightLabel) metaBits.push(data.weightLabel);
	metaBits.push(`${data.totalUnits} item${data.totalUnits === 1 ? "" : "s"}`);
	const metaLines = wrap(font, metaBits.join(" · "), 8, width).slice(0, 2);
	const noteLines = data.note
		? wrap(font, `Note: ${data.note}`, 8, width).slice(0, 2)
		: [];
	const barcode = data.trackingNo ? encodeCode128(data.trackingNo) : null;
	// The contents list gets a MEASURED slot rather than the leftovers: without
	// one, a full label squeezed it to nothing and printed a bare "+ 3 more".
	// Capped at three lines plus an overflow line — a packing hint, not a manifest.
	const allItemLines = (data.items ?? []).map((i) => `${i.quantity} x ${i.name}`);
	const shownItems = allItemLines.slice(0, ITEM_LINES_MAX);
	const itemsH =
		allItemLines.length === 0
			? 0
			: (shownItems.length + (allItemLines.length > shownItems.length ? 1 : 0)) * 9 + 4;

	const hasShipment = Boolean(data.courierName || data.trackingNo);
	const shipmentH = !hasShipment
		? 0
		: barcode
			? 12 + BARCODE_H + 14
			: 12 + (data.trackingNo ? 13 : 0);
	const paymentH = data.payment ? 30 : 0;
	const footerH = footerLines.length > 0 ? footerLines.length * 9 + 4 : 0;
	const metaH = metaLines.length * 10 + 4;
	const noteH = noteLines.length > 0 ? noteLines.length * 10 + 2 : 0;
	const stackTop =
		bottom + paymentH + shipmentH + metaH + noteH + itemsH + footerH + 10;

	// --- Middle: the two parties, clamped to what is actually left -----------
	const senderLayout = layoutParty(pen, data.sender, width, {
		nameSize: 8.5,
		bodySize: 7.5,
		bodyLines: 2,
	});
	drawPartyLayout(pen, senderLayout, x, cursor);
	// The sender block is given a FIXED height even when the store has no
	// business address: a printed stack reads far better when every label's
	// "deliver to" starts at the same place.
	const toTop = cursor - SENDER_H;
	rule(page, toTop + 4, x, right);
	// Everything between the sender block and the measured stack is the
	// recipient's — the one block a courier has to be able to read.
	const toSpace = Math.max(0, toTop - stackTop - 2);
	// Heading + name + phone eat ~44pt; the rest is address lines and notes.
	const bodyLines = Math.max(1, Math.floor((toSpace - 44) / 12.5));
	const toLayout = layoutParty(pen, data.recipient, width, {
		nameSize: 13,
		bodySize: 10,
		bodyLines,
	});
	// Tint only what the block actually fills, so a short address doesn't leave
	// a grey slab hanging over the payment strip.
	const tintH = Math.min(toSpace, toLayout.height + 4);
	if (tintH > 0) {
		page.drawRectangle({
			x: x - 6,
			y: toTop - tintH,
			width: width + 12,
			height: tintH,
			color: TINT,
		});
	}
	drawPartyLayout(pen, toLayout, x, toTop - 4);

	// --- Bottom stack, drawn top-down from the height measured above ---------
	let sy = stackTop;
	if (data.payment) {
		const barH = 24;
		const paid = data.payment.kind === "paid";
		roundedRect(page, x, sy, width, barH, 5, { color: paid ? GREEN_TINT : INK });
		const label =
			data.payment.kind === "cod"
				? `COLLECT ${formatMoney(data.payment.amount, data.currency)}`
				: data.payment.kind === "cod_pending"
					? "COLLECT ON DELIVERY - CONFIRM AMOUNT"
					: "PAID - NOTHING TO COLLECT";
		drawCenter(
			page,
			bold,
			label,
			x + width / 2,
			sy - barH + 8,
			data.payment.kind === "cod" ? 13 : 9.5,
			paid ? GREEN_INK : rgb(1, 1, 1),
		);
		sy -= paymentH;
	}
	if (hasShipment) {
		draw(
			page,
			bold,
			clip(bold, data.courierName ?? "Courier not set", 9, width),
			x,
			sy - 9,
			9,
			data.courierName ? INK : FAINT,
		);
		sy -= 12;
		if (barcode) {
			drawBarcode(pen, barcode, x, sy, width);
			sy -= BARCODE_H + 14;
		} else if (data.trackingNo) {
			// Too long (or unencodable) to scan reliably — the number is still the
			// point, so it prints as text rather than as unreadable bars.
			draw(page, font, clip(font, data.trackingNo, 9, width), x, sy - 9, 9, SLATE);
			sy -= 13;
		}
	}
	for (const line of metaLines) {
		draw(page, font, line, x, sy - 8, 8, SLATE);
		sy -= 10;
	}
	sy -= 4;
	for (const line of noteLines) {
		draw(page, font, line, x, sy - 8, 8, INK);
		sy -= 10;
	}
	if (noteLines.length > 0) sy -= 2;
	// Contents list — always says how many lines it dropped, never shows a
	// partial order as if it were the whole one.
	for (const line of shownItems) {
		draw(page, font, clip(font, line, 7.5, width), x, sy - 7.5, 7.5, SLATE);
		sy -= 9;
	}
	if (allItemLines.length > shownItems.length) {
		draw(
			page,
			font,
			`+ ${allItemLines.length - shownItems.length} more`,
			x,
			sy - 7.5,
			7.5,
			FAINT,
		);
	}
	footerLines.forEach((line, i) => {
		draw(page, font, line, x, bottom + (footerLines.length - 1 - i) * 9, 7, FAINT);
	});
}

/**
 * Render despatch labels for one store's orders. A6 gives one label per page
 * (thermal printers); A4 4-up imposes four per sheet with dashed cut guides.
 *
 * Deliberately NOT pdf-lib's `embedPages` (which the ticket suggested): drawing
 * straight into each quadrant keeps it to one document with one font and one
 * logo embed and no nested XObjects, so the 4-up sheet comes out smaller and
 * the code has one layout path instead of two.
 */
export async function buildAwbPdf(
	labels: AwbLabelData[],
	opts: AwbRenderOptions,
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setProducer("Kedaipal");
	doc.setCreator("Kedaipal");
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const logo = await embedSellerLogo(doc, opts.logo);

	if (labels.length === 0) {
		// An empty job still has to be a valid PDF: say why it is blank rather
		// than handing the seller a file their reader refuses to open.
		const page = doc.addPage(A6);
		drawCenter(page, bold, "No labels to print", A6[0] / 2, A6[1] / 2, 12, SLATE);
		drawCenter(
			page,
			font,
			"None of these orders has a delivery address.",
			A6[0] / 2,
			A6[1] / 2 - 16,
			8.5,
			FAINT,
		);
		return doc.save();
	}

	if (opts.paperSize === "a6") {
		for (const label of labels) {
			const page = doc.addPage(A6);
			drawLabel({ page, font, bold }, { x: 0, y: 0, w: A6[0], h: A6[1] }, label, logo);
		}
		return doc.save();
	}

	const [qw, qh] = A4_QUADRANT;
	const quadrants = [
		{ x: 0, y: qh },
		{ x: qw, y: qh },
		{ x: 0, y: 0 },
		{ x: qw, y: 0 },
	];
	for (let i = 0; i < labels.length; i += 4) {
		const page = doc.addPage(PAGE);
		const pen: Pen = { page, font, bold };
		// Dashed cut guides across the whole sheet — identical on every sheet,
		// whether it carries four labels or one.
		page.drawLine({
			start: { x: 0, y: qh },
			end: { x: PAGE[0], y: qh },
			thickness: 0.5,
			color: FAINT,
			dashArray: [4, 4],
		});
		page.drawLine({
			start: { x: qw, y: 0 },
			end: { x: qw, y: PAGE[1] },
			thickness: 0.5,
			color: FAINT,
			dashArray: [4, 4],
		});
		labels.slice(i, i + 4).forEach((label, slot) => {
			const q = quadrants[slot];
			drawLabel(pen, { x: q.x, y: q.y, w: qw, h: qh }, label, logo);
		});
	}
	return doc.save();
}
