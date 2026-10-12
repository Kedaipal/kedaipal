import { ChevronDown, Copy, Layers, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	batchFallbackName,
	batchSummary,
	batchVoidableCount,
	type VoucherGroup,
} from "../../lib/voucher-groups";
import { Button } from "../ui/button";
import { VoucherList, type VoucherRowView } from "./voucher-list";

/**
 * A batch, as one object (`z8r3fdr617`).
 *
 * A "create 20" run listed flat is twenty rows differing in eight random
 * characters — the seller cannot tell which run a code came from, which run
 * they just made, or act on a run at all. So the run collapses to a parent
 * carrying the three things they need: what it is CALLED, how big it is, and
 * what has become of it.
 *
 * Collapsed by default. The codes are the detail; the run is the object, and
 * a seller scanning their book is looking for "the Raya giveaway", not for
 * KP-7F3K-Q2WM. Expanding reuses the very same `VoucherList` rows the
 * standalone vouchers use (`nested`), so a code looks and behaves identically
 * wherever it is read — one idea, one control.
 *
 * The parent's counts describe the WHOLE run even while a filter is showing
 * one child, because the alternative tells the seller their run shrank. See
 * `groupVouchers`.
 */
export function VoucherBatchCard({
	group,
	canWrite,
	onShare,
	onVoid,
	onVoidBatch,
	onRename,
}: {
	group: Extract<VoucherGroup<VoucherRowView>, { kind: "batch" }>;
	canWrite: boolean;
	onShare: (voucher: VoucherRowView) => void;
	onVoid: (voucher: VoucherRowView) => void;
	onVoidBatch: (
		group: Extract<VoucherGroup<VoucherRowView>, { kind: "batch" }>,
	) => void;
	onRename: (
		group: Extract<VoucherGroup<VoucherRowView>, { kind: "batch" }>,
	) => void;
}) {
	const [open, setOpen] = useState(false);
	const name =
		group.note ?? batchFallbackName(group.totalCount, group.createdAt);
	const voidable = batchVoidableCount(group.counts);
	const hidden = group.totalCount - group.vouchers.length;

	return (
		<li className="overflow-hidden rounded-2xl border border-border bg-card">
			<div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className="flex min-w-0 flex-1 items-start gap-3 text-left"
				>
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<Layers className="size-4" aria-hidden />
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="truncate font-semibold">{name}</span>
							<ChevronDown
								aria-hidden
								className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
									open ? "rotate-180" : ""
								}`}
							/>
						</span>
						<span className="text-xs text-muted-foreground">
							{batchSummary(group.counts, group.totalCount)}
							{/* Under a filter the parent still counts the whole run, so
							    say plainly why fewer codes are listed than it claims. */}
							{hidden > 0 ? ` · showing ${group.vouchers.length}` : ""}
						</span>
					</span>
				</button>

				{canWrite ? (
					<div className="flex shrink-0 flex-wrap gap-2">
						<Button
							variant="outline"
							className="tap-target flex-1 gap-1.5 sm:flex-none"
							onClick={() => onRename(group)}
						>
							<Pencil className="size-4" aria-hidden />
							Rename
						</Button>
						{/* Named with its count: "Void all" over a part-spent run would
						    promise something the server (rightly) won't do. It
						    disappears entirely once nothing is left to call off,
						    rather than sitting there doing nothing. */}
						{voidable > 0 ? (
							<Button
								variant="ghost"
								className="tap-target flex-1 text-muted-foreground hover:text-destructive sm:flex-none"
								onClick={() => onVoidBatch(group)}
							>
								Void {voidable} left
							</Button>
						) : null}
					</div>
				) : null}
			</div>

			{open ? (
				<div className="border-t border-border bg-muted/20">
					<VoucherList
						vouchers={group.vouchers}
						canWrite={canWrite}
						onShare={onShare}
						onVoid={onVoid}
						nested
					/>
					{canWrite ? (
						<div className="border-t border-border/70 px-4 py-2.5">
							<button
								type="button"
								onClick={() => {
									const codes = group.vouchers.map((v) => v.code).join("\n");
									navigator.clipboard
										?.writeText(codes)
										.then(() =>
											toast.success(
												`${group.vouchers.length} codes copied — one per line`,
											),
										)
										.catch(() =>
											toast.error("Couldn't copy — copy them by hand"),
										);
								}}
								className="tap-target flex items-center gap-1.5 text-xs font-semibold text-accent-emphasis"
							>
								<Copy className="size-3.5" aria-hidden />
								Copy all codes
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</li>
	);
}
