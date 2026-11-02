// @vitest-environment jsdom

import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE_PANEL_ATTR, REVEAL_EVENT } from "../ui/question-row";
import { focusFirstInvalidField, submitThenFocusError } from "./focus-error";

// jsdom doesn't implement scrollIntoView — stub it so the helper can call it.
beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

function mount(html: string): HTMLFormElement {
	document.body.innerHTML = `<form>${html}</form>`;
	return document.body.querySelector("form") as HTMLFormElement;
}

describe("focusFirstInvalidField", () => {
	it("focuses the FIRST invalid control in DOM order", () => {
		const form = mount(`
			<input id="a" aria-invalid="false" />
			<input id="b" aria-invalid="true" />
			<input id="c" aria-invalid="true" />
		`);
		focusFirstInvalidField(form);
		expect(document.activeElement?.id).toBe("b");
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
	});

	it("focuses an invalid textarea", () => {
		const form = mount(`<textarea id="t" aria-invalid="true"></textarea>`);
		focusFirstInvalidField(form);
		expect(document.activeElement?.id).toBe("t");
	});

	it("falls back to the [data-form-error] banner when no field is invalid", () => {
		const form = mount(`
			<input id="a" aria-invalid="false" />
			<p data-form-error>Enter a valid price for Large.</p>
		`);
		focusFirstInvalidField(form);
		// The banner isn't a focusable control — we scroll to it but don't focus it.
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
		expect(document.activeElement?.id).not.toBe("a");
	});

	it("prefers an invalid field over the error banner", () => {
		const form = mount(`
			<p data-form-error>Some banner.</p>
			<input id="a" aria-invalid="true" />
		`);
		focusFirstInvalidField(form);
		expect(document.activeElement?.id).toBe("a");
	});

	it("opens a collapsed question row instead of focusing inside it", () => {
		// z8r3fdv1z2: the product form's capabilities collapse into rows whose
		// panels stay mounted but hidden. A hidden field can't be scrolled to
		// or focused, so the helper asks the row to open and reports "not yet"
		// — the submit path's retry then lands on the field once it shows.
		const form = mount(`
			<div ${DISCLOSURE_PANEL_ATTR} hidden>
				<input id="sale" aria-invalid="true" />
			</div>
		`);
		const panel = form.querySelector("[hidden]") as HTMLElement;
		const reveal = vi.fn(() => panel.removeAttribute("hidden"));
		panel.addEventListener(REVEAL_EVENT, reveal);

		expect(focusFirstInvalidField(form)).toBe(false);
		expect(reveal).toHaveBeenCalledTimes(1);
		expect(document.activeElement?.id).not.toBe("sale");

		// Next look (the retry), the panel is open: focus lands normally.
		expect(focusFirstInvalidField(form)).toBe(true);
		expect(document.activeElement?.id).toBe("sale");
	});

	it("leaves an OPEN question row alone and focuses straight in", () => {
		const form = mount(`
			<div ${DISCLOSURE_PANEL_ATTR}>
				<input id="sale" aria-invalid="true" />
			</div>
		`);
		expect(focusFirstInvalidField(form)).toBe(true);
		expect(document.activeElement?.id).toBe("sale");
	});

	it("is a no-op for a null form or no errors", () => {
		expect(() => focusFirstInvalidField(null)).not.toThrow();
		const form = mount(`<input id="a" aria-invalid="false" />`);
		focusFirstInvalidField(form);
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
	});
});

describe("the scroll actually moves the page", () => {
	it("asks for an INSTANT scroll — smooth silently does nothing over a long distance", () => {
		// Measured in Chrome on the product form: `behavior: "smooth"` moved the
		// page 0px while the same call without it jumped correctly, so the
		// helper focused an input 2000px off-screen and the seller saw a button
		// that did nothing. Every `submitThenFocusError` caller depended on this.
		const form = mount('<input aria-invalid="true" />');
		focusFirstInvalidField(form);

		const scroll = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
		expect(scroll).toHaveBeenCalledTimes(1);
		const opts = scroll.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined;
		expect(opts?.block).toBe("center");
		expect(opts?.behavior).toBeUndefined();
	});

	it("survives an environment without scrollIntoView, still focusing", () => {
		// The wizard reaches this from a scheduled callback, where a throw
		// surfaces as an unhandled error rather than a failed assertion.
		const form = mount('<input aria-invalid="true" />');
		// @ts-expect-error — deliberately removing the API for this case.
		Element.prototype.scrollIntoView = undefined;
		expect(() => focusFirstInvalidField(form)).not.toThrow();
		expect(document.activeElement).toBe(form.querySelector("input"));
	});
});

