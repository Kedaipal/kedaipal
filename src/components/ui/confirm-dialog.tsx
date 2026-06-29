import type * as React from "react";
import { useState } from "react";
import { Button } from "./button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";

/**
 * Shared confirmation step for actions that can't be casually undone — deleting,
 * cancelling, or anything destructive that isn't a reversible archive. One
 * component so every "are you sure?" reads and behaves the same across the app
 * (counter checkout, order cancel, bulk cancel…). Reach for this instead of
 * hand-rolling another Dialog.
 *
 * Controlled via `open`/`onOpenChange`. `onConfirm` may be async — the confirm
 * button shows a spinner until it settles, the dialog can't be dismissed
 * mid-flight, and it closes itself on success. Errors are the caller's to
 * surface (e.g. a toast); they leave the dialog open so the user can retry.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel = "Cancel",
	destructive = false,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	confirmLabel: string;
	cancelLabel?: string;
	/** Renders the confirm button in the destructive (red) style. */
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
}) {
	const [busy, setBusy] = useState(false);

	async function handleConfirm() {
		try {
			setBusy(true);
			await onConfirm();
			onOpenChange(false);
		} catch {
			// Leave the dialog open so the caller's error toast is visible and the
			// user can retry or back out. The caller owns error surfacing.
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				// Don't let an outside-click / Esc dismiss the dialog while the action
				// is in flight — avoids a half-finished destructive op with no feedback.
				if (!busy) onOpenChange(o);
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="sm:max-w-sm"
				// With a description, radix wires aria-describedby to it. Without one,
				// explicitly opt out so radix doesn't warn about a missing description.
				{...(description ? {} : { "aria-describedby": undefined })}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description ? (
						<DialogDescription>{description}</DialogDescription>
					) : null}
				</DialogHeader>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={busy}
					>
						{cancelLabel}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						onClick={handleConfirm}
						isLoading={busy}
						disabled={busy}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
