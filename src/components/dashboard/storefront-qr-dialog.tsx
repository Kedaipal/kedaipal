import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Download, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef } from "react";
import QRCode from "react-qr-code";
import { api } from "../../../convex/_generated/api";
import { useActAsRetailerId } from "../../hooks/useDashboardRetailer";
import { Button } from "../ui/button";

interface StorefrontQrDialogProps {
	open: boolean;
	onClose: () => void;
	storeName: string;
	storefrontUrl: string;
}

/**
 * Two-QR grab sheet from the dashboard store card: the storefront "Order online"
 * link + the counter "At the counter" walk-in QR, each downloadable as a
 * standalone branded PNG. For the full printable A4 (both QRs, EN/BM), the
 * footer links to /app/poster.
 */
export function StorefrontQrDialog({
	open,
	onClose,
	storeName,
	storefrontUrl,
}: StorefrontQrDialogProps) {
	const actAsRetailerId = useActAsRetailerId();
	const storeQr = useQuery(api.counterCheckout.getStoreQr, {
		retailerId: actAsRetailerId,
	});
	const ensureToken = useMutation(api.counterCheckout.ensureCounterQrToken);
	const ensured = useRef(false);

	// Provision the counter token the first time the sheet needs it.
	useEffect(() => {
		if (!open || ensured.current) return;
		if (storeQr === undefined || storeQr.token !== null) return;
		ensured.current = true;
		void ensureToken({ retailerId: actAsRetailerId }).catch(() => {
			// non-fatal — the counter panel just stays hidden until it resolves
		});
	}, [open, storeQr, ensureToken, actAsRetailerId]);

	const fileBase = storeName.replace(/\s+/g, "-").toLowerCase() || "store";

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					// Bottom sheet on mobile; a centered, width-constrained modal on desktop.
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-[min(46rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							Your QR codes
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
								aria-label="Close"
							>
								<X className="size-5" />
							</button>
						</Dialog.Close>
					</div>

					<div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
						<div className="grid gap-4 sm:grid-cols-2">
							<QrPanel
								title="Order online"
								caption="Browse & order from home"
								storeName={storeName}
								value={storefrontUrl}
								subtitle={storefrontUrl}
								filename={`${fileBase}-storefront-qr.png`}
							/>
							{storeQr?.waUrl ? (
								<QrPanel
									title="At the counter"
									caption="Scan to order in person on WhatsApp"
									storeName={storeName}
									value={storeQr.waUrl}
									subtitle="Scan to order at the counter"
									filename={`${fileBase}-counter-qr.png`}
								/>
							) : (
								<div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
									Counter QR loading…
								</div>
							)}
						</div>

						<Link
							to="/app/poster"
							onClick={onClose}
							className="text-center text-xs font-semibold text-accent-emphasis hover:underline"
						>
							Want a printable A4 poster with both QRs? →
						</Link>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** One labelled QR card + its own Download-PNG button. */
function QrPanel({
	title,
	caption,
	storeName,
	value,
	subtitle,
	filename,
}: {
	title: string;
	caption: string;
	storeName: string;
	value: string;
	subtitle: string;
	filename: string;
}) {
	const ref = useRef<HTMLDivElement>(null);

	async function download() {
		const svg = ref.current?.querySelector("svg");
		if (!svg) return;

		const QR_SIZE = 400;
		const PADDING = 60;
		const TEXT_GAP = 32;
		const titleFontSize = 22;
		const subFontSize = 14;
		const CANVAS_W = QR_SIZE + PADDING * 2;
		const CANVAS_H =
			PADDING +
			(titleFontSize + TEXT_GAP) +
			QR_SIZE +
			(subFontSize + TEXT_GAP) +
			PADDING;

		const canvas = document.createElement("canvas");
		canvas.width = CANVAS_W;
		canvas.height = CANVAS_H;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
		ctx.textAlign = "center";
		ctx.fillStyle = "#111827";
		ctx.font = `bold ${titleFontSize}px system-ui, -apple-system, sans-serif`;
		ctx.fillText(storeName, CANVAS_W / 2, PADDING + titleFontSize);

		const svgStr = new XMLSerializer().serializeToString(svg);
		const url = URL.createObjectURL(
			new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }),
		);
		const qrY = PADDING + titleFontSize + TEXT_GAP;
		await new Promise<void>((resolve) => {
			const img = new Image();
			img.onload = () => {
				ctx.drawImage(img, (CANVAS_W - QR_SIZE) / 2, qrY, QR_SIZE, QR_SIZE);
				resolve();
			};
			img.src = url;
		});
		URL.revokeObjectURL(url);

		ctx.fillStyle = "#6b7280";
		ctx.font = `500 ${subFontSize}px ui-monospace, SFMono-Regular, monospace`;
		ctx.fillText(
			subtitle,
			CANVAS_W / 2,
			qrY + QR_SIZE + TEXT_GAP + subFontSize / 2,
		);

		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = filename;
			a.click();
			URL.revokeObjectURL(a.href);
		}, "image/png");
	}

	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
			<div>
				<p className="text-sm font-semibold">{title}</p>
				<p className="text-xs text-muted-foreground">{caption}</p>
			</div>
			<div className="flex justify-center rounded-xl bg-white p-4 ring-1 ring-black/5">
				<div ref={ref}>
					<QRCode value={value} size={160} level="M" />
				</div>
			</div>
			<Button
				onClick={download}
				variant="outline"
				className="h-10 w-full gap-2"
			>
				<Download className="size-4" />
				Download PNG
			</Button>
		</div>
	);
}
