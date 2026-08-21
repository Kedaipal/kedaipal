/**
 * "Print label" on the seller's order detail (86eyp63mp) — one despatch label
 * for this order, rendered on demand by `awb.generateAwbPdf`.
 *
 * Sits BEFORE the receipt download in the actions row: the label is the
 * operational step (do it now, the parcel is going out), the receipt is
 * bookkeeping (any time after). All-tier — a seller shipping a parcel must
 * always be able to put an address on it.
 *
 * The button renders only for orders that can carry a label (a live order with
 * a delivery address); its absence on a pickup order is self-explanatory, and
 * the batch print is where skipped orders get counted and explained.
 */

import { useAction } from "convex/react";
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

/** Whether this order can carry a despatch label — mirrors the server's
 * `labelSkipReason`, which is the real gate. */
export function canPrintLabel(order: {
	status: string;
	deliveryAddress?: unknown;
}): boolean {
	return order.status !== "cancelled" && Boolean(order.deliveryAddress);
}

const FAILURE_COPY: Record<string, string> = {
	not_found: "That order is no longer available.",
	cancelled: "Cancelled orders don't get a despatch label.",
	no_address: "This order has no delivery address to print.",
};

export function PrintLabelButton({
	shortId,
	variant,
	size,
	className,
	label = "Print label",
}: {
	shortId: string;
	variant?: React.ComponentProps<typeof Button>["variant"];
	size?: React.ComponentProps<typeof Button>["size"];
	className?: string;
	label?: string;
}) {
	const generate = useAction(api.awb.generateAwbPdf);
	const [busy, setBusy] = useState(false);

	async function handlePrint() {
		setBusy(true);
		try {
			const res = await generate({ shortId });
			if (!res.ok) {
				toast.error(FAILURE_COPY[res.reason] ?? "Label unavailable.");
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
			variant={variant ?? "outline"}
			size={size ?? "sm"}
			onClick={handlePrint}
			disabled={busy}
			className={className}
		>
			{busy ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<Printer className="size-4" />
			)}
			{label}
		</Button>
	);
}
