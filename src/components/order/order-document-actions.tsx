// Counter-checkout Done-screen actions for handing the order's document to the
// buyer while they're still standing there: DOWNLOAD it, or SHARE it via the OS
// sheet (AirDrop, Files, WhatsApp — whatever they use).
//
// The document is a receipt when the order is already paid, an invoice when it's
// pay-later — same PDF, adaptive title (see convex/lib/pdf/render.ts).
//
// It is NOT WhatsApp'd (86eyd63r8): an order sends the buyer exactly one
// message, and for a counter order that's the confirmation carrying their order
// link. The buyer can open (and download) this same document from that page
// whenever they want, so this is purely the "here, take a copy now" tool.

import { useAction } from "convex/react";
import { Download, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	canSharePdf,
	downloadPdfBytes,
	sharePdfBytes,
} from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

export function OrderDocumentActions({
	shortId,
	paid,
	buyerName,
	hasBuyer = true,
	className,
}: {
	shortId: string;
	paid: boolean;
	buyerName?: string;
	// Anonymous cash sale (86ey8vqp6) — no WhatsApp went out, so there's no order
	// page the buyer can reach on their own; this is their only copy.
	hasBuyer?: boolean;
	className?: string;
}) {
	const generate = useAction(api.orders.generateReceiptPdf);
	const [downloading, setDownloading] = useState(false);
	const [sharing, setSharing] = useState(false);

	const noun = paid ? "receipt" : "invoice";
	const Noun = paid ? "Receipt" : "Invoice";
	const who = buyerName?.trim() ? buyerName.trim() : "the buyer";
	const canShare = canSharePdf();

	async function fetchPdf(): Promise<{
		pdf: ArrayBuffer;
		filename: string;
	} | null> {
		const res = await generate({ shortId });
		if (!res) {
			toast.error(`${Noun} unavailable for this order.`);
			return null;
		}
		return res;
	}

	async function handleDownload() {
		setDownloading(true);
		try {
			const res = await fetchPdf();
			if (res) downloadPdfBytes(res.filename, res.pdf);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setDownloading(false);
		}
	}

	async function handleShare() {
		setSharing(true);
		try {
			const res = await fetchPdf();
			if (!res) return;
			const outcome = await sharePdfBytes(res.filename, res.pdf, {
				title: `${Noun} ${shortId}`,
			});
			// Sheet unavailable (e.g. desktop) → save the file instead so the action
			// never dead-ends. A user-cancelled sheet is intentional — stay silent.
			if (outcome === "unsupported") downloadPdfBytes(res.filename, res.pdf);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSharing(false);
		}
	}

	return (
		<div className={className}>
			<div className="grid gap-2 sm:grid-cols-2">
				<Button
					type="button"
					onClick={handleDownload}
					isLoading={downloading}
					disabled={downloading}
					className={canShare ? "h-11" : "h-11 sm:col-span-2"}
				>
					{!downloading && <Download className="size-4" />}
					Download
				</Button>
				{canShare ? (
					<Button
						type="button"
						variant="outline"
						onClick={handleShare}
						isLoading={sharing}
						disabled={sharing}
						className="h-11"
					>
						{!sharing && <Share2 className="size-4" />}
						Share
					</Button>
				) : null}
			</div>
			<p className="mt-2 text-xs text-muted-foreground">
				{hasBuyer
					? `Hand ${who} their ${noun} now if they want one. It isn't sent on WhatsApp — they can open it any time from the order page we linked them to.`
					: `Cash sale — no WhatsApp on file, so this is ${who === "the buyer" ? "their" : `${who}'s`} only copy. Download or share the ${noun} if they'd like one.`}
			</p>
		</div>
	);
}
