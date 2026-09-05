// "Download PDF" for a subscription invoice — or, once it's paid, for its
// payment RECEIPT (z8r3fdcrzj): `kind` picks which of the invoice's two frozen
// documents to fetch. The invoice PDF is rendered + stored at issue time
// (invoices.generateInvoicePdf), the receipt at mark-paid
// (generateInvoiceReceiptPdf); both endpoints render on demand for legacy rows.
// This fetches the ownership-checked signed URL on click and opens it. Shared
// by the seller billing tab and the admin billing console. See
// docs/invoices-receipts.md.

import { useAction } from "convex/react";
import { Download, Loader2, ReceiptText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

export function InvoiceDownloadButton({
	invoiceId,
	kind = "invoice",
	label = "Download PDF",
	variant = "outline",
	size = "sm",
	className,
}: {
	invoiceId: Id<"invoices">;
	// Which frozen document to fetch: the bill ("invoice") or, for a paid
	// invoice, its proof of payment ("receipt"). Callers only render the
	// receipt variant on paid rows — the backend refuses it otherwise.
	kind?: "invoice" | "receipt";
	label?: string;
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
}) {
	const getOrCreateInvoiceUrl = useAction(
		api.invoices.getOrCreateInvoicePdfUrl,
	);
	const getOrCreateReceiptUrl = useAction(
		api.invoices.getOrCreateInvoiceReceiptPdfUrl,
	);
	const [busy, setBusy] = useState(false);

	async function handleDownload() {
		setBusy(true);
		try {
			// Renders the PDF on demand if missing (legacy/just-issued rows).
			const url =
				kind === "receipt"
					? await getOrCreateReceiptUrl({ invoiceId })
					: await getOrCreateInvoiceUrl({ invoiceId });
			if (!url) {
				toast.error(`Couldn't prepare the ${kind} PDF. Please try again.`);
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
			aria-label={label || `Download ${kind} PDF`}
			title={label || `Download ${kind} PDF`}
		>
			{busy ? (
				<Loader2 className="size-4 animate-spin" />
			) : kind === "receipt" ? (
				<ReceiptText className="size-4" />
			) : (
				<Download className="size-4" />
			)}
			{label ? <span>{label}</span> : null}
		</Button>
	);
}
