/**
 * "Print labels" dialog (86eyp63mp) — two modes, one surface:
 *
 *  - `selection`: the inbox bulk bar's ticked orders. Exists because a
 *    selection print has two things worth deciding — what order the stack
 *    comes out in, and whether anything in it can't carry a label at all.
 *  - `queue`: the Ready-to-ship strip. The strip used to print everything on
 *    the tap, which re-printed labels the seller already had the moment two
 *    new orders joined the queue. Now the tap opens THIS list: every ready
 *    order with a checkbox, never-printed rows ticked by default, printed
 *    rows listed unticked with a "Printed · 2h ago" chip — so the default
 *    tap prints exactly the new work and a re-print is a deliberate tick.
 *    The rows are a live query, so a successful print flips its rows to
 *    their chip state while the seller watches.
 *
 * The Print button is disabled-with-reason, never wrong-but-enabled: nothing
 * ticked, nothing printable, or more than the batch ceiling all say so before
 * the tap.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Loader2, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AWB_BATCH_MAX, type AwbSort } from "../../../convex/lib/pdf/awb";
import {
	AWB_SORT_OPTIONS,
	defaultCheckedQueueIds,
	describeAwbSkips,
} from "../../lib/awb-labels";
import { downloadPdfBytes } from "../../lib/download";
import {
	convexErrorMessage,
	formatPrice,
	formatRelativeTime,
} from "../../lib/format";
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
import { Skeleton } from "../ui/skeleton";

type CommonProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	retailerId: Id<"retailers">;
	/** Human name of the store's saved label size, so the seller isn't
	 * surprised by what comes out of the printer. */
	paperLabel: string;
};

type PrintLabelsDialogProps = CommonProps &
	(
		| {
				mode: "selection";
				/** The seller's ticked selection. */
				orderIds: Array<Id<"orders">>;
		  }
		| { mode: "queue" }
	);

