import { Download, QrCode, Send } from "lucide-react";
import { useRef } from "react";
import QRCode from "react-qr-code";
import type { VoucherKind } from "../../../convex/lib/vouchers";
import { formatVoucherTerms } from "../../../convex/lib/vouchers";
import { formatPrice } from "../../lib/format";
import { voucherCheckoutUrl } from "../../lib/storefront-url";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/**
 * The voucher share sheet — the code / QR / link trio from docs/vouchers.md,
 * each labelled with WHERE it is used, so the seller never has to work out
 * which one to send or explain it to a buyer.
 *
 * The three exist because the buyer is in one of two places when they redeem:
 *
 *  - the CODE is the voucher itself, for reading out loud and typing;
 *  - the QR encodes the PLAIN CODE as text, not a URL — so any camera app at a
 *    stall decodes it to `KP-7F3K-Q2WM` with no scanner app, no deep link and
 *    no sign-in, and the seller keys it into the counter. A URL QR would open
 *    the seller's own storefront checkout, a buyer surface on the wrong side of
 *    the counter;
 *  - the LINK opens the storefront checkout with `?voucher=` already applied,
 *    which is what a buyer on their own phone needs (they cannot scan their own
 *    screen).
 *
 * The WhatsApp button is the common case — most vouchers are sent, not handed
 * over — so it leads, and the message names the store, the value and the
 * expiry rather than pasting a bare URL.
 */

export interface ShareableVoucher {
	code: string;
	kind: VoucherKind;
	value: number;
	currency: string;
	expiresAt?: number;
}

