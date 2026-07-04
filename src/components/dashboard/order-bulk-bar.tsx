import { MoreHorizontal, X } from "lucide-react";
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
 * Floating action bar shown while orders are multi-selected in the inbox. Leads
 * with the single most likely transition for the current view (e.g. "Confirm"
 * in the New bucket) as a one-tap mint button; the remaining transitions sit
 * behind the overflow menu. On mobile it floats over the bottom nav — selection
 * mode owns the bottom while it's active.
 *
 * Destructive actions (Cancel) are gated behind a confirm dialog — bulk-cancel
 * restores stock, reverses customer aggregates, AND sends an unrecallable
 * WhatsApp cancellation to every selected customer (up to 100), so a misclick is
 * costly. Non-destructive actions apply immediately.
 */
export function OrderBulkBar({
	count,
	primary,
	actions,
	onApply,
	onClear,
	busy = false,
}: {
	count: number;
	/** The lead one-tap action for this view (most likely transition). */
	primary: BulkAction;
	/** Remaining actions for the overflow menu (excluding `primary`). */
	actions: BulkAction[];
	// May return a promise — the destructive confirm awaits it so the confirm
	// button shows its in-flight spinner and stays open if the apply rejects.
	onApply: (status: BulkAction["status"]) => void | Promise<void>;
	onClear: () => void;
	busy?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [pendingDestructive, setPendingDestructive] =
		useState<BulkAction | null>(null);
	const orderWord = count === 1 ? "order" : "orders";

	function handleAction(a: BulkAction) {
		setOpen(false);
		if (a.destructive) setPendingDestructive(a);
		// Non-destructive actions apply immediately and fire-and-forget — the apply
		// surfaces its own error toast, so swallow the rejection here.
		else void Promise.resolve(onApply(a.status)).catch(() => {});
	}

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			{/* bg-foreground (not bg-primary) so the bar stays the high-contrast
			    inverted surface in both modes — in dark, `primary` becomes mint,
			    which would clash with the mint lead action. */}
			<div className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-foreground p-2 pl-3 text-background shadow-[0_10px_24px_rgba(15,23,42,0.35)] lg:max-w-xl">
				<button
					type="button"
					onClick={onClear}
					aria-label="Clear selection"
					className="flex size-9 shrink-0 items-center justify-center rounded-xl text-background/70 transition-colors hover:bg-background/10 hover:text-background"
				>
					<X className="size-5" />
				</button>
				<span className="min-w-0 flex-1 truncate text-sm font-bold tabular-nums">
					{count} selected
				</span>
				<button
					type="button"
					disabled={busy}
					onClick={() => handleAction(primary)}
					className="flex h-11 shrink-0 items-center rounded-xl bg-accent px-4 text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-60"
				>
					{busy ? "Updating…" : primary.label}
				</button>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							disabled={busy}
							aria-label="More actions"
							className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background/15 transition-colors hover:bg-background/25 disabled:opacity-60"
						>
							<MoreHorizontal className="size-5" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" side="top" className="w-52 p-1">
						<div className="flex flex-col">
							{actions.map((a) => (
								<button
									key={a.status}
									type="button"
									onClick={() => handleAction(a)}
									className={cn(
										"flex h-11 items-center rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
										a.destructive && "text-destructive hover:bg-destructive/10",
									)}
								>
									{a.label}
								</button>
							))}
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
		</div>
	);
}
