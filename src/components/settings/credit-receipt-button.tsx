// "Download receipt" for a paid credit-pack top-up (Credits T2, z8r3fdf8ht) —
// the sibling of InvoiceDownloadButton's receipt variant. The receipt PDF is
// frozen when the payment lands (creditPurchases.finalizePaidPurchase); the
// action renders it on demand if that hasn't happened yet, behind a credits
// READ check. Used by the billing history and the top-up dialog's paid state.

import { useAction } from "convex/react";
import { Loader2, ReceiptText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function CreditReceiptButton({
	purchaseId,
	label = "",
	variant = "ghost",
	size = "icon",
	className,
}: {
	purchaseId: Id<"creditPurchases">;
	/** Empty = icon-only (the history list); the name is then the aria-label. */
	label?: string;
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
}) {
	const getOrCreateUrl = useAction(
		api.creditPurchases.getOrCreateReceiptPdfUrl,
	);
	const [busy, setBusy] = useState(false);

	async function handleDownload() {
		setBusy(true);
		try {
			const url = await getOrCreateUrl({ purchaseId });
			if (!url) {
				toast.error("Couldn't prepare the receipt. Please try again.");
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
			className={cn("tap-target", className)}
			aria-label={label || "Download receipt PDF"}
			title={label || "Download receipt PDF"}
		>
			{busy ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<ReceiptText className="size-4" />
			)}
			{label ? <span>{label}</span> : null}
		</Button>
	);
}
