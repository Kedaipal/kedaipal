import { useCallback, useRef } from "react";

/**
 * Reveal a freshly-added list item so it's obvious something was created.
 *
 * Inline list editors (payment methods, order stages, variant option axes) append
 * a new row to the *bottom* of a list that, on a phone, is usually below the fold —
 * so tapping "Add …" appeared to do nothing. After the add handler calls
 * `markAdded(key)`, the matching card's `revealRef` scrolls it into view and
 * focuses its first field (opening the keyboard right on the new card).
 *
 * Ref-based (no re-render), self-clearing after the first reveal, and a no-op for
 * every other card — so an unrelated re-render never re-scrolls or steals focus.
 */
export function useRevealOnAdd() {
	const pendingKey = useRef<string | null>(null);

	const markAdded = useCallback((key: string) => {
		pendingKey.current = key;
	}, []);

	const revealRef = useCallback(
		(key: string) => (el: HTMLElement | null) => {
			if (!el || pendingKey.current !== key) return;
			pendingKey.current = null;
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			// preventScroll so focus doesn't jump-cancel the smooth scroll above.
			const field = el.querySelector<HTMLElement>(
				"input:not([type='file']), textarea, [contenteditable='true']",
			);
			field?.focus({ preventScroll: true });
		},
		[],
	);

	return { markAdded, revealRef };
}
