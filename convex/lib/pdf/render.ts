// pdf-lib drawing for Kedaipal's two documents (order receipt + subscription
// invoice). Consumes the pure view-models from ./document.ts and returns the
// rendered bytes. pdf-lib is pure JS (no native deps) so this runs inside a
// Convex action. The brand lockup is embedded from an inlined PNG (./logo.ts) so
// rendering never depends on a network fetch.
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
import {
	formatDocDate,
	formatMoney,
	type OrderReceiptData,
	type PaymentBlock,
	type SubscriptionInvoiceData,
} from "./document";
import { KEDAIPAL_LOGO_PNG_SIZE, kedaipalLogoPngBytes } from "./logo";

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

type Doc = {
	doc: PDFDocument;
	page: PDFPage;
	font: PDFFont;
	bold: PDFFont;
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

	const paid = data.paymentStatusLabel.toLowerCase() === "paid";
	let y = header(d, "Receipt", `Order ${data.orderShortId}`, {
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
	y = totalBar(d, "Total", formatMoney(data.total, data.currency), y);

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

	paymentCard(d, "How to pay", data.paymentBlocks, y);

	footer(d, `Thank you for your purchase at ${data.storeName} via Kedaipal.`);
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
			{ text: "Kedaipal", strong: true },
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

	footer(
		d,
		`Please transfer to any account above and use ${data.invoiceNumber} as your payment reference.`,
	);
	return d.doc.save();
}
