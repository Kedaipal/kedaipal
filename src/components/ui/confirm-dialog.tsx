import type * as React from "react";
import { useEffect, useId, useState } from "react";
import { Button } from "./button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";
import { Input } from "./input";

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
 *
 * `confirmPhrase` opts into a **type-to-confirm** gate for the most irreversible
 * actions (permanent order delete): the confirm button stays disabled until the
 * user *types* the phrase. Typing is auto-uppercased and paste/drop/autofill are
 * blocked, so the confirmation is a deliberate keystroke action, not a reflex
 * click or a paste. Leave it unset for ordinary one-click confirms (cancel,
 * mark-paid, …) — those behave exactly as before.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel = "Cancel",
	destructive = false,
	confirmPhrase,
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
	/**
	 * When set, gate the confirm button behind typing this exact word (compared
	 * case-insensitively — input is auto-uppercased, so pass it uppercase, e.g.
	 * `"DELETE"`). Paste/drop/autofill are blocked; only real keystrokes count.
	 */
	confirmPhrase?: string;
	onConfirm: () => void | Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const [typed, setTyped] = useState("");
	const helperId = useId();

	// Fresh box on every open so a stale phrase can't pre-arm the button next
	// time. A failed confirm leaves the dialog open (open stays true, effect
	// doesn't re-run), so the typed phrase survives and the user can just retry.
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);

	const phraseRequired = confirmPhrase != null && confirmPhrase.length > 0;
	const phraseMatched =
		!phraseRequired || typed.trim() === confirmPhrase.toUpperCase();
	const canConfirm = !busy && phraseMatched;

	async function handleConfirm() {
		if (!phraseMatched) return;
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
				{phraseRequired ? (
					<div className="space-y-1.5">
						<label htmlFor={helperId} className="text-sm text-muted-foreground">
							Type{" "}
							<span className="font-semibold text-foreground">
								{confirmPhrase.toUpperCase()}
							</span>{" "}
							to confirm
						</label>
						<Input
							id={helperId}
							variant="field"
							value={typed}
							disabled={busy}
							// Real keystrokes only: auto-uppercase what's typed and refuse
							// paste / drag-drop / autofill so this can't be shortcut.
							onChange={(e) => setTyped(e.target.value.toUpperCase())}
							onPaste={(e) => e.preventDefault()}
							onDrop={(e) => e.preventDefault()}
							onDragOver={(e) => e.preventDefault()}
							onKeyDown={(e) => {
								if (e.key === "Enter" && canConfirm) {
									e.preventDefault();
									void handleConfirm();
								}
							}}
							autoComplete="off"
							autoCorrect="off"
							autoCapitalize="characters"
							spellCheck={false}
							aria-label={`Type ${confirmPhrase.toUpperCase()} to confirm`}
						/>
					</div>
				) : null}
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
						disabled={!canConfirm}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
