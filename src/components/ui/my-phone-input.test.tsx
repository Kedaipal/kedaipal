// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type DialIso,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import { COUNTRIES, type Country } from "../../../convex/lib/country";
import { waPhoneCheckoutSchema } from "../../lib/schemas";
import {
	applyBuyerPhoneKeystroke,
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
describe("BuyerPhoneInput", async () => {
	afterEach(cleanup);

	/** A controlled host, like every real caller: value + pick in state. */
	function Host({
		storeCountry,
		initialValue = "",
		onChange,
		onDialCountryChange,
	}: {
		storeCountry: Country;
		initialValue?: string;
		onChange?: (value: string) => void;
		onDialCountryChange?: (iso: DialIso) => void;
	}) {
		const [value, setValue] = useState(initialValue);
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

	/**
	 * The plate's control. It used to be an invisible `<select>`; since
	 * z8r3fdm36y it is a button opening a searchable sheet, so the queries
	 * change shape — what each test is PROVING does not.
	 */
	const picker = (name = "Country of your WhatsApp number") =>
		screen.getByRole("button", { name }) as HTMLButtonElement;

	/** The dial code the plate is showing — this control's "value". Read it with
	 * the sheet CLOSED: open, the list repeats every code. */
	const plateCode = () =>
		within(picker().parentElement as HTMLElement).getByText(/^\+\d+$/)
			.textContent;

	/** Open the sheet and pick a country by its row. */
	async function pick(name: string, query?: string) {
		fireEvent.click(picker());
		const search = await screen.findByRole("combobox");
		if (query !== undefined)
			fireEvent.change(search, { target: { value: query } });
		fireEvent.click(
			await screen.findByRole("option", { name: new RegExp(name) }),
		);
	}

	it.each([
		["MY", "+60", "Malaysia"],
		["SG", "+65", "Singapore"],
	] as const)("opens on the store's country (%s)", (country, code, name) => {
		render(<Host storeCountry={country} />);
		expect(plateCode()).toBe(code);
		// The flag is decoration beside a control that already announces the
		// country — hidden from the accessibility tree, not read twice.
		expect(screen.queryByRole("img", { name })).toBeNull();
		expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
			MOBILE_PLACEHOLDER[country],
		);
	});

	it("names the picker for whose number it is", () => {
		// The counter keys someone else's number; "your" would be wrong there.
		render(
			<BuyerPhoneInput
				value=""
				onChange={() => {}}
				storeCountry="MY"
				dialCountry="MY"
				onDialCountryChange={() => {}}
				countryLabel="Country of the buyer's WhatsApp number"
			/>,
		);
		expect(picker("Country of the buyer's WhatsApp number")).toBeDefined();
		expect(
			screen.queryByRole("button", {
				name: "Country of your WhatsApp number",
			}),
		).toBeNull();
	});

	it("shows keyboard focus on the plate — the trigger itself is invisible", () => {
		// A Tab onto an opacity-0 trigger would otherwise land nowhere visible.
		// The wash span right after it is its `peer`, and paints the ring.
		render(<Host storeCountry="MY" />);
		const trigger = picker();
		expect(trigger.classList.contains("peer")).toBe(true);
		const wash = trigger.nextElementSibling as HTMLElement;
		expect(wash.getAttribute("aria-hidden")).toBe("true");
		for (const cls of [
			"peer-focus-visible:bg-muted",
			"peer-focus-visible:ring-2",
			"peer-focus-visible:ring-ring",
			"peer-focus-visible:ring-inset",
		]) {
			expect(wash.classList.contains(cls)).toBe(true);
		}
	});

	it("lists the store's country first", async () => {
		render(<Host storeCountry="SG" />);
		fireEvent.click(picker());
		const options = await screen.findAllByRole("option");
		expect(options[0]?.textContent).toContain("Singapore");
	});

	it("searches by dial code — the one string the plate actually prints", async () => {
		// The native <select> this replaced could only type-ahead the country
		// NAME, so "+81" matched nothing at all. That is why it was replaced.
		render(<Host storeCountry="MY" />);
		fireEvent.click(picker());
		fireEvent.change(await screen.findByRole("combobox"), {
			target: { value: "+81" },
		});
		const options = await screen.findAllByRole("option");
		expect(options[0]?.textContent).toContain("Japan");
	});

	it("says so when nothing matches, instead of an empty box", async () => {
		render(<Host storeCountry="MY" />);
		fireEvent.click(picker());
		fireEvent.change(await screen.findByRole("combobox"), {
			target: { value: "zzzzz" },
		});
		expect(await screen.findByText(/No country matches/)).toBeDefined();
		expect(screen.queryAllByRole("option")).toHaveLength(0);
	});

	it("is one text input and one picker button — nothing else to tab through", () => {
		const { container } = render(<Host storeCountry="MY" />);
		expect(container.querySelectorAll("input")).toHaveLength(1);
		// The 241-option <select> is gone; its replacement opens on demand.
		expect(container.querySelectorAll("select")).toHaveLength(0);
		expect(container.querySelectorAll("button")).toHaveLength(1);
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

	it("reports a pick from the sheet", async () => {
		const onDialCountryChange = vi.fn();
		render(
			<Host storeCountry="MY" onDialCountryChange={onDialCountryChange} />,
		);
		await pick("Brunei", "brunei");
		expect(onDialCountryChange).toHaveBeenCalledWith("BN");
		expect(plateCode()).toBe("+673");
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
		expect(plateCode()).toBe("+81");
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
			"90-1234-5678",
		);
	});

	it("a code typed from the start switches once it's complete", () => {
		const onDialCountryChange = vi.fn();
		render(
			<Host storeCountry="MY" onDialCountryChange={onDialCountryChange} />,
		);
		const input = screen.getByRole("textbox") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "+" } });
		fireEvent.change(input, { target: { value: "+4" } });
		// "+4" is no country's code yet — nothing moves on a half-typed one.
		expect(onDialCountryChange).not.toHaveBeenCalled();
		expect(input.value).toBe("+4");
		fireEvent.change(input, { target: { value: "+44" } });
		expect(onDialCountryChange).toHaveBeenCalledWith("GB");
		expect(plateCode()).toBe("+44");
		// The code went to the plate; the box is left for the national number.
		expect(input.value).toBe("");
	});

	it("a paste over what was there switches — the code arrived with the number", () => {
		render(<Host storeCountry="MY" initialValue="12-345" />);
		const input = screen.getByRole("textbox") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "+81 90-1234-5678" } });
		expect(plateCode()).toBe("+81");
		expect(input.value).toBe("90-1234-5678");
	});

	it("a '+' slipped in front of a local number moves nothing and eats no digit", () => {
		// Calling codes are prefix-free: read as typed, "+12-345 6789" is "+1"
		// — the plate would jump to the United States and swallow the 1.
		const onDialCountryChange = vi.fn();
		render(
			<Host
				storeCountry="MY"
				initialValue="12-345 6789"
				onDialCountryChange={onDialCountryChange}
			/>,
		);
		const input = screen.getByRole("textbox") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "+12-345 6789" } });
		expect(onDialCountryChange).not.toHaveBeenCalled();
		expect(plateCode()).toBe("+60");
		expect(input.value).toBe("+12-345 6789");
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
		expect(plateCode()).toBe("+60");
	});

	it("a country without an inline flag shows its ISO badge and a neutral placeholder", async () => {
		// No made-up example for 239 countries: a format the buyer then can't
		// match would be worse than none.
		render(<Host storeCountry="MY" />);
		await pick("Japan", "japan");
		expect(screen.getByText("JP")).toBeDefined();
		expect(plateCode()).toBe("+81");
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
		render(
			<BuyerPhoneCountrySwitch
				suggest="SG"
				onSwitch={onSwitch}
				inputId="wa-phone"
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Switch to Singapore (+65)" }),
		);
		expect(onSwitch).toHaveBeenCalledWith("SG");
	});

	it("speaks the store's language on an ms store", () => {
		const onSwitch = vi.fn();
		render(
			<BuyerPhoneCountrySwitch
				suggest="MY"
				onSwitch={onSwitch}
				locale="ms"
				inputId="wa-phone"
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Tukar ke Malaysia (+60)" }),
		);
		expect(onSwitch).toHaveBeenCalledWith("MY");
	});

	it("is never a submit button — tapping it inside a form must not send", () => {
		render(
			<BuyerPhoneCountrySwitch
				suggest="SG"
				onSwitch={() => {}}
				inputId="wa-phone"
			/>,
		);
		expect(screen.getByRole("button").getAttribute("type")).toBe("button");
	});

	it("hands focus back to the number — the fix unmounts the button", () => {
		/** Like every host: the switch shows only while the rejection does. */
		function Host() {
			const [switched, setSwitched] = useState(false);
			return (
				<>
					<input id="wa-phone" aria-label="WhatsApp number" />
					{switched ? null : (
						<BuyerPhoneCountrySwitch
							suggest="SG"
							onSwitch={() => setSwitched(true)}
							inputId="wa-phone"
						/>
					)}
				</>
			);
		}
		render(<Host />);
		const button = screen.getByRole("button", {
			name: "Switch to Singapore (+65)",
		});
		button.focus();
		fireEvent.click(button);
		expect(screen.queryByRole("button")).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("textbox", { name: "WhatsApp number" }),
		);
	});
});

describe("applyBuyerPhoneKeystroke — when a typed code moves the picker", () => {
	it("a paste that replaces the whole box switches, even at a similar length", () => {
		// Select-all over "7911 123456" (11 chars) and paste "+60123456789"
		// (12): no common prefix, everything inserted — the code arrived.
		expect(
			applyBuyerPhoneKeystroke("+60123456789", "GB", "7911 123456"),
		).toEqual({ value: "123456789", dialCountry: "MY" });
	});

	it("the space typed right after a code the plate absorbed doesn't lead the box", () => {
		// "+44" moved to the plate and emptied the box; the next keystroke is
		// the space the buyer types after a country code.
		expect(applyBuyerPhoneKeystroke(" ", "GB", "")).toEqual({
			value: "",
			dialCountry: "GB",
		});
		expect(applyBuyerPhoneKeystroke(" 7", "GB", " ")).toEqual({
			value: "7",
			dialCountry: "GB",
		});
	});

	it("a single + slipped in front of existing digits never switches", () => {
		expect(
			applyBuyerPhoneKeystroke("+12-345 6789", "MY", "12-345 6789"),
		).toEqual({ value: "+12-345 6789", dialCountry: "MY" });
	});
});