describe("submitThenFocusError — the wiring, not the helper in isolation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	/** The three members of a submit event this handler actually touches. */
	function submitEventFor(form: HTMLFormElement) {
		return {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			currentTarget: form,
		} as unknown as FormEvent & {
			preventDefault: ReturnType<typeof vi.fn>;
			stopPropagation: ReturnType<typeof vi.fn>;
		};
	}

	it("runs the submit, then lands on the invalid field", async () => {
		const form = mount('<input id="bad" aria-invalid="true" />');
		const e = submitEventFor(form);
		const handleSubmit = vi.fn(() => Promise.resolve());

		submitThenFocusError({ handleSubmit }, e);

		// The native navigation is cancelled synchronously, before anything async.
		expect(e.preventDefault).toHaveBeenCalledTimes(1);
		expect(e.stopPropagation).toHaveBeenCalledTimes(1);
		expect(handleSubmit).toHaveBeenCalledTimes(1);
		// Nothing has moved yet — the look happens once the submit settles.
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);

		expect(document.activeElement?.id).toBe("bad");
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
	});

	it("does NOT depend on requestAnimationFrame — a hidden document never fires one", async () => {
		// This is the whole bug (z8r3fdrkq2). `visibilityState: "hidden"` — a
		// Chrome window fully covered by another app — runs no rAF callbacks, so
		// a retry built on rAF stops dead: submit fires, the promise settles,
		// `.finally()` runs, and then nothing, forever. Measured in Chrome: one
		// submit, ZERO scrollIntoView calls, focus left on the Save button and
		// the invalid input 2000px off-screen. A timer fires either way.
		const neverFires = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation(() => 0);
		const form = mount('<input id="bad" aria-invalid="true" />');

		submitThenFocusError(
			{ handleSubmit: () => Promise.resolve() },
			submitEventFor(form),
		);
		await vi.advanceTimersByTimeAsync(200);

		expect(document.activeElement?.id).toBe("bad");
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
		// Not "we also called rAF" — the scheduler must not be rAF at all.
		expect(neverFires).not.toHaveBeenCalled();
	});

	it("still lands when the submit THREW — the contract is finally, not then", async () => {
		// Reachable, not hypothetical: TanStack re-throws whatever the form's
		// own onSubmit threw (FormApi `catch { … throw err }`), and the product
		// form's onSubmit does real work OUTSIDE its try/catch — parsing values,
		// reconciling the variant grid — any of which can throw. A refused save
		// is exactly when the seller needs taking to the problem, so the focus
		// hangs off `finally`.
		const form = mount('<input id="bad" aria-invalid="true" />');
		const boom = new Error("onSubmit threw");
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		submitThenFocusError(
			{ handleSubmit: () => Promise.reject(boom) },
			submitEventFor(form),
		);
		await vi.advanceTimersByTimeAsync(200);

		expect(document.activeElement?.id).toBe("bad");
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
		// …and the throw is reported, not turned into an unhandled rejection.
		expect(logged).toHaveBeenCalledWith("Form submit failed", boom);
	});

	it("waits for the invalid state React has not committed yet", async () => {
		// The common case: the reason for the refusal is set INSIDE the form's
		// own onSubmit (`setEditorIssues(issues); return;`), so when the submit
		// settles the DOM is still clean. The first look must not be the last.
		const form = mount('<input id="late" aria-invalid="false" />');
		const handleSubmit = vi.fn(() => Promise.resolve());

		submitThenFocusError({ handleSubmit }, submitEventFor(form));
		await vi.advanceTimersByTimeAsync(20);
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

		// React commits two ticks late.
		form.querySelector("input")?.setAttribute("aria-invalid", "true");
		await vi.advanceTimersByTimeAsync(80);

		expect(document.activeElement?.id).toBe("late");
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
	});

	it("gives up quietly when nothing is ever marked invalid", async () => {
		// A clean form that simply saved — the retry must be bounded, not a
		// loop that outlives the page.
		const form = mount('<input id="fine" aria-invalid="false" />');

		submitThenFocusError(
			{ handleSubmit: () => Promise.resolve() },
			submitEventFor(form),
		);
		await vi.advanceTimersByTimeAsync(5000);

		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
