// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Select } from "./select";

afterEach(cleanup);

function renderSelect(props: React.ComponentProps<typeof Select> = {}) {
	render(
		<Select aria-label="Venue" variant="field" className="w-56" {...props}>
			<option value="">Pick a pickup point…</option>
			<option value="a">Dataran Pahlawan Stall</option>
		</Select>,
	);
	return screen.getByLabelText("Venue");
}

/** The one rule this primitive exists to enforce. The native macOS caret
 * paints against the right border and ignores padding, so a `<select>` next to
 * a native date input reads as misaligned — `appearance-none` plus our own
 * chevron is the fix. Drop `appearance-none` from `selectVariants` and this
 * file goes red. */
describe("Select — the native caret is suppressed and replaced", () => {
	it("turns off the UA caret", () => {
		expect(renderSelect().className).toContain("appearance-none");
	});

	it("draws its own chevron, inset from the right border", () => {
		const { container } = render(
			<Select aria-label="Venue">
				<option value="">Pick…</option>
			</Select>,
		);
		const chevron = container.querySelector("svg");
		expect(chevron).not.toBeNull();
		// Inset, not flush — the whole point of the replacement.
		expect(chevron?.getAttribute("class")).toMatch(/right-2\.5|right-3\.5/);
		// Never eats the click that should open the picker.
		expect(chevron?.getAttribute("class")).toContain("pointer-events-none");
		// Decorative: the `<select>` already carries the accessible name.
		expect(chevron?.getAttribute("aria-hidden")).toBe("true");
	});

	it("reserves the chevron's lane so a long label can't run under it", () => {
		expect(renderSelect().className).toContain("pr-10");
	});
});

describe("Select — states", () => {
	it("marks the error state for assistive tech, not just in colour", () => {
		expect(renderSelect({ isError: true }).getAttribute("aria-invalid")).toBe(
			"true",
		);
	});

	it("leaves aria-invalid off when there is no error", () => {
		// `false`/absent, never the string "true" — a permanently invalid
		// control is announced on every focus.
		expect(renderSelect().getAttribute("aria-invalid")).not.toBe("true");
	});

	it("dims the chevron with the control, so a locked picker doesn't read as merely empty", () => {
		const { container } = render(
			<Select aria-label="Venue" disabled>
				<option value="">Pick…</option>
			</Select>,
		);
		expect(container.querySelector("svg")?.getAttribute("class")).toContain(
			"opacity-50",
		);
	});

	it("keeps the field variant at the ≥44px mobile tap target", () => {
		expect(renderSelect().className).toContain("min-h-11");
	});

	it("puts layout on the wrapper so the chevron is placed against the seller's box", () => {
		const { container } = render(
			<Select aria-label="Venue" className="w-56">
				<option value="">Pick…</option>
			</Select>,
		);
		const wrapper = container.firstElementChild;
		expect(wrapper?.className).toContain("relative");
		expect(wrapper?.className).toContain("w-56");
		// …and NOT on the select, which fills it.
		expect(screen.getByLabelText("Venue").className).not.toContain("w-56");
	});
});
