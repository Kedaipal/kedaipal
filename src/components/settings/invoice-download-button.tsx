// "Download PDF" for a subscription invoice. The PDF is rendered + stored at
// issue time (invoices.generateInvoicePdf); this fetches the ownership-checked
// signed URL on click and opens it. Shared by the seller billing tab and the
// admin billing console. See docs/invoices-receipts.md.

import { useAction } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

export function InvoiceDownloadButton({
	invoiceId,
	label = "Download PDF",
	variant = "outline",
	size = "sm",
	className,
}: {
	invoiceId: Id<"invoices">;
	label?: string;
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
}) {
	const getOrCreateUrl = useAction(api.invoices.getOrCreateInvoicePdfUrl);
	const [busy, setBusy] = useState(false);

	async function handleDownload() {
		setBusy(true);
		try {
			// Renders the PDF on demand if missing (legacy/just-issued invoices).
			const url = await getOrCreateUrl({ invoiceId });
			if (!url) {
				toast.error("Couldn't prepare the invoice PDF. Please try again.");
				return;
			}
			window.open(url, "_blank", "noopener");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Button
			type="button"
			variant={variant}
			size={size}
			onClick={handleDownload}
			disabled={busy}
			className={className}
			aria-label={label || "Download invoice PDF"}
			title={label || "Download invoice PDF"}
		>
			{busy ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<Download className="size-4" />
			)}
			{label ? <span>{label}</span> : null}
		</Button>
	);
}
