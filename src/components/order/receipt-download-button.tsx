// Download button for an order's document, shared by the seller's order detail
// (passes the owned `shortId`) and the buyer's tracking page (passes the
// capability `token`). The PDF is rendered on demand by
// orders.generateReceiptPdf — the same auth seam (resolveSharedOrder) gates
// both callers. See docs/invoices-receipts.md.
//
// The document has two faces (convex/lib/orderDocument.ts): a settled order is
// a RECEIPT, an unpaid/claimed one is an INVOICE — the seller chasing a
// corporate payment needs to find "Download invoice", not guess that a button
// labelled "receipt" prints one (z8r3fdcrzj). Callers pass `paid` and the
// label derives here, so a call site can't reintroduce the wrong noun.

import { useAction } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	orderDocumentNoun,
	orderDocumentTitle,
} from "../../../convex/lib/orderDocument";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

type Props = ({ shortId: string } | { token: string }) & {
	// Drives the label + toasts: true → "Download receipt", false → "Download
	// invoice". Pass isOrderDocPaid(order.paymentStatus) — the same predicate
	// the PDF titles itself with.
	paid: boolean;
	// Appends " (PDF)" — the buyer tracking page sets this so shoppers know
	// they're getting a file, not another page.
	pdfHint?: boolean;
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
};

export function ReceiptDownloadButton(props: Props) {
	const generate = useAction(api.orders.generateReceiptPdf);
	const [busy, setBusy] = useState(false);

	const noun = orderDocumentNoun(props.paid);
	const label = `Download ${noun}${props.pdfHint ? " (PDF)" : ""}`;

	async function handleDownload() {
		setBusy(true);
		try {
			const args =
				"shortId" in props
					? { shortId: props.shortId }
					: { token: props.token };
			const res = await generate(args);
			if (!res) {
				toast.error(
					`${orderDocumentTitle(props.paid)} unavailable for this order.`,
				);
				return;
			}
			downloadPdfBytes(res.filename, res.pdf);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Button
			type="button"
			variant={props.variant ?? "outline"}
			size={props.size ?? "sm"}
			onClick={handleDownload}
			disabled={busy}
			className={props.className}
		>
			{busy ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<Download className="size-4" />
			)}
			{label}
		</Button>
	);
}
