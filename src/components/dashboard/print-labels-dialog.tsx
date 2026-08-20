/**
 * "Print labels" for a ticked selection of orders (86eyp63mp).
 *
 * Opened from the order inbox's bulk bar. It exists — rather than printing on
 * the tap — because a selection print has two things worth deciding: what
 * order the stack comes out in, and whether anything in the selection can't
 * carry a label at all. The one-click "ready to ship" run has neither question,
 * so that one prints straight away.
 *
 * The Print button is disabled-with-reason, never wrong-but-enabled: nothing
 * printable, or more than the batch ceiling, both say so before the tap.
 */

import { useAction } from "convex/react";
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AWB_BATCH_MAX, type AwbSort } from "../../../convex/lib/pdf/awb";
import { AWB_SORT_OPTIONS, describeAwbSkips } from "../../lib/awb-labels";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

export function PrintLabelsDialog({
	open,
	onOpenChange,
	retailerId,
	orderIds,
	paperLabel,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	retailerId: Id<"retailers">;
	/** The seller's ticked selection. */
	orderIds: Array<Id<"orders">>;
	/** Human name of the store's saved label size, so the seller isn't
	 * surprised by what comes out of the printer. */
	paperLabel: string;
}) {
	const generate = useAction(api.awb.generateAwbBatchPdf);
	const [sort, setSort] = useState<AwbSort>("fulfilment");
	const [busy, setBusy] = useState(false);

	const tooMany = orderIds.length > AWB_BATCH_MAX;
	const blockedReason =
		orderIds.length === 0
			? "Select some orders first."
			: tooMany
				? `Print up to ${AWB_BATCH_MAX} labels at a time — you've selected ${orderIds.length}.`
				: null;

	async function handlePrint() {
		setBusy(true);
		try {
			const res = await generate({ retailerId, orderIds, sort });
			const skips = describeAwbSkips(res.skipped);
			if (res.count === 0) {
				toast.error(
					skips ?? "None of those orders has a delivery address to print.",
				);
				return;
			}
			downloadPdfBytes(res.filename, res.pdf);
			toast.success(
				`${res.count} label${res.count === 1 ? "" : "s"} ready.${skips ? ` ${skips}` : ""}`,
			);
			onOpenChange(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						Print {orderIds.length} label{orderIds.length === 1 ? "" : "s"}
					</DialogTitle>
					<DialogDescription>
						One PDF, {paperLabel}. Orders being picked up have no address, so
						they&apos;re left out — you&apos;ll see how many.
					</DialogDescription>
				</DialogHeader>

				<fieldset className="flex flex-col gap-2">
					<legend className="pb-2 text-xs font-medium text-muted-foreground">
						Print them in this order
					</legend>
					<div className="grid gap-2 sm:grid-cols-2">
						{AWB_SORT_OPTIONS.map((option) => {
							const active = sort === option.value;
							return (
								<button
									key={option.value}
									type="button"
									aria-pressed={active}
									onClick={() => setSort(option.value)}
									className={cn(
										"flex min-h-11 flex-col gap-0.5 rounded-xl border p-2.5 text-left transition-colors",
										active
											? "border-accent bg-accent/5"
											: "border-input hover:bg-muted",
									)}
								>
									<span className="text-sm font-semibold text-foreground">
										{option.label}
									</span>
									<span className="text-[11px] leading-snug text-muted-foreground">
										{option.hint}
									</span>
								</button>
							);
						})}
					</div>
				</fieldset>

				{blockedReason ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						{blockedReason}
					</p>
				) : (
					<p className="text-xs text-muted-foreground">
						Printing doesn&apos;t change any order&apos;s status — mark them
						sent once the courier actually has them.
					</p>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						className="tap-target"
						onClick={() => onOpenChange(false)}
						disabled={busy}
					>
						Cancel
					</Button>
					<Button
						type="button"
						className="tap-target"
						onClick={handlePrint}
						disabled={busy || blockedReason !== null}
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Printer className="size-4" />
						)}
						{busy ? "Building PDF…" : "Print labels"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
