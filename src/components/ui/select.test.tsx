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

	/**
	 * An OMITTED variant and an explicit `variant="default"` are the same
	 * control, so they must place the chevron in the same spot. `cva` resolves
	 * the omission to `default` for the padding; a raw `variant === "default"`
	 * check would NOT, and the glyph would drift into the `field` position
	 * over `default` padding.
	 */
	it("places the chevron identically whether the default variant is omitted or named", () => {
		const chevronClass = (ui: React.ReactElement) =>
			render(ui).container.querySelector("svg")?.getAttribute("class");

		const omitted = chevronClass(
			<Select aria-label="A">
				<option value="">Pick…</option>
			</Select>,
		);
		cleanup();
		const named = chevronClass(
			<Select aria-label="B" variant="default">
				<option value="">Pick…</option>
			</Select>,
		);

		expect(omitted).toBe(named);
		expect(omitted).toContain("right-2.5");
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

	/**
	 * Asserted as a PAIR, because that's what makes it work: the chevron keys
	 * off the select's own `:disabled` via `peer-disabled:`, not off the
	 * `disabled` prop. Drop the `peer` class from the select, or the variant
	 * from the chevron, and the dimming silently stops.
	 *
	 * Keying on the element rather than the prop is deliberate: a control
	 * disabled by a wrapping `<fieldset disabled>` never sees a `disabled`
	 * prop here, and a chevron left bright on a locked picker reads as merely
	 * empty.
	 */
	it("dims the chevron from the select's own :disabled, not from the prop", () => {
		const { container } = render(
			<Select aria-label="Venue" disabled>
				<option value="">Pick…</option>
			</Select>,
		);
		expect(screen.getByLabelText("Venue").className).toContain("peer");
		expect(container.querySelector("svg")?.getAttribute("class")).toContain(
			"peer-disabled:opacity-50",
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
