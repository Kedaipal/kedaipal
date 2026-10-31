import { referralShareImageCopy } from "../../convex/lib/referral";

/**
 * The referral SHARE IMAGE, drawn (docs/referrals.md § The share image). The
 * invite as a VOUCHER: the offer on top, a perforated stub below holding the
 * QR and the link, the Kedaipal mark so a stranger scrolling a status knows
 * what it is. Two formats, because the places it travels have two shapes: a
 * square for posts, seller groups and chats, a 9:16 story for a WhatsApp
 * status or an Instagram/Facebook story.
 *
 * The card is a BRAND asset, not app chrome: fixed colours, identical in light
 * and dark (like the printed QR poster). The dialog shows this very PNG as
 * its preview, so what the seller sees is what the referee gets — the first
 * build drew a DOM look-alike that drifted from the file in dark mode.
 */

export type ShareImageFormat = "square" | "story";

export const SHARE_IMAGE_SIZE: Record<
	ShareImageFormat,
	{ w: number; h: number }
> = {
	square: { w: 1080, h: 1080 },
	story: { w: 1080, h: 1920 },
};

// The brand palette — the house navy (`--segment` in light) and mint. Fixed
// on purpose: the image is the same file whichever theme made it.
const NAVY = "#1E2A52";
const STUB = "#172046";
const GLOW = "52,211,153";
const MINT_SOFT = "#A7F3D0";
const MINT_LIT = "#6EE7B7";
const PERFORATION = "rgba(167,243,208,0.32)";
const PILL_RING = "rgba(167,243,208,0.45)";
const INK = "#F8FAFC";
const INK_SOFT = "rgba(248,250,252,0.86)";
const KP_GREEN = "#10B981";

const HEADING = `"Red Hat Display Variable", "Red Hat Display", system-ui, sans-serif`;
const SANS = `"Geist Variable", "Geist", system-ui, sans-serif`;
const MONO = `"Geist Mono Variable", "Geist Mono", ui-monospace, Menlo, monospace`;

/** Every font the card uses, as `document.fonts.load` specs — awaited before
 * drawing, or the canvas silently falls back to the system face. */
export const SHARE_IMAGE_FONTS = [
	`800 40px ${HEADING}`,
	`500 40px ${SANS}`,
	`700 40px ${SANS}`,
	`600 40px ${MONO}`,
];

type Layout = {
	pad: number;
	padTop: number;
	stubTop: number;
	logoW: number;
	wordmarkPx: number;
	pillPx: number;
	avatarPx: number;
	eyebrowPx: number;
	eyebrowMinPx: number;
	headlinePx: number;
	headlineLh: number;
	bodyPx: number;
	bodyLh: number;
	gap: number;
	benefitPx: number | null;
	benefitLh: number;
	qrPlate: number;
	qrInset: number;
	scanPx: number;
	linkPx: number;
	stub: "row" | "column";
};

const LAYOUT: Record<ShareImageFormat, Layout> = {
	square: {
		pad: 66,
		padTop: 60,
		stubTop: 735,
		logoW: 66,
		wordmarkPx: 46,
		pillPx: 30,
		avatarPx: 80,
		eyebrowPx: 36,
		eyebrowMinPx: 24,
		headlinePx: 132,
		headlineLh: 130,
		bodyPx: 40,
		bodyLh: 55,
		gap: 26,
		benefitPx: null,
		benefitLh: 0,
		qrPlate: 265,
		qrInset: 22,
		scanPx: 31,
		linkPx: 36,
		stub: "row",
	},
	story: {
		pad: 90,
		padTop: 96,
		stubTop: 1290,
		logoW: 84,
		wordmarkPx: 58,
		pillPx: 36,
		avatarPx: 100,
		eyebrowPx: 44,
		eyebrowMinPx: 28,
		headlinePx: 168,
		headlineLh: 164,
		bodyPx: 50,
		bodyLh: 70,
		gap: 36,
		benefitPx: 48,
		benefitLh: 78,
		qrPlate: 400,
		qrInset: 34,
		scanPx: 40,
		linkPx: 40,
		stub: "column",
	},
};

