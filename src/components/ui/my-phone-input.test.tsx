// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { myWaPhoneCheckoutSchema } from "../../lib/schemas";
import { MyPhoneInput, MyPhonePrefix } from "./my-phone-input";

/**
 * The one Malaysian phone control (86eyknr2r). These pin the two things that
 * make it safe to weld a fixed `+60` onto a field: the plate is actually
 * visible, and what a user types beside it is what the validator accepts.
 */

describe("MyPhoneInput", () => {
	afterEach(cleanup);

	it("renders the flag + dial code so the country code is visibly handled", () => {
		render(<MyPhoneInput value="" onChange={() => {}} />);
		expect(screen.getByText("+60")).toBeDefined();
		expect(screen.getByRole("img", { name: "Malaysia" })).toBeDefined();
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

	it("its placeholder is a value the schema behind it accepts", () => {
		// The plate is a promise about what the field takes. If the placeholder
		// showed a shape the validator rejected, the control would be telling the
		// user to do something the save then refuses.
		render(<MyPhoneInput value="" onChange={() => {}} />);
		const placeholder = screen
			.getByRole("textbox")
			.getAttribute("placeholder") as string;
		expect(myWaPhoneCheckoutSchema.safeParse(placeholder).success).toBe(true);
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
});
