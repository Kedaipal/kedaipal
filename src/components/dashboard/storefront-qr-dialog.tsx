import { Link } from "@tanstack/react-router";
import { Download, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef } from "react";
import QRCode from "react-qr-code";
import { Button } from "../ui/button";

interface StorefrontQrDialogProps {
	open: boolean;
	onClose: () => void;
	storeName: string;
	storefrontUrl: string;
}

export function StorefrontQrDialog({
	open,
	onClose,
	storeName,
	storefrontUrl,
}: StorefrontQrDialogProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	async function handleDownload() {
		const svg = containerRef.current?.querySelector("svg");
		if (!svg) return;

		const QR_SIZE = 400;
		const PADDING = 60;
		const TEXT_GAP = 32;
		const CANVAS_W = QR_SIZE + PADDING * 2;

		// Measure text heights
		const titleFontSize = 22;
		const urlFontSize = 14;
		const topTextHeight = titleFontSize + TEXT_GAP;
		const bottomTextHeight = urlFontSize + TEXT_GAP;
		const CANVAS_H =
			PADDING + topTextHeight + QR_SIZE + bottomTextHeight + PADDING;

		const canvas = document.createElement("canvas");
		canvas.width = CANVAS_W;
		canvas.height = CANVAS_H;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// White background with rounded appearance
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

		// Store name
		ctx.fillStyle = "#111827";
		ctx.font = `bold ${titleFontSize}px system-ui, -apple-system, sans-serif`;
		ctx.textAlign = "center";
		ctx.fillText(storeName, CANVAS_W / 2, PADDING + titleFontSize);

		// QR code
		const serializer = new XMLSerializer();
		const svgStr = serializer.serializeToString(svg);
		const svgBlob = new Blob([svgStr], {
			type: "image/svg+xml;charset=utf-8",
		});
		const url = URL.createObjectURL(svgBlob);

		const qrY = PADDING + topTextHeight;

		await new Promise<void>((resolve) => {
			const img = new Image();
			img.onload = () => {
				ctx.drawImage(img, (CANVAS_W - QR_SIZE) / 2, qrY, QR_SIZE, QR_SIZE);
				resolve();
			};
			img.src = url;
		});

		URL.revokeObjectURL(url);

		// URL label
		ctx.fillStyle = "#6b7280";
		ctx.font = `500 ${urlFontSize}px ui-monospace, SFMono-Regular, monospace`;
		ctx.textAlign = "center";
		ctx.fillText(
			storefrontUrl,
			CANVAS_W / 2,
			qrY + QR_SIZE + TEXT_GAP + urlFontSize / 2,
		);

		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = `${storeName.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
			a.click();
			URL.revokeObjectURL(a.href);
		}, "image/png");
	}

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
					aria-describedby={undefined}
				>
					{/* Header */}
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							QR Code
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

					{/* Body */}
					<div className="flex flex-col items-center gap-6 overflow-y-auto px-6 py-6">
						{/* QR Card */}
						<div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
							<p className="text-sm font-semibold text-gray-900">{storeName}</p>
							<div ref={containerRef}>
								<QRCode value={storefrontUrl} size={200} level="M" />
							</div>
							<p className="font-mono text-xs text-gray-500">{storefrontUrl}</p>
						</div>

						{/* Download button */}
						<Button onClick={handleDownload} className="h-11 w-full gap-2">
							<Download className="size-4" />
							Download PNG
						</Button>

						<p className="px-4 text-center text-xs text-muted-foreground">
							Print this QR code at your counter or share it digitally.
						</p>
						<Link
							to="/app/poster"
							onClick={onClose}
							className="pb-2 text-center text-xs font-semibold text-accent-emphasis hover:underline"
						>
							Want a printable A4 poster for your counter? →
						</Link>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