// The Kedaipal bag mark (public/favicon.svg), in its own 76 × 66 frame.
const MARK_OUTLINE =
	"M37.53 65.95C35.53 65.95 33.64 64.98 32.48 63.35L28.65 58.01H13.76C6.17 58.01 0 51.84 0 44.25V43.9L2.46 10.05C2.57 4.48999 7.13 0 12.71 0H62.34C67.93 0 72.48 4.48999 72.59 10.05L75.05 44.08V44.26C75.05 51.85 68.88 58.02 61.29 58.02H46.4L42.57 63.36C41.41 64.99 39.52 65.96 37.52 65.96L37.53 65.95ZM9.83 44.4C9.91 46.5 11.64 48.19 13.76 48.19H29.61C32.17 48.19 34.59 49.43 36.08 51.51L37.53 53.54L38.98 51.51C40.47 49.43 42.89 48.19 45.45 48.19H61.3C63.42 48.19 65.15 46.5 65.23 44.4L62.78 10.43V10.25C62.78 10.01 62.59 9.82001 62.35 9.82001H12.72C12.48 9.82001 12.29 10.01 12.29 10.25V10.6L9.84 44.39L9.83 44.4Z";
const MARK_BODY =
	"M67.68 10.26C67.68 7.30998 65.29 4.91998 62.34 4.91998H12.71C9.76 4.91998 7.37 7.30998 7.37 10.26L4.91 44.26C4.91 49.14 8.87 53.1 13.75 53.1H29.6C30.58 53.1 31.5 53.57 32.07 54.37L36.46 60.49C36.98 61.22 38.06 61.22 38.58 60.49L42.97 54.37C43.54 53.57 44.46 53.1 45.44 53.1H61.29C66.17 53.1 70.13 49.14 70.13 44.26L67.67 10.26H67.68Z";
const MARK_SMILE =
	"M42.9 38.89H31.57C26.24 38.89 21.91 34.56 21.91 29.23V19.58H25.15V29.23C25.15 32.77 28.03 35.65 31.57 35.65H42.9C46.44 35.65 49.32 32.77 49.32 29.23V19.58H52.56V29.23C52.56 34.56 48.23 38.89 42.9 38.89Z";

/**
 * Draws the card onto `ctx`, which must be sized `SHARE_IMAGE_SIZE[format]`.
 * `qr` is the link's QR, already rasterisable (an `<img>` of the SVG).
 */
