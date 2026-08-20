/**
 * "Ready to ship" — one tap prints a despatch label for every order that's
 * packed, paid for and going out by courier (86eyp63mp).
 *
 * WHERE IT LIVES, and why: in the order inbox, in the same slot as the
 * due-today banner — the inbox's established home for "there is work waiting,
 * here is the one tap that does it" — and directly BELOW it, because a deadline
 * outranks a task you can finish whenever you like. Not in the bulk bar: that
 * bar only exists inside select mode, and the whole point of this control is
 * that it needs no selection.
 *
 * It renders whenever the store offers delivery, INCLUDING at zero, where the
 * button is disabled with the reason. The count is the discoverability
 * affordance: it teaches the feature exists and says how much work is waiting,
 * and a seller can never tap into an empty PDF. A pickup-only store has no
 * despatch queue by definition, so it never sees this at all.
 *
 * Printing deliberately does NOT advance anything to "sent" — a label in the
 * printer tray is not a parcel in a courier's hands. The seller still marks
 * them sent from the bulk bar when they actually hand them over, and the
 * success toast says so.
 */

import { useAction } from "convex/react";
import { Loader2, PackageCheck, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { describeAwbSkips } from "../../lib/awb-labels";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

export function ReadyToShipStrip({
	retailerId,
	count,
}: {
	retailerId: Id<"retailers">;
	/** Packed + paid parcel orders, over the store's whole inbox — not the
	 * current filter, so the number is the real backlog. */
	count: number;
}) {
	const generate = useAction(api.awb.generateAwbBatchPdf);
	const [busy, setBusy] = useState(false);
	const empty = count === 0;

	async function handlePrint() {
		setBusy(true);
		try {
			// No `orderIds` = the server resolves the ready-to-ship queue itself,
			// so the print is never limited to the page the inbox happens to hold.
			const res = await generate({ retailerId });
			if (res.count === 0) {
				toast.message("Nothing is packed and paid for right now.");
				return;
			}
			downloadPdfBytes(res.filename, res.pdf);
			const skips = describeAwbSkips(res.skipped);
			toast.success(
				`${res.count} label${res.count === 1 ? "" : "s"} ready — mark them sent once the courier has them.${
					skips ? ` ${skips}` : ""
				}`,
			);
			if (res.remaining > 0) {
				toast.warning(
					`${res.remaining} more ${res.remaining === 1 ? "order is" : "orders are"} still ready — print them in a second batch.`,
				);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="flex items-center gap-3 rounded-2xl border border-input bg-card px-4 py-3">
			<PackageCheck
				className="size-5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-foreground">
					{empty ? "Ready to ship" : `${count} ready to ship`}
				</p>
				<p className="text-xs text-muted-foreground">
					{empty
						? "Packed and paid orders show up here for one-tap label printing."
						: "Packed, paid and going out by courier."}
				</p>
			</div>
			<Button
				type="button"
				size="sm"
				variant={empty ? "outline" : "default"}
				className="tap-target shrink-0"
				onClick={handlePrint}
				disabled={busy || empty}
				title={
					empty ? "Nothing is packed and paid for yet" : `Print ${count} labels`
				}
			>
				{busy ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Printer className="size-4" />
				)}
				<span className="hidden sm:inline">
					{busy ? "Building…" : "Print labels"}
				</span>
				{!empty && !busy ? (
					<span className="font-bold tabular-nums">{count}</span>
				) : null}
			</Button>
		</section>
	);
}
