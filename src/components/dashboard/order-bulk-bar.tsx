import { Check, ChevronDown, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export type BulkAction = {
	status: "confirmed" | "packed" | "shipped" | "delivered" | "cancelled";
	label: string;
	destructive?: boolean;
};

/**
 * Floating action bar shown the whole time the inbox is in select mode. One
 * control surface: exit, a live count / select-all, and a single **Update
 * status** dropdown listing every transition (destructive Cancel separated at
 * the bottom) — no confusing primary-button + overflow split.
 *
 * Stays mounted for the lifetime of select mode (the route renders it whenever
 * `selectMode`, not gated on a selection). This is deliberate: unmounting the
 * bar the instant a bulk apply clears the selection — while the Radix popover /
 * confirm dialog it owns may still be open — leaks `pointer-events:none` onto
 * `document.body`, freezing the whole page until a hard reload. Keeping it
 * mounted lets those layers close cleanly.
 *
 * Destructive Cancel is gated behind a confirm dialog — bulk-cancel restores
 * stock, reverses customer aggregates, AND sends an unrecallable WhatsApp
 * cancellation to every selected customer, so a misclick is costly. Forward
 * transitions apply immediately.
 *
 * `onDelete` (optional) adds a **permanent hard delete** below Cancel — its own
 * confirm dialog with harsher copy, since it erases the orders and their records
 * outright (no WhatsApp is sent).
 */
export function OrderBulkBar({
	count,
	actions,
	allSelected,
	onApply,
	onDelete,
	onToggleSelectAll,
	onExit,
	busy = false,
}: {
	count: number;
	/** Every bulk transition, in order; the destructive one(s) sort last. */
	actions: BulkAction[];
	/** Whether every visible order is already selected (drives Select all/Clear). */
	allSelected: boolean;
	// May return a promise — the destructive confirm awaits it so the confirm
	// button shows its in-flight spinner and stays open if the apply rejects.
	onApply: (status: BulkAction["status"]) => void | Promise<void>;
	// Permanent hard delete of the selection. Omit to hide the delete item.
	onDelete?: () => void | Promise<void>;
	onToggleSelectAll: () => void;
	onExit: () => void;
	busy?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [pendingDestructive, setPendingDestructive] =
		useState<BulkAction | null>(null);
	const [pendingDelete, setPendingDelete] = useState(false);
	const orderWord = count === 1 ? "order" : "orders";
	const hasSelection = count > 0;

	function handleAction(a: BulkAction) {
		setOpen(false);
		if (a.destructive) setPendingDestructive(a);
		// Forward transitions apply immediately and fire-and-forget — the apply
		// surfaces its own error toast, so swallow the rejection here.
		else void Promise.resolve(onApply(a.status)).catch(() => {});
	}

	function handleDelete() {
		setOpen(false);
		setPendingDelete(true);
	}

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			{/* bg-foreground (not bg-primary) so the bar stays the high-contrast
			    inverted surface in both modes — in dark, `primary` becomes mint. */}
			<div className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-foreground p-2 pl-2.5 text-background shadow-[0_10px_24px_rgba(15,23,42,0.35)] lg:max-w-xl">
				<button
					type="button"
					onClick={onExit}
					aria-label="Exit select mode"
					className="flex size-9 shrink-0 items-center justify-center rounded-xl text-background/70 transition-colors hover:bg-background/10 hover:text-background"
				>
					<X className="size-5" />
				</button>
				<span className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums">
					{hasSelection ? `${count} selected` : "Select orders"}
				</span>
				<button
					type="button"
					onClick={onToggleSelectAll}
					className="hidden shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-background/80 transition-colors hover:bg-background/10 hover:text-background sm:block"
				>
					{allSelected ? "Clear all" : "Select all"}
				</button>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							disabled={busy || !hasSelection}
							className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-45"
						>
							{busy ? "Updating…" : "Update status"}
							<ChevronDown className="size-4" aria-hidden="true" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" side="top" className="w-56 p-1">
						<p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							Mark {count} {orderWord} as
						</p>
						<div className="flex flex-col">
							{actions.map((a, i) => {
								const prevDestructive =
									i > 0 && actions[i - 1].destructive !== a.destructive;
								return (
									<button
										key={a.status}
										type="button"
										onClick={() => handleAction(a)}
										className={cn(
											"flex h-11 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
											a.destructive &&
												"text-destructive hover:bg-destructive/10",
											prevDestructive && "mt-1 border-t border-border pt-2",
										)}
									>
										{a.destructive ? (
											<X className="size-4 shrink-0" aria-hidden="true" />
										) : (
											<Check className="size-4 shrink-0" aria-hidden="true" />
										)}
										{a.label}
									</button>
								);
							})}
							{onDelete ? (
								<button
									type="button"
									onClick={handleDelete}
									className={cn(
										"mt-1 flex h-11 items-center gap-2 rounded-md border-t border-border px-3 pt-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10",
									)}
								>
									<Trash2 className="size-4 shrink-0" aria-hidden="true" />
									Delete permanently
								</button>
							) : null}
						</div>
					</PopoverContent>
				</Popover>
			</div>

			{/* Confirm step for destructive bulk actions (e.g. Cancel). */}
			<ConfirmDialog
				open={pendingDestructive !== null}
				onOpenChange={(o) => {
					if (!o) setPendingDestructive(null);
				}}
				title={`Cancel ${count} ${orderWord}?`}
				description={`${count === 1 ? "The customer" : "Customers"} will be notified over WhatsApp, and this can't be undone.`}
				confirmLabel={`Cancel ${count} ${orderWord}`}
				cancelLabel={`Keep ${orderWord}`}
				destructive
				onConfirm={() => {
					const action = pendingDestructive;
					// Return the promise so ConfirmDialog can show its spinner while the
					// bulk op runs and keep itself open if it rejects.
					if (action) return onApply(action.status);
				}}
			/>

			{/* Permanent hard delete — harsher confirm; erases the orders + records
			    with no WhatsApp to the buyers. */}
			<ConfirmDialog
				open={pendingDelete}
				onOpenChange={(o) => {
					if (!o) setPendingDelete(false);
				}}
				title={`Delete ${count} ${orderWord} permanently?`}
				description={`This erases ${count === 1 ? "the order" : "these orders"}, ${count === 1 ? "its" : "their"} timeline and any uploaded images for good. Reserved stock is returned and your totals are adjusted; ${count === 1 ? "the customer is" : "customers are"} NOT notified. This can't be undone.`}
				confirmLabel={`Delete ${count} ${orderWord}`}
				cancelLabel={`Keep ${orderWord}`}
				destructive
				confirmPhrase="DELETE"
				onConfirm={() => onDelete?.()}
			/>
		</div>
	);
}