export function drawReferralShareImage(
	ctx: CanvasRenderingContext2D,
	opts: {
		format: ShareImageFormat;
		storeName: string;
		link: string;
		qr: CanvasImageSource;
	},
): void {
	const { w, h } = SHARE_IMAGE_SIZE[opts.format];
	const L = LAYOUT[opts.format];
	const copy = referralShareImageCopy(opts.storeName);
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";

	// Ground + a soft mint glow top-right (the page hero's motif).
	ctx.fillStyle = NAVY;
	ctx.fillRect(0, 0, w, h);
	const glow = ctx.createRadialGradient(w - 40, 20, 0, w - 40, 20, w * 0.48);
	glow.addColorStop(0, `rgba(${GLOW},0.26)`);
	glow.addColorStop(1, `rgba(${GLOW},0)`);
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, w, L.stubTop);

	// Brand row: the mark + wordmark, and the INVITE tag.
	const markH = (L.logoW * 66) / 76;
	drawMark(ctx, L.pad, L.padTop, L.logoW);
	ctx.fillStyle = INK;
	ctx.font = `800 ${L.wordmarkPx}px ${HEADING}`;
	const rowMid = L.padTop + markH / 2;
	ctx.fillText(
		"kedaipal",
		L.pad + L.logoW + L.wordmarkPx * 0.4,
		rowMid + L.wordmarkPx * 0.34,
	);
	drawPill(ctx, "INVITE", w - L.pad, rowMid, L.pillPx);

	// The offer, bottom-aligned above the stub: who, the number, the terms,
	// and (story only) why.
	const avatarRowH = L.avatarPx;
	ctx.font = `500 ${L.bodyPx}px ${SANS}`;
	const bodyLines = wrapLines(ctx, copy.body, w - L.pad * 2);
	const headlinePx = fitFont(
		ctx,
		(px) => `800 ${px}px ${HEADING}`,
		[copy.headlineLead, copy.headlineRest],
		L.headlinePx,
		w - L.pad * 2,
	);
	const headlineLh = (L.headlineLh * headlinePx) / L.headlinePx;
	const benefitsH = L.benefitPx ? copy.benefits.length * L.benefitLh : 0;
	const blockH =
		avatarRowH +
		L.gap +
		headlineLh * 2 +
		L.gap +
		bodyLines.length * L.bodyLh +
		(benefitsH ? L.gap * 1.4 + benefitsH : 0);
	let y = L.stubTop - L.gap * 2 - blockH;

	// Who: the store's initials badge + "<STORE> INVITES YOU".
	const r = L.avatarPx / 2;
	ctx.fillStyle = MINT_SOFT;
	ctx.beginPath();
	ctx.arc(L.pad + r, y + r, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = NAVY;
	ctx.font = `800 ${Math.round(L.avatarPx * 0.4)}px ${HEADING}`;
	ctx.textAlign = "center";
	ctx.fillText(copy.initials, L.pad + r, y + r + L.avatarPx * 0.14);
	ctx.textAlign = "left";
	const eyebrowX = L.pad + L.avatarPx + L.avatarPx * 0.3;
	drawFittedSpaced(
		ctx,
		copy.eyebrow.toUpperCase(),
		eyebrowX,
		y + r + L.eyebrowPx * 0.36,
		w - L.pad - eyebrowX,
		L.eyebrowPx,
		L.eyebrowMinPx,
	);
	y += avatarRowH + L.gap;

	// The number, lit; then "on us."
	ctx.font = `800 ${headlinePx}px ${HEADING}`;
	ctx.fillStyle = MINT_LIT;
	ctx.fillText(copy.headlineLead, L.pad, y + headlinePx * 0.8);
	ctx.fillStyle = INK;
	ctx.fillText(copy.headlineRest, L.pad, y + headlineLh + headlinePx * 0.8);
	y += headlineLh * 2 + L.gap;

	ctx.font = `500 ${L.bodyPx}px ${SANS}`;
	ctx.fillStyle = INK_SOFT;
	for (const line of bodyLines) {
		ctx.fillText(line, L.pad, y + L.bodyPx * 0.9);
		y += L.bodyLh;
	}

	if (L.benefitPx) {
		y += L.gap * 1.4;
		ctx.font = `500 ${L.benefitPx}px ${SANS}`;
		for (const benefit of copy.benefits) {
			drawCheck(ctx, L.pad, y + L.benefitPx * 0.1, L.benefitPx * 0.8);
			ctx.fillStyle = INK;
			ctx.fillText(benefit, L.pad + L.benefitPx * 1.2, y + L.benefitPx * 0.8);
			y += L.benefitLh;
		}
	}

	// The stub: a perforated tear line, then the QR and the link.
	ctx.fillStyle = STUB;
	ctx.fillRect(0, L.stubTop, w, h - L.stubTop);
	ctx.save();
	ctx.strokeStyle = PERFORATION;
	ctx.lineWidth = 5;
	ctx.setLineDash([18, 14]);
	ctx.beginPath();
	ctx.moveTo(L.pad * 0.7, L.stubTop);
	ctx.lineTo(w - L.pad * 0.7, L.stubTop);
	ctx.stroke();
	ctx.restore();

	const [host, ...rest] = linkLabel(opts.link).split("/referral/");
	const slugLine = `referral/${rest.join("")}`;
	if (L.stub === "row") {
		const stubH = h - L.stubTop;
		const plateX = w - L.pad - L.qrPlate;
		const plateY = L.stubTop + (stubH - L.qrPlate) / 2;
		drawQrPlate(ctx, opts.qr, plateX, plateY, L.qrPlate, L.qrInset);
		const textW = plateX - L.pad - 30;
		const linkPx = fitFont(
			ctx,
			(px) => `600 ${px}px ${MONO}`,
			[`${host}/`, slugLine],
			L.linkPx,
			textW,
		);
		const blockTextH = L.scanPx + 18 + linkPx * 1.35 * 2;
		let ty = L.stubTop + (stubH - blockTextH) / 2 + L.scanPx * 0.9;
		ctx.fillStyle = MINT_SOFT;
		ctx.font = `700 ${L.scanPx}px ${SANS}`;
		fillSpaced(ctx, copy.scanLabel.toUpperCase(), L.pad, ty, L.scanPx * 0.14);
		ty += 18 + linkPx * 1.2;
		ctx.fillStyle = INK;
		ctx.font = `600 ${linkPx}px ${MONO}`;
		ctx.fillText(`${host}/`, L.pad, ty);
		ctx.fillText(slugLine, L.pad, ty + linkPx * 1.35);
	} else {
		const cx = w / 2;
		let ty = L.stubTop + 70;
		ctx.fillStyle = MINT_SOFT;
		ctx.font = `700 ${L.scanPx}px ${SANS}`;
		const label = copy.scanLabel.toUpperCase();
		const labelW = measureSpaced(ctx, label, L.scanPx * 0.14);
		fillSpaced(ctx, label, cx - labelW / 2, ty, L.scanPx * 0.14);
		ty += 34;
		drawQrPlate(ctx, opts.qr, cx - L.qrPlate / 2, ty, L.qrPlate, L.qrInset);
		ty += L.qrPlate + 70;
		const full = linkLabel(opts.link);
		const linkPx = fitFont(
			ctx,
			(px) => `600 ${px}px ${MONO}`,
			[full],
			L.linkPx,
			w - L.pad * 2,
		);
		ctx.fillStyle = INK;
		ctx.font = `600 ${linkPx}px ${MONO}`;
		ctx.textAlign = "center";
		ctx.fillText(full, cx, ty);
		ctx.textAlign = "left";
	}
}

