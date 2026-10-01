// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DatePicker,
	dateFromYmd,
	formatPickedDate,
	ymdFromDate,
} from "./date-picker";

afterEach(cleanup);

/** A month with no edge cases, far enough out that "today" never affects it. */
const MIN = "2026-11-01";
const MAX = "2026-11-30";

function Host({
	initial = "",
	isDayDisabled,
	unavailableNote,
	onChange,
}: {
	initial?: string;
	isDayDisabled?: (ymd: string) => boolean;
	unavailableNote?: string;
	onChange?: (ymd: string) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<DatePicker
			value={value}
			onChange={(ymd) => {
				setValue(ymd);
				onChange?.(ymd);
			}}
			min={MIN}
			max={MAX}
			isDayDisabled={isDayDisabled}
			unavailableNote={unavailableNote}
		/>
	);
}

const trigger = () => screen.getByRole("button", { name: /date|2026|Pick a/i });
/** react-day-picker labels a day "Sunday, November 1st, 2026". */
const dayCell = (n: number) =>
	screen.getByRole("button", {
		name: new RegExp(`November ${n}(st|nd|rd|th), 2026`),
	});

describe("DatePicker — the day predicate", () => {
	it("refuses a day the caller marks unavailable, instead of taking it", () => {
		// THE point of replacing the native <input type="date">: it accepted
		// min/max and nothing else, so a store-closed day was offered and then
		// rejected on submit. Delete `isDayDisabled` from the Calendar's
		// `disabled` prop in date-picker.tsx and this test goes red.
		const onChange = vi.fn();
		render(
			<Host
				initial="2026-11-10"
				onChange={onChange}
				isDayDisabled={(ymd) => ymd === "2026-11-12"}
			/>,
		);
		fireEvent.click(trigger());
		const twelfth = dayCell(12);
		expect(twelfth.hasAttribute("disabled")).toBe(true);
		fireEvent.click(twelfth);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("still takes a day the predicate allows", () => {
		const onChange = vi.fn();
		render(
			<Host
				initial="2026-11-10"
				onChange={onChange}
				isDayDisabled={(ymd) => ymd === "2026-11-12"}
			/>,
		);
		fireEvent.click(trigger());
		fireEvent.click(dayCell(13));
		expect(onChange).toHaveBeenCalledWith("2026-11-13");
	});

	it("clamps to min and max as the native input did", () => {
		const onChange = vi.fn();
		render(
			<DatePicker
				value="2026-11-10"
				onChange={onChange}
				min="2026-11-05"
				max="2026-11-25"
			/>,
		);
		fireEvent.click(trigger());
		// Rendered by the month grid, but outside the window and refused.
		expect(dayCell(3).hasAttribute("disabled")).toBe(true);
		expect(dayCell(28).hasAttribute("disabled")).toBe(true);
		expect(dayCell(10).hasAttribute("disabled")).toBe(false);
		fireEvent.click(dayCell(3));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("explains the greying when there is greying to explain", () => {
		render(
			<Host
				initial="2026-11-10"
				isDayDisabled={(ymd) => ymd === "2026-11-12"}
				unavailableNote="Greyed-out days aren't available."
			/>,
		);
		fireEvent.click(trigger());
		// A constraint the buyer can see enforced must be one they can see
		// explained — otherwise the grey is just a dead end.
		expect(screen.getByText("Greyed-out days aren't available.")).toBeDefined();
	});

	it("says nothing when every day in the window is open", () => {
		render(<Host initial="2026-11-10" />);
		fireEvent.click(trigger());
		expect(screen.queryByText(/Greyed-out days/)).toBeNull();
	});
});

describe("DatePicker — the trigger", () => {
	it("reads the picked date in a form nobody can misread", () => {
		// 03/11 and 11/03 are opposite dates; this market reads day-first.
		render(<Host initial="2026-11-03" />);
		expect(screen.getByText(/Tue, 3 Nov 2026/)).toBeDefined();
	});

	it("shows a placeholder, not a blank control, with nothing picked", () => {
		render(<Host initial="" />);
		expect(screen.getByText("Pick a date")).toBeDefined();
	});

	it("carries the invalid state for assistive tech", () => {
		render(
			<DatePicker value="" onChange={() => {}} min={MIN} max={MAX} isError />,
		);
		expect(screen.getByRole("button").getAttribute("aria-invalid")).toBe(
			"true",
		);
	});

	it("is disabled with the field", () => {
		render(
			<DatePicker value="" onChange={() => {}} min={MIN} max={MAX} disabled />,
		);
		expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
	});

	it("fires onBlur when the popover closes — the moment the native blur fired", () => {
		const onBlur = vi.fn();
		render(
			<DatePicker
				value="2026-11-10"
				onChange={() => {}}
				min={MIN}
				max={MAX}
				onBlur={onBlur}
			/>,
		);
		fireEvent.click(trigger());
		expect(onBlur).not.toHaveBeenCalled();
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		expect(onBlur).toHaveBeenCalled();
	});
});

describe("ymd helpers", () => {
	it("round-trips a calendar day without a timezone shift", () => {
		// The classic bug: parsing "2026-11-01" as UTC midnight and rendering it
		// west of UTC shows 31 Oct. These stay in local y/m/d throughout.
		for (const ymd of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
			const date = dateFromYmd(ymd);
			expect(date).toBeDefined();
			expect(ymdFromDate(date as Date)).toBe(ymd);
		}
	});

	it("pads single-digit months and days", () => {
		expect(ymdFromDate(new Date(2026, 0, 5))).toBe("2026-01-05");
	});

	it("refuses a string that isn't a calendar day", () => {
		expect(dateFromYmd("")).toBeUndefined();
		expect(dateFromYmd("2026-13")).toBeUndefined();
		expect(dateFromYmd("not-a-date")).toBeUndefined();
	});

	it("formats nothing for an unparseable value rather than 'Invalid Date'", () => {
		expect(formatPickedDate("")).toBe("");
		expect(formatPickedDate("nonsense")).toBe("");
	});
});
