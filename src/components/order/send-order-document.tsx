// Counter-checkout Done-screen actions for getting the order's document to the
// buyer: SEND it straight to their WhatsApp (they scanned the QR once, so we
// have their number — no rescan), or DOWNLOAD / SHARE it via the OS sheet.
//
// The document is a receipt when the order is already paid, an invoice when it's
// pay-later — same PDF, adaptive title (see convex/lib/pdf/render.ts). Both the
// send and the download/share go through orders.* keyed on the owned `shortId`.

import { useAction } from "convex/react";
import { Check, Download, Send, Share2 } from "lucide-react";
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

const SEND_ERROR: Record<string, string> = {
	no_phone: "No WhatsApp number on file for this buyer.",
	not_found: "This order could no longer be found.",
	send_failed: "Couldn't send on WhatsApp just now — try Download or Share.",
	storage: "Couldn't prepare the document — please try again.",
};

export function SendOrderDocument({
	shortId,
	paid,
	buyerName,
	className,
}: {
	shortId: string;
	paid: boolean;
	buyerName?: string;
	className?: string;
}) {
	const send = useAction(api.orders.sendOrderDocumentToBuyer);
	const generate = useAction(api.orders.generateReceiptPdf);
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [sharing, setSharing] = useState(false);

	const noun = paid ? "receipt" : "invoice";
	const Noun = paid ? "Receipt" : "Invoice";
	const who = buyerName?.trim() ? buyerName.trim() : "the buyer";
	const canShare = canSharePdf();

	async function handleSend() {
		setSending(true);
		try {
			const res = await send({ shortId });
			if (res.ok) {
				setSent(true);
				toast.success(`${Noun} sent to ${who} on WhatsApp.`);
			} else {
				toast.error(
					SEND_ERROR[res.reason ?? ""] ?? `Couldn't send the ${noun}.`,
				);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSending(false);
		}
	}

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
					onClick={handleSend}
					isLoading={sending}
					disabled={sending || sent}
					className="h-11 sm:col-span-2"
				>
					{sent ? (
						<>
							<Check className="size-4" /> {Noun} sent on WhatsApp
						</>
					) : (
						<>
							<Send className="size-4" /> Send {noun} to {who}
						</>
					)}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={handleDownload}
					isLoading={downloading}
					disabled={downloading}
					className="h-11"
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
				{who} scanned once to connect, so their {noun} goes straight to that
				WhatsApp chat — no need to scan again.
			</p>
		</div>
	);
}
