// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type DialIso,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import { COUNTRIES, type Country } from "../../../convex/lib/country";
import { waPhoneCheckoutSchema } from "../../lib/schemas";
import {
	BuyerPhoneCountrySwitch,
	BuyerPhoneInput,
	buyerPhonePlaceholder,
	MOBILE_PLACEHOLDER,
	MyPhoneInput,
	MyPhonePrefix,
} from "./my-phone-input";

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
		expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
			MOBILE_PLACEHOLDER.MY,
		);
	});

	it("wears the SG plate when the store's country says so", () => {
		render(<MyPhoneInput value="" onChange={() => {}} country="SG" />);
		expect(screen.getByText("+65")).toBeDefined();
		expect(screen.getByRole("img", { name: "Singapore" })).toBeDefined();
		expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
			MOBILE_PLACEHOLDER.SG,
		);
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

/**
 * The buyer variant (z8r3fdh274): the same plate carrying a country picker,
 * because a buyer's number is per-person, not per-store. These pin the
 * plate's promise for the picker — it opens on the store's country, what it
 * shows is what `parseBuyerWaPhone` judges by, and a typed `+CC` moves it —
 * plus the accessibility of a control that is two elements under one border.
 */
describe("BuyerPhoneInput", () => {
	afterEach(cleanup);

	/** A controlled host, like every real caller: value + pick in state. */
	function Host({
		storeCountry,
		onChange,
		onDialCountryChange,
	}: {
		storeCountry: Country;
		onChange?: (value: string) => void;
		onDialCountryChange?: (iso: DialIso) => void;
	}) {
		const [value, setValue] = useState("");
		const [dialCountry, setDialCountry] = useState<DialIso>(storeCountry);
		return (
			<BuyerPhoneInput
				value={value}
				onChange={(next) => {
					setValue(next);
					onChange?.(next);
				}}
				storeCountry={storeCountry}
				dialCountry={dialCountry}
				onDialCountryChange={(iso) => {
					setDialCountry(iso);
					onDialCountryChange?.(iso);
				}}
			/>
		);
	}

	const picker = () =>
		screen.getByRole("combobox", {
			name: "Country of your WhatsApp number",
		}) as HTMLSelectElement;

	it.each([
		["MY", "+60", "Malaysia"],
		["SG", "+65", "Singapore"],
	] as const)("opens on the store's country (%s)", (country, code, name) => {
		render(<Host storeCountry={country} />);
		expect(picker().value).toBe(country);
		expect(screen.getByText(code)).toBeDefined();
		// The flag is decoration beside a select that already announces the
		// country — hidden from the accessibility tree, not read twice.
		expect(screen.queryByRole("img", { name })).toBeNull();
		expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
			MOBILE_PLACEHOLDER[country],
		);
	});

	it("lists the store's country first", () => {
		render(<Host storeCountry="SG" />);
		expect(picker().options[0]?.value).toBe("SG");
	});

	it("is one text input and one select — nothing else to tab through", () => {
		const { container } = render(<Host storeCountry="MY" />);
		expect(container.querySelectorAll("input")).toHaveLength(1);
		expect(container.querySelectorAll("select")).toHaveLength(1);
	});

	it("marks the number invalid, never the picker", () => {
		// The error belongs to the digits: focus-on-error must land in the input,
		// and a screen reader must not hear the country called invalid.
		render(
			<BuyerPhoneInput
				value="123"
				onChange={() => {}}
				storeCountry="MY"
				dialCountry="MY"
				onDialCountryChange={() => {}}
				isError
			/>,
		);
		expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe(
			"true",
		);
		expect(picker().hasAttribute("aria-invalid")).toBe(false);
	});

	it("reports a pick from the select", () => {
		const onDialCountryChange = vi.fn();
		render(
			<Host storeCountry="MY" onDialCountryChange={onDialCountryChange} />,
		);
		fireEvent.change(picker(), { target: { value: "BN" } });
		expect(onDialCountryChange).toHaveBeenCalledWith("BN");
		expect(picker().value).toBe("BN");
	});

	it("a typed or pasted +CC moves the picker and keeps only the national part", () => {
		// Otherwise the plate would read `+60 | +81 90…` — two country codes.
		const onChange = vi.fn();
		const onDialCountryChange = vi.fn();
		render(
			<Host
				storeCountry="MY"
				onChange={onChange}
				onDialCountryChange={onDialCountryChange}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "+81 90-1234-5678" },
		});
		expect(onDialCountryChange).toHaveBeenCalledWith("JP");
		expect(onChange).toHaveBeenCalledWith("90-1234-5678");
		expect(picker().value).toBe("JP");
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
			"90-1234-5678",
		);
	});

	it("bare digits are never sniffed — the pick stays where it was", () => {
		const onDialCountryChange = vi.fn();
		render(
			<Host storeCountry="MY" onDialCountryChange={onDialCountryChange} />,
		);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "9123 4567" },
		});
		expect(onDialCountryChange).not.toHaveBeenCalled();
		expect(picker().value).toBe("MY");
	});

	it("a country without an inline flag shows its ISO badge and a neutral placeholder", () => {
		// No made-up example for 239 countries: a format the buyer then can't
		// match would be worse than none.
		render(<Host storeCountry="MY" />);
		fireEvent.change(picker(), { target: { value: "JP" } });
		expect(screen.getByText("JP")).toBeDefined();
		expect(screen.getByText("+81")).toBeDefined();
		expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
			"Mobile number",
		);
	});

	it.each(
		COUNTRIES,
	)("the %s placeholder is a number the buyer parser accepts for that country", (country) => {
		// The plate's promise, for the buyer variant: the example it shows must
		// parse under the country it shows.
		expect(parseBuyerWaPhone(buyerPhonePlaceholder(country), country).ok).toBe(
			true,
		);
	});

	it("carries the tel keyboard hints and the tel autofill by default", () => {
		render(<Host storeCountry="MY" />);
		const input = screen.getByRole("textbox");
		expect(input.getAttribute("type")).toBe("tel");
		expect(input.getAttribute("inputmode")).toBe("tel");
		expect(input.getAttribute("autocomplete")).toBe("tel");
	});

	it("lets a host turn autofill off (a cashier typing someone else's number)", () => {
		render(
			<BuyerPhoneInput
				value=""
				onChange={() => {}}
				storeCountry="MY"
				dialCountry="MY"
				onDialCountryChange={() => {}}
				autoComplete="off"
			/>,
		);
		expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe(
			"off",
		);
	});

	it("disables the picker with the field", () => {
		render(
			<BuyerPhoneInput
				value=""
				onChange={() => {}}
				storeCountry="MY"
				dialCountry="MY"
				onDialCountryChange={() => {}}
				disabled
			/>,
		);
		expect(picker().disabled).toBe(true);
		expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(
			true,
		);
	});
});

describe("BuyerPhoneCountrySwitch", () => {
	afterEach(cleanup);

	it("names the country it switches to and hands it back on tap", () => {
		const onSwitch = vi.fn();
		render(<BuyerPhoneCountrySwitch suggest="SG" onSwitch={onSwitch} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Switch to Singapore (+65)" }),
		);
		expect(onSwitch).toHaveBeenCalledWith("SG");
	});

	it("speaks the store's language on an ms store", () => {
		const onSwitch = vi.fn();
		render(
			<BuyerPhoneCountrySwitch suggest="MY" onSwitch={onSwitch} locale="ms" />,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Tukar ke Malaysia (+60)" }),
		);
		expect(onSwitch).toHaveBeenCalledWith("MY");
	});

	it("is never a submit button — tapping it inside a form must not send", () => {
		render(<BuyerPhoneCountrySwitch suggest="SG" onSwitch={() => {}} />);
		expect(screen.getByRole("button").getAttribute("type")).toBe("button");
	});
});