/** The link as people read it — no scheme. */
export function linkLabel(link: string): string {
	return link.replace(/^https?:\/\//, "");
}

/**
 * Draws the card and returns it as a PNG. Waits for the card's fonts first:
 * a canvas never waits on its own, and a fallback face would ship in the file.
 */
export async function renderReferralShareImage(opts: {
	format: ShareImageFormat;
	storeName: string;
	link: string;
	qrSvg: SVGSVGElement;
}): Promise<Blob> {
	if (typeof document !== "undefined" && document.fonts) {
		await Promise.all(SHARE_IMAGE_FONTS.map((f) => document.fonts.load(f)));
	}
	const qr = await svgToImage(opts.qrSvg);
	const { w, h } = SHARE_IMAGE_SIZE[opts.format];
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	drawReferralShareImage(ctx, { ...opts, qr });
	return new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("blob"))),
			"image/png",
		),
	);
}

/** The PNG's file name: `kedaipal-invite-<slug>-<format>.png`. */
export function shareImageFileName(
	slug: string,
	format: ShareImageFormat,
): string {
	return `kedaipal-invite-${slug}-${format}.png`;
}

function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(
		new Blob([new XMLSerializer().serializeToString(svg)], {
			type: "image/svg+xml;charset=utf-8",
		}),
	);
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("qr"));
		};
		img.src = url;
	});
}

