import { Download } from "lucide-react";
import { useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { referralShareImageCopy } from "../../../convex/lib/referral";
import { shareImageFilename } from "../../lib/referral-share";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/**
 * The referral SHARE IMAGE (the 28 Oct 2026 push, docs/referrals.md): a
 * 1080 × 1080 card — the store's name, the offer in orders, the link and a QR
 * of it — for the places a text link can't travel: an Instagram story, a
 * Facebook seller group, a WhatsApp status.
 *
 * Two renderings of ONE copy author (`referralShareImageCopy`): the on-screen
 * preview is DOM (so it is responsive and readable in the dialog), the
 * download is drawn on a canvas at full size (the QR is the preview's own
 * SVG, serialised and rasterised — the storefront QR dialog's trick). The
 * card is a fixed-colour brand surface, the same in both themes, like the
 * poster: the navy is the house `--segment`, the mint the house accent.
 */

/** The canvas is a brand card, drawn in fixed colours — the same values the
 * preview's classes resolve to, so download and preview can't disagree. */
const NAVY = "#1E2A52";
const MINT = "#A7F3D0";
const INK = "#F8FAFC";
const INK_SOFT = "rgba(248,250,252,0.82)";
const SIZE = 1080;
const PAD = 96;
const QR_PLATE = 272;
const QR_SIZE = 232;

export function ShareImageDialog({
	open,
	onClose,
	storeName,
	slug,
	link,
	onDownloaded,
}: {
	open: boolean;
	onClose: () => void;
	storeName: string;
	slug: string;
	link: string;
	/** Analytics: the image was saved (the "share" moment for this channel). */
	onDownloaded?: () => void;
}) {
	const qrRef = useRef<HTMLDivElement>(null);
	const [saving, setSaving] = useState(false);
	const copy = referralShareImageCopy(storeName);
	const linkLabel = link.replace(/^https?:\/\//, "");

	async function download() {
		const svg = qrRef.current?.querySelector("svg");
		if (!svg) return;
		setSaving(true);
		try {
			const canvas = document.createElement("canvas");
			canvas.width = SIZE;
			canvas.height = SIZE;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no canvas");
			const heading = (px: number) =>
				`800 ${px}px "Red Hat Display Variable", "Red Hat Display", system-ui, sans-serif`;
			const sans = (px: number, weight = 500) =>
				`${weight} ${px}px "Geist Variable", "Geist", system-ui, sans-serif`;
			const mono = (px: number) =>
				`600 ${px}px "Geist Mono Variable", "Geist Mono", ui-monospace, Menlo, monospace`;

			ctx.fillStyle = NAVY;
			ctx.fillRect(0, 0, SIZE, SIZE);

			// Eyebrow — the store's name, the part a friend recognises.
			ctx.fillStyle = MINT;
			ctx.font = sans(34, 700);
			ctx.textBaseline = "alphabetic";
			fillSpaced(ctx, copy.eyebrow.toUpperCase(), PAD, PAD + 44, 4);

			// Headline — the offer, in orders.
			ctx.fillStyle = INK;
			ctx.font = heading(128);
			let y = PAD + 44 + 150;
			for (const line of wrapLines(ctx, copy.headline, SIZE - PAD * 2)) {
				ctx.fillText(line, PAD, y);
				y += 132;
			}

			// Body — what Kedaipal does and what they get.
			ctx.fillStyle = INK_SOFT;
			ctx.font = sans(40);
			y += 24;
			for (const line of wrapLines(ctx, copy.body, 620)) {
				ctx.fillText(line, PAD, y);
				y += 54;
			}

			// The link, bottom-left, two lines so a long slug never collides
			// with the QR plate.
			ctx.fillStyle = MINT;
			ctx.font = mono(36);
			const [host, ...rest] = linkLabel.split("/referral/");
			ctx.fillText(`${host}/`, PAD, SIZE - PAD - 52);
			ctx.fillText(`referral/${rest.join("")}`, PAD, SIZE - PAD - 4);

			// The QR on a white plate, bottom-right. White on purpose: a QR on
			// navy scans badly in a feed's compression.
			const plateX = SIZE - PAD - QR_PLATE;
			const plateY = SIZE - PAD - QR_PLATE;
			ctx.fillStyle = "#FFFFFF";
			roundRect(ctx, plateX, plateY, QR_PLATE, QR_PLATE, 24);
			ctx.fill();
			const svgStr = new XMLSerializer().serializeToString(svg);
			const url = URL.createObjectURL(
				new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }),
			);
			await new Promise<void>((resolve, reject) => {
				const img = new Image();
				img.onload = () => {
					ctx.drawImage(
						img,
						plateX + (QR_PLATE - QR_SIZE) / 2,
						plateY + (QR_PLATE - QR_SIZE) / 2,
						QR_SIZE,
						QR_SIZE,
					);
					resolve();
				};
				img.onerror = () => reject(new Error("qr"));
				img.src = url;
			});
			URL.revokeObjectURL(url);

			await new Promise<void>((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (!blob) return reject(new Error("blob"));
					const a = document.createElement("a");
					a.href = URL.createObjectURL(blob);
					a.download = shareImageFilename(slug);
					a.click();
					URL.revokeObjectURL(a.href);
					resolve();
				}, "image/png");
			});
			onDownloaded?.();
		} catch {
			toast.error(
				"Couldn't build the image — try again, or copy the link instead.",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share image</DialogTitle>
					<DialogDescription>
						For an Instagram story, a Facebook seller group or a WhatsApp status
						— anywhere a link alone won't travel. The QR opens your referral
						link.
					</DialogDescription>
				</DialogHeader>
				{/* dark-ok: the share image is a fixed-colour brand card (navy +
				    mint), the same in both themes — like the printed poster. */}
				<div
					className="relative flex aspect-square w-full flex-col justify-between overflow-hidden rounded-2xl bg-segment p-5 text-segment-foreground"
					data-testid="share-image-preview"
				>
					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
							{copy.eyebrow}
						</span>
						<span className="font-heading text-[clamp(1.6rem,8vw,2.25rem)] font-extrabold leading-[1.05] tracking-tight">
							{copy.headline}
						</span>
						<span className="max-w-[60%] text-[13px] leading-snug text-segment-foreground/80">
							{copy.body}
						</span>
					</div>
					<div className="flex items-end justify-between gap-3">
						<span className="break-all font-mono text-[11px] leading-snug text-accent">
							{linkLabel}
						</span>
						<div
							ref={qrRef}
							className="shrink-0 rounded-lg bg-white p-1.5" // dark-ok: a QR must stay dark-on-white to scan
						>
							<QRCode value={link} size={72} level="M" />
						</div>
					</div>
				</div>
				<Button onClick={download} isLoading={saving} className="h-11 w-full">
					<Download className="size-4" aria-hidden="true" />
					Download PNG
				</Button>
			</DialogContent>
		</Dialog>
	);
}

/** Greedy word wrap at `maxWidth`, measured in the current font. */
function wrapLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (ctx.measureText(next).width > maxWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Letter-spaced text — canvas has no `letter-spacing` everywhere yet. */
function fillSpaced(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	spacing: number,
): void {
	let cursor = x;
	for (const ch of text) {
		ctx.fillText(ch, cursor, y);
		cursor += ctx.measureText(ch).width + spacing;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}
