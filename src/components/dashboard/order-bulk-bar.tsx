import { ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export type BulkAction = {
	status: "confirmed" | "packed" | "shipped" | "delivered" | "cancelled";
	label: string;
	destructive?: boolean;
};

/**
 * Sticky bottom bar shown while orders are multi-selected in the inbox. Houses
 * the "Mark as…" action menu (resolved status labels) + a clear. On mobile it
 * sits over the bottom nav — selection mode owns the bottom while it's active.
 *
 * Destructive actions (Cancel) are gated behind a confirm dialog — bulk-cancel
 * restores stock, reverses customer aggregates, AND sends an unrecallable
 * WhatsApp cancellation to every selected customer (up to 100), so a misclick is
 * costly. Non-destructive actions apply immediately.
 */
export function OrderBulkBar({
	count,
	actions,
	onApply,
	onClear,
	busy = false,
}: {
	count: number;
	actions: BulkAction[];
	onApply: (status: BulkAction["status"]) => void;
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
		else onApply(a.status);
	}

	return (
		<div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
			<div className="mx-auto flex w-full max-w-md items-center gap-3 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:max-w-6xl lg:px-8">
				<button
					type="button"
					onClick={onClear}
					aria-label="Clear selection"
					className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
				>
					<X className="size-5" />
				</button>
				<span className="text-sm font-medium tabular-nums">
					{count} selected
				</span>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							disabled={busy}
							className="ml-auto h-10 gap-1.5"
						>
							{busy ? "Updating…" : "Mark as"}
							<ChevronUp className="size-4" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" side="top" className="w-52 p-1">
						<div className="flex flex-col">
							{actions.map((a) => (
								<button
									key={a.status}
									type="button"
									onClick={() => handleAction(a)}
									className={cn(
										"flex h-10 items-center rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
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
					if (action) onApply(action.status);
				}}
			/>
		</div>
	);
}
