// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waPhoneCheckoutSchema } from "../../lib/schemas";
import { MOBILE_PLACEHOLDER, MyPhoneInput, MyPhonePrefix } from "./my-phone-input";

/**
 * The one plated phone control (86eyknr2r; per-country since SG-lite
 * 86eynw28q). These pin the things that make it safe to weld a fixed dial code
 * onto a field: the plate is actually visible, it matches the country prop,
 * and what a user types beside it is what that country's validator accepts.
 */

describe("MyPhoneInput", () => {
	afterEach(cleanup);

	it("renders the flag + dial code so the country code is visibly handled", () => {
		render(<MyPhoneInput value="" onChange={() => {}} />);
		expect(screen.getByText("+60")).toBeDefined();
		expect(screen.getByRole("img", { name: "Malaysia" })).toBeDefined();
	});

	it("defaults to the MY plate — untouched call sites keep their behaviour", () => {
		render(<MyPhoneInput value="" onChange={() => {}} />);
		expect(
			screen.getByRole("textbox").getAttribute("placeholder"),
		).toBe(MOBILE_PLACEHOLDER.MY);
	});

	it("wears the SG plate when the store's country says so", () => {
		render(<MyPhoneInput value="" onChange={() => {}} country="SG" />);
		expect(screen.getByText("+65")).toBeDefined();
		expect(screen.getByRole("img", { name: "Singapore" })).toBeDefined();
		expect(
			screen.getByRole("textbox").getAttribute("placeholder"),
		).toBe(MOBILE_PLACEHOLDER.SG);
	});

	it("the plate is not editable — only one input exists in the control", () => {
		// The whole point of the plate over a prefilled "+60" in the value: the
		// fixed part can't be selected, backspaced, or retyped.
		const { container } = render(<MyPhoneInput value="" onChange={() => {}} />);
		expect(container.querySelectorAll("input")).toHaveLength(1);
	});

	it("emits the raw typed string — normalization belongs to the validator", () => {
		const onChange = vi.fn();
		render(<MyPhoneInput value="" onChange={onChange} />);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "12-345 6789" },
		});
		expect(onChange).toHaveBeenCalledWith("12-345 6789");
	});

	it("each country's placeholder is a value its own schema accepts", () => {
		// The plate is a promise about what the field takes. If the placeholder
		// showed a shape the validator rejected, the control would be telling the
		// user to do something the save then refuses.
		expect(
			waPhoneCheckoutSchema.MY.safeParse(MOBILE_PLACEHOLDER.MY).success,
		).toBe(true);
		expect(
			waPhoneCheckoutSchema.SG.safeParse(MOBILE_PLACEHOLDER.SG).success,
		).toBe(true);
	});

	it("carries the tel keyboard hints on mobile", () => {
		render(<MyPhoneInput value="" onChange={() => {}} />);
		const input = screen.getByRole("textbox");
		expect(input.getAttribute("type")).toBe("tel");
		expect(input.getAttribute("inputmode")).toBe("tel");
	});

	it("marks the control invalid for assistive tech", () => {
		render(<MyPhoneInput value="03-1" onChange={() => {}} isError />);
		expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe(
			"true",
		);
	});
});

describe("MyPhonePrefix", () => {
	afterEach(cleanup);

	it("is the same plate the standalone input uses", () => {
		// Form-bound callers pass this into `TextField`'s prefix slot instead of
		// rendering MyPhoneInput; both must show the identical badge.
		render(<MyPhonePrefix />);
		expect(screen.getByText("+60")).toBeDefined();
		expect(screen.getByRole("img", { name: "Malaysia" })).toBeDefined();
	});

	it("renders the SG badge for an SG store", () => {
		render(<MyPhonePrefix country="SG" />);
		expect(screen.getByText("+65")).toBeDefined();
		expect(screen.getByRole("img", { name: "Singapore" })).toBeDefined();
	});
});
