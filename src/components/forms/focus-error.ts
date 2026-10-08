import type { FormEvent } from "react";

/**
 * Shared "take me to the error" behaviour for every form built on the
 * `useAppForm` field components. On a failed submit, sellers shouldn't have to
 * hunt a long form for a red line — we scroll to and focus the FIRST thing that's
 * wrong, in visual (DOM) order.
 *
 * Two error shapes are handled:
 *  1. **Field-level** — a shared field control marks itself `aria-invalid="true"`
 *     (TextField / TextareaField / SelectField / …). We focus it (and its message
 *     already renders beneath it via `FieldError`).
 *  2. **Business-rule** — errors not tied to one field (e.g. the product variant
 *     grid: "Enter a valid price for …"). Render that banner with a
 *     `data-form-error` attribute and we scroll to it as the fallback.
 *
 * Field-level always wins over the banner, since an invalid input is the more
 * specific, actionable target.
 */
export function focusFirstInvalidField(
	// Any container, not just a <form>: the product wizard is a stepper whose
	// Continue is a plain button, and it needs the same "take me to the error"
	// behaviour. Nothing here is form-specific — it is a querySelector.
	formEl: HTMLElement | null | undefined,
): boolean {
	if (!formEl) return false;
	// First invalid control in DOM order — visually the topmost error.
	const control = formEl.querySelector<HTMLElement>('[aria-invalid="true"]');
	const target =
		control ?? formEl.querySelector<HTMLElement>("[data-form-error]");
	if (!target) return false;
	// INSTANT, not smooth. Measured in Chrome on the product form: a smooth
	// scrollIntoView over a long distance moved the page 0px, while the same
	// call without `behavior` jumped correctly — so every form's "take me to
	// the error" was focusing an input 2000px off-screen and looking, to the
	// seller, like the button did nothing (z8r3fdcw72 visual pass; the bug is
	// older than that ticket and affects every `submitThenFocusError` caller).
	// Optional-called because jsdom doesn't implement it and this also runs
	// from the wizard's rAF, where a throw is an unhandled error.
	target.scrollIntoView?.({ block: "center" });
	// Focus only a real control — scrollIntoView has already centred it, so
	// skip focus's own second jump.
	if (control?.matches("input, textarea, select, [contenteditable='true']")) {
		control.focus({ preventScroll: true });
	}
	return true;
}

// React 18 commits state updates from async callbacks via a scheduler macrotask,
// which can land AFTER the first animation frame — so a single-frame check can
// race the render and find nothing. Retry across a few frames (~5 is far beyond
// any real commit latency) until the invalid state is in the DOM.
const FOCUS_RETRY_FRAMES = 5;

function focusWhenRendered(formEl: HTMLElement, attemptsLeft: number) {
	requestAnimationFrame(() => {
		if (focusFirstInvalidField(formEl)) return;
		if (attemptsLeft > 0) focusWhenRendered(formEl, attemptsLeft - 1);
	});
}

/**
 * Same "take me to the error" behaviour for a container that ISN'T a form —
 * the product wizard's Continue is a plain button. Call it right after the
 * state update that marks the fields invalid; the frame retry below handles
 * the commit latency.
 */
export function focusAfterRender(el: HTMLElement | null | undefined): void {
	if (el) focusWhenRendered(el, FOCUS_RETRY_FRAMES);
}

/**
 * Drop-in `<form onSubmit>` handler: run TanStack Form's submit, then — once the
 * invalid state has rendered — scroll to + focus the first error. Replaces the
 * boilerplate `e.preventDefault(); e.stopPropagation(); form.handleSubmit()`.
 */
export function submitThenFocusError(
	form: { handleSubmit: () => Promise<void> },
	e: FormEvent,
): void {
	e.preventDefault();
	e.stopPropagation();
	// Capture synchronously — currentTarget is cleared once the handler returns.
	const formEl = e.currentTarget as HTMLFormElement;
	void form.handleSubmit().finally(() => {
		focusWhenRendered(formEl, FOCUS_RETRY_FRAMES);
	});
}
