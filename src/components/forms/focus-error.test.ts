// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusFirstInvalidField } from "./focus-error";

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
		// The wizard calls this from its own rAF, where a throw surfaces as an
		// unhandled error rather than a failed assertion.
		const form = mount('<input aria-invalid="true" />');
		// @ts-expect-error — deliberately removing the API for this case.
		Element.prototype.scrollIntoView = undefined;
		expect(() => focusFirstInvalidField(form)).not.toThrow();
		expect(document.activeElement).toBe(form.querySelector("input"));
	});
});
