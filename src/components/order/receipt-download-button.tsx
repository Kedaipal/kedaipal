// "Download receipt" button shared by the seller's order detail (passes the
// owned `shortId`) and the buyer's tracking page (passes the capability
// `token`). The receipt is rendered on demand by orders.generateReceiptPdf —
// the same auth seam (resolveSharedOrder) gates both callers. See
// docs/invoices-receipts.md.

import { useAction } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

type Props = ({ shortId: string } | { token: string }) & {
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
	label?: string;
};

export function ReceiptDownloadButton(props: Props) {
	const generate = useAction(api.orders.generateReceiptPdf);
	const [busy, setBusy] = useState(false);

	async function handleDownload() {
		setBusy(true);
		try {
			const args =
				"shortId" in props
					? { shortId: props.shortId }
					: { token: props.token };
			const res = await generate(args);
			if (!res) {
				toast.error("Receipt unavailable for this order.");
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
			{props.label ?? "Receipt"}
		</Button>
	);
}
