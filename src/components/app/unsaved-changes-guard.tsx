import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import type { UnsavedState } from "../../lib/product-form-dirty";
import { ConfirmDialog } from "../ui/confirm-dialog";

const COPY: Record<
	Exclude<UnsavedState, "none">,
	{ title: string; description: string }
> = {
	changes: {
		title: "Leave without saving?",
		description:
			"You have changes on this page that haven't been saved. If you leave now, they're lost.",
	},
	uploading: {
		title: "A photo is still uploading",
		description:
			"Wait a moment for it to finish. If you leave now, the photo is dropped.",
	},
};

/**
 * Stops a seller from walking away from unsaved work without being told
 * (z8r3fdtk82). Before this, leaving a form threw away every unsaved edit
 * with no warning.
 *
 * Two doors, one rule:
 * - in-app navigation (the sidebar, Back, a link) opens the house
 *   `ConfirmDialog`: Keep editing or Discard changes;
 * - closing or reloading the tab gets the browser's own "Leave site?"
 *   prompt, the only thing a page may show there.
 *
 * Moving within the same page is never blocked: the new-product page
 * switches between the wizard and the full form with a search param, and
 * carries the draft across.
 *
 * A save that navigates away passes `ignoreBlocker: true`, so a successful
 * save never asks "discard?" on its way out.
 */
export function UnsavedChangesGuard({ state }: { state: UnsavedState }) {
	// Read through a ref so the blocker always sees the latest state, even
	// for a navigation fired in the same tick as the change.
	const stateRef = useRef(state);
	stateRef.current = state;

	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) =>
			stateRef.current !== "none" && current.pathname !== next.pathname,
		enableBeforeUnload: () => stateRef.current !== "none",
		withResolver: true,
	});

	if (blocker.status !== "blocked") return null;
	// Follows the live state: if an upload lands while the dialog is open, the
	// copy moves from "still uploading" to "unsaved changes", which is then
	// the true reason (PR #371 review).
	const copy = COPY[state === "uploading" ? "uploading" : "changes"];
	return (
		<ConfirmDialog
			open
			onOpenChange={(open) => {
				if (!open) blocker.reset();
			}}
			title={copy.title}
			description={copy.description}
			cancelLabel="Keep editing"
			confirmLabel={state === "uploading" ? "Leave anyway" : "Discard changes"}
			destructive
			onConfirm={() => blocker.proceed()}
		/>
	);
}