export function VoucherShareSheet({
	voucher,
	storeName,
	slug,
	onClose,
}: {
	voucher: ShareableVoucher | null;
	storeName: string;
	slug: string;
	onClose: () => void;
}) {
	return (
		<Dialog open={voucher !== null} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				{voucher ? (
					<VoucherShareBody
						voucher={voucher}
						storeName={storeName}
						slug={slug}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function VoucherShareBody({
	voucher,
	storeName,
	slug,
}: {
	voucher: ShareableVoucher;
	storeName: string;
	slug: string;
}) {
	const qrRef = useRef<HTMLDivElement>(null);
	const worth = formatVoucherTerms(voucher, (sen) =>
		formatPrice(sen, voucher.currency),
	);
	const link = voucherCheckoutUrl(slug, voucher.code);
	const expiryLine =
		voucher.expiresAt === undefined
			? "It has no expiry date."
			: `Valid until ${new Date(voucher.expiresAt).toLocaleDateString("en-MY", {
					day: "numeric",
					month: "long",
					year: "numeric",
					timeZone: "Asia/Kuala_Lumpur",
				})}.`;
	// Names the store, the value and the expiry — a bare link tells the buyer
	// nothing and reads like spam in a WhatsApp thread.
	const waText = `Here's your ${worth} voucher for ${storeName} 🎁\n\nCode: ${voucher.code}\n${expiryLine}\n\nTap to shop with it already applied:\n${link}`;
	const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

	return (
		<>
			<DialogHeader>
				<DialogTitle>Share this voucher</DialogTitle>
				<DialogDescription>
					{worth} · one use · {expiryLine.replace(/\.$/, "")}
				</DialogDescription>
			</DialogHeader>

			<div className="flex flex-col gap-5">
				{/* Send — the common case, so it leads. */}
				<Button asChild className="tap-target w-full gap-2">
					<a href={waUrl} target="_blank" rel="noreferrer">
						<Send className="size-4" aria-hidden />
						Send on WhatsApp
					</a>
				</Button>

				{/* The code. */}
				<section className="flex flex-col gap-2">
					<div>
						<h3 className="text-sm font-semibold">The code</h3>
						<p className="text-xs text-muted-foreground">
							Read it out, or type it in at the counter.
						</p>
					</div>
					<div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
						<code className="min-w-0 flex-1 truncate font-mono text-base font-bold tracking-wider">
							{voucher.code}
						</code>
						<CopyButton value={voucher.code} label="Copy code" />
					</div>
				</section>

				{/* The QR — the counter artifact. */}
				<section className="flex flex-col gap-2">
					<div>
						<h3 className="flex items-center gap-1.5 text-sm font-semibold">
							<QrCode className="size-3.5 text-muted-foreground" aria-hidden />
							The QR — for the counter
						</h3>
						<p className="text-xs text-muted-foreground">
							The buyer shows this at your stall. Point any phone camera at it
							and the code appears — no app needed.
						</p>
					</div>
					<div className="flex justify-center rounded-xl bg-white p-4 ring-1 ring-black/5">
						<div ref={qrRef}>
							{/* The PLAIN CODE as text, never a URL — see the file header. */}
							<QRCode value={voucher.code} size={150} level="M" />
						</div>
					</div>
					<Button
						variant="outline"
						className="tap-target w-full gap-2"
						onClick={() => downloadQr(qrRef.current, voucher, storeName, worth)}
					>
						<Download className="size-4" aria-hidden />
						Download QR
					</Button>
				</section>

				{/* The link. */}
				<section className="flex flex-col gap-2">
					<div>
						<h3 className="text-sm font-semibold">The link</h3>
						<p className="text-xs text-muted-foreground">
							Opens your store with the voucher already applied — for a buyer
							shopping on their own phone.
						</p>
					</div>
					<div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
						<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
							{link}
						</span>
						<CopyButton value={link} label="Copy link" />
					</div>
				</section>
			</div>
		</>
	);
}

/**
 * Download the QR as a branded PNG — the printable artifact for a market-day
 * stack of codes. Mirrors the storefront QR dialog's canvas approach: the code
 * is printed UNDER the QR in large monospace, because the whole point of the
 * unambiguous alphabet is that a human can read it off the paper when a camera
 * won't focus.
 */
async function downloadQr(
	host: HTMLDivElement | null,
	voucher: ShareableVoucher,
	storeName: string,
	worth: string,
): Promise<void> {
	const svg = host?.querySelector("svg");
	if (!svg) return;

	const QR = 400;
	const PAD = 56;
	const W = QR + PAD * 2;
	const titleSize = 22;
	const worthSize = 17;
	const codeSize = 30;
	const gap = 26;
	const H = PAD + titleSize + gap + worthSize + gap + QR + gap + codeSize + PAD;

	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, W, H);
	ctx.textAlign = "center";

	let y = PAD + titleSize;
	ctx.fillStyle = "#111827";
	ctx.font = `bold ${titleSize}px system-ui, -apple-system, sans-serif`;
	ctx.fillText(storeName, W / 2, y);

	y += gap + worthSize;
	ctx.fillStyle = "#059669";
	ctx.font = `bold ${worthSize}px system-ui, -apple-system, sans-serif`;
	ctx.fillText(`${worth} · one use`, W / 2, y);

	const qrY = y + gap;
	const svgStr = new XMLSerializer().serializeToString(svg);
	const url = URL.createObjectURL(
		new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }),
	);
	await new Promise<void>((resolve) => {
		const img = new Image();
		img.onload = () => {
			ctx.drawImage(img, (W - QR) / 2, qrY, QR, QR);
			resolve();
		};
		// A QR that never decodes is worse than no download — resolve either way
		// so the file still carries the readable code.
		img.onerror = () => resolve();
		img.src = url;
	});
	URL.revokeObjectURL(url);

	ctx.fillStyle = "#111827";
	ctx.font = `bold ${codeSize}px ui-monospace, SFMono-Regular, monospace`;
	ctx.fillText(voucher.code, W / 2, qrY + QR + gap + codeSize * 0.8);

	canvas.toBlob((blob) => {
		if (!blob) return;
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `voucher-${voucher.code}.png`;
		a.click();
		URL.revokeObjectURL(a.href);
	}, "image/png");
}