export function PrintLabelsDialog(props: PrintLabelsDialogProps) {
	const { open, onOpenChange, retailerId, paperLabel } = props;
	const generate = useAction(api.awb.generateAwbBatchPdf);
	const [sort, setSort] = useState<AwbSort>("fulfilment");
	const [busy, setBusy] = useState(false);

	// --- Queue mode's live rows + checkbox state -----------------------------
	// The query only runs while the queue dialog is actually open (the inbox
	// already shows the count; no reason to keep a second scan subscribed).
	const queue = useQuery(
		convexQuery(
			api.awb.readyToShipQueue,
			props.mode === "queue" && open ? { retailerId } : "skip",
		),
	).data;
	const [checked, setChecked] = useState<Set<Id<"orders">>>(new Set());
	// Ids this open of the dialog has already defaulted, so a live update never
	// re-ticks a row the seller deliberately unticked. A row arriving WHILE the
	// dialog is open (a fresh order turned ready) gets the same default as at
	// open — it was never seen, so ticking it is not an override.
	const defaultedIds = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (!open) {
			defaultedIds.current = new Set();
			setChecked(new Set());
		}
	}, [open]);
	useEffect(() => {
		if (props.mode !== "queue" || !open || !queue) return;
		const fresh = queue.rows.filter(
			(row) => !defaultedIds.current.has(row.orderId),
		);
		if (fresh.length === 0) return;
		for (const row of fresh) defaultedIds.current.add(row.orderId);
		const tick = defaultCheckedQueueIds(fresh);
		if (tick.length > 0) {
			setChecked((prev) => new Set([...prev, ...tick]));
		}
	}, [props.mode, open, queue]);

	// What actually prints: intersect with the live rows, so a row that left the
	// queue (marked sent on another device) silently drops out of the count.
	const queueSelection = (queue?.rows ?? []).filter((row) =>
		checked.has(row.orderId),
	);
	const printCount =
		props.mode === "selection" ? props.orderIds.length : queueSelection.length;
	const allTicked =
		props.mode === "queue" &&
		(queue?.rows.length ?? 0) > 0 &&
		queueSelection.length === queue?.rows.length;

	const tooMany = printCount > AWB_BATCH_MAX;
	const blockedReason =
		printCount === 0
			? props.mode === "selection"
				? "Select some orders first."
				: "Tick at least one order to print."
			: tooMany
				? `Print up to ${AWB_BATCH_MAX} labels at a time — you've selected ${printCount}.`
				: null;

	async function handlePrint() {
		setBusy(true);
		try {
			const orderIds =
				props.mode === "selection"
					? props.orderIds
					: queueSelection.map((row) => row.orderId);
			const res = await generate({
				retailerId,
				orderIds,
				// The queue prints in the default (delivery-date) order — its job is
				// choosing WHICH labels, not what order the stack comes out in.
				...(props.mode === "selection" ? { sort } : {}),
			});
			const skips = describeAwbSkips(res.skipped);
			if (res.count === 0) {
				toast.error(
					skips ?? "None of those orders has a delivery address to print.",
				);
				return;
			}
			downloadPdfBytes(res.filename, res.pdf);
			toast.success(
				`${res.count} label${res.count === 1 ? "" : "s"} ready — mark them sent once the courier has them.${skips ? ` ${skips}` : ""}`,
			);
			if (props.mode === "selection") {
				onOpenChange(false);
			} else {
				// Stay open: the just-printed rows flip to their "Printed" chip in the
				// live list — the seller watches the queue clear. Untick them so the
				// button honestly reads what a second tap would do.
				const printed = new Set(orderIds);
				setChecked(
					(prev) => new Set([...prev].filter((id) => !printed.has(id))),
				);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	function toggleRow(orderId: Id<"orders">) {
		setChecked((prev) => {
			const next = new Set(prev);
			if (next.has(orderId)) next.delete(orderId);
			else next.add(orderId);
			return next;
		});
	}

	function toggleAll() {
		if (!queue) return;
		setChecked(
			allTicked ? new Set() : new Set(queue.rows.map((row) => row.orderId)),
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{props.mode === "selection"
							? `Print ${props.orderIds.length} label${props.orderIds.length === 1 ? "" : "s"}`
							: "Ready to ship"}
					</DialogTitle>
					<DialogDescription>
						{props.mode === "selection"
							? `One PDF, ${paperLabel}. Orders being picked up have no address, so they're left out — you'll see how many.`
							: `One PDF, ${paperLabel}. New orders start ticked; anything you've printed before stays listed so you can re-print it.`}
					</DialogDescription>
				</DialogHeader>

				{props.mode === "selection" ? (
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
				) : (
					<QueueList
						queue={queue}
						checked={checked}
						allTicked={allTicked}
						onToggleRow={toggleRow}
						onToggleAll={toggleAll}
					/>
				)}

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
						{props.mode === "queue" ? "Done" : "Cancel"}
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
						{busy
							? "Building PDF…"
							: printCount > 0
								? `Print ${printCount} label${printCount === 1 ? "" : "s"}`
								: "Print labels"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Derived from the server's return type so the row shape can't drift. */
type QueueData =
	| FunctionReturnType<typeof api.awb.readyToShipQueue>
	| undefined;

/** The queue rows with their checkboxes — the inbox's select-mode checkbox
 * look, so ticking here feels like ticking there. */
function QueueList({
	queue,
	checked,
	allTicked,
	onToggleRow,
	onToggleAll,
}: {
	queue: QueueData;
	checked: Set<Id<"orders">>;
	allTicked: boolean;
	onToggleRow: (orderId: Id<"orders">) => void;
	onToggleAll: () => void;
}) {
	if (!queue) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-12 w-full rounded-xl" />
				<Skeleton className="h-12 w-full rounded-xl" />
				<Skeleton className="h-12 w-full rounded-xl" />
			</div>
		);
	}
	if (queue.rows.length === 0) {
		return (
			<p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
				Nothing is packed and paid for right now.
			</p>
		);
	}
	return (
		<div className="flex min-h-0 flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<p className="text-xs font-medium text-muted-foreground">
					{checked.size} of {queue.rows.length} selected
				</p>
				<button
					type="button"
					onClick={onToggleAll}
					className="tap-target -mr-1 px-1 text-xs font-semibold text-accent-emphasis"
				>
					{allTicked ? "Deselect all" : "Select all"}
				</button>
			</div>
			<ul className="flex max-h-[45dvh] flex-col gap-1.5 overflow-y-auto pr-0.5">
				{queue.rows.map((row) => {
					const isSel = checked.has(row.orderId);
					return (
						<li key={row.orderId}>
							<button
								type="button"
								aria-pressed={isSel}
								aria-label={`Print label for ${row.shortId}`}
								onClick={() => onToggleRow(row.orderId)}
								className={cn(
									"flex min-h-11 w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
									isSel
										? "border-accent bg-accent/5"
										: "border-input hover:bg-muted",
								)}
							>
								<span
									aria-hidden="true"
									className={cn(
										"flex size-[22px] shrink-0 items-center justify-center rounded-lg border transition-colors",
										isSel
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-background",
									)}
								>
									{isSel ? <Check className="size-3.5" /> : null}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-1.5">
										<span className="truncate text-sm font-semibold text-foreground">
											{row.buyerName}
										</span>
										{row.labelPrintedAt !== undefined ? (
											<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
												Printed · {formatRelativeTime(row.labelPrintedAt)}
											</span>
										) : null}
									</span>
									<span className="block text-xs text-muted-foreground">
										{row.shortId} · {row.totalUnits} item
										{row.totalUnits === 1 ? "" : "s"} ·{" "}
										{formatPrice(row.total, row.currency)}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{queue.remaining > 0 ? (
				<p className="text-xs text-muted-foreground">
					{queue.remaining} more{" "}
					{queue.remaining === 1 ? "order is" : "orders are"} ready beyond one
					batch — print these first, then come back for the rest.
				</p>
			) : null}
		</div>
	);
}