function drawMark(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
) {
	const s = width / 76;
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(s, s);
	ctx.fillStyle = INK;
	ctx.fill(new Path2D(MARK_OUTLINE));
	ctx.fillStyle = KP_GREEN;
	ctx.fill(new Path2D(MARK_BODY));
	ctx.fillStyle = "#FFFFFF";
	ctx.fill(new Path2D(MARK_SMILE));
	for (const cx of [50.98, 23.42]) {
		ctx.beginPath();
		ctx.arc(cx, 19.11, 3.39, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

/** A ringed, spaced-caps tag, right-aligned at `right`, centred on `midY`. */
function drawPill(
	ctx: CanvasRenderingContext2D,
	text: string,
	right: number,
	midY: number,
	px: number,
) {
	ctx.font = `700 ${px}px ${SANS}`;
	const spacing = px * 0.14;
	const tw = measureSpaced(ctx, text, spacing);
	const padX = px * 0.85;
	const ph = px * 1.9;
	const pw = tw + padX * 2;
	ctx.save();
	ctx.strokeStyle = PILL_RING;
	ctx.lineWidth = Math.max(2, px * 0.1);
	roundRect(ctx, right - pw, midY - ph / 2, pw, ph, ph / 2);
	ctx.stroke();
	ctx.restore();
	ctx.fillStyle = MINT_SOFT;
	fillSpaced(ctx, text, right - pw + padX, midY + px * 0.36, spacing);
}

function drawCheck(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
) {
	ctx.save();
	ctx.strokeStyle = MINT_LIT;
	ctx.lineWidth = size * 0.16;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(x + size * 0.08, y + size * 0.52);
	ctx.lineTo(x + size * 0.38, y + size * 0.82);
	ctx.lineTo(x + size * 0.92, y + size * 0.22);
	ctx.stroke();
	ctx.restore();
}

/** The QR on a white plate — dark-on-white is the only way a QR scans
 * reliably after a feed's compression. */
function drawQrPlate(
	ctx: CanvasRenderingContext2D,
	qr: CanvasImageSource,
	x: number,
	y: number,
	size: number,
	inset: number,
) {
	ctx.fillStyle = "#FFFFFF";
	roundRect(ctx, x, y, size, size, size * 0.12);
	ctx.fill();
	ctx.drawImage(qr, x + inset, y + inset, size - inset * 2, size - inset * 2);
}

/** Spaced caps that fit `maxW`: shrink toward `minPx`, then ellipsise — a
 * long store name ("Satay Api Mak Nab & Anak-Anak") must never run off. */
function drawFittedSpaced(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	baseline: number,
	maxW: number,
	px: number,
	minPx: number,
) {
	let size = px;
	ctx.font = `700 ${size}px ${SANS}`;
	while (size > minPx && measureSpaced(ctx, text, size * 0.1) > maxW) {
		size -= 1;
		ctx.font = `700 ${size}px ${SANS}`;
	}
	let out = text;
	while (out.length > 1 && measureSpaced(ctx, out, size * 0.1) > maxW) {
		out = `${out.slice(0, -2).trimEnd()}…`;
	}
	ctx.fillStyle = MINT_SOFT;
	fillSpaced(ctx, out, x, baseline, size * 0.1);
}

/** The largest size ≤ `px` at which every line fits `maxW`. */
function fitFont(
	ctx: CanvasRenderingContext2D,
	font: (px: number) => string,
	lines: string[],
	px: number,
	maxW: number,
): number {
	let size = px;
	ctx.font = font(size);
	while (size > 12 && lines.some((l) => ctx.measureText(l).width > maxW)) {
		size -= 2;
		ctx.font = font(size);
	}
	return size;
}

/** Greedy word wrap at `maxWidth`, measured in the current font. */
export function wrapLines(
	ctx: Pick<CanvasRenderingContext2D, "measureText">,
	text: string,
	maxWidth: number,
): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if (line && ctx.measureText(next).width > maxWidth) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function measureSpaced(
	ctx: CanvasRenderingContext2D,
	text: string,
	spacing: number,
): number {
	let wsum = 0;
	for (const ch of text) wsum += ctx.measureText(ch).width + spacing;
	return wsum - spacing;
}

function fillSpaced(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	spacing: number,
) {
	let cx = x;
	for (const ch of text) {
		ctx.fillText(ch, cx, y);
		cx += ctx.measureText(ch).width + spacing;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
