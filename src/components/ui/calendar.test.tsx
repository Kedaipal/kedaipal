// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Calendar } from "./calendar";

afterEach(cleanup);

describe("Calendar", () => {
	/**
	 * The month chevrons are `position: absolute; inset-x-0`, so the calendar
	 * ROOT has to be their containing block. react-day-picker ships that rule in
	 * a stylesheet we deliberately never import (we theme from scratch), so the
	 * `relative` class here is the only thing holding it up.
	 *
	 * Without it the nav resolves against whatever ancestor happens to be
	 * positioned — on the booking checkout that was the BODY, putting the
	 * chevrons in the page margins 700px from the calendar and making the month
	 * unnavigable. jsdom has no stylesheet to compute against, so this asserts
	 * the class rather than the geometry: delete `relative` and it goes red.
	 */
	it("makes the root a containing block for the absolutely-positioned nav", () => {
		const { container } = render(<Calendar mode="single" />);
		const root = container.querySelector(".rdp-root");
		const nav = container.querySelector(".rdp-nav");

		expect(root).not.toBeNull();
		expect(nav).not.toBeNull();
		// The nav must be a DESCENDANT of the element carrying `relative` —
		// moving `relative` to an inner wrapper would pass a naive class check
		// while still leaving the chevrons adrift.
		expect(root?.contains(nav as Node)).toBe(true);
		expect(root?.classList.contains("relative")).toBe(true);
		expect(nav?.classList.contains("absolute")).toBe(true);
	});

	it("renders both month chevrons", () => {
		const { container } = render(<Calendar mode="single" />);
		const buttons = container.querySelectorAll(".rdp-nav button");
		expect(buttons.length).toBe(2);
	});

	/**
	 * The range band (z8r3fdhpm7). It used to live in arbitrary variants like
	 * `[&.rdp-range_middle]:bg-accent/12`, which Tailwind compiles with the
	 * underscore turned into a SPACE — `&.rdp-range middle` — so the band never
	 * painted, and a `modifiersClassNames` entry replaced the `rdp-range_start`
	 * class the rounded ends hooked onto. Found rendering the closed-dates
	 * sheet. jsdom has no Tailwind, so this pins what the fix relies on: the
	 * band classes sit directly on the modifier, and no variant keyed on a
	 * `rdp-range_*` class name remains to silently compile to nothing.
	 */
	it("paints the range band through modifier classes, never an underscore variant", () => {
		const from = new Date(2026, 9, 1);
		const to = new Date(2026, 9, 3);
		const { container } = render(
			<Calendar mode="range" selected={{ from, to }} defaultMonth={from} />,
		);
		const cell = (day: string) =>
			[...container.querySelectorAll("[role=gridcell]")].find(
				(c) => c.textContent?.trim() === day,
			) as HTMLElement;
		expect(cell("1").className).toContain("rounded-l-full");
		expect(cell("2").className).toContain("bg-accent/12");
		expect(cell("3").className).toContain("rounded-r-full");
		expect(container.innerHTML).not.toMatch(/\[&\.rdp-range_/);
	});

	it("a caller's own modifier classes ADD to the band, never replace it", () => {
		// The closed-dates sheet hatches already-closed days; passing that one
		// entry used to replace the whole map, and the band vanished again.
		const from = new Date(2026, 9, 1);
		const to = new Date(2026, 9, 3);
		const { container } = render(
			<Calendar
				mode="range"
				selected={{ from, to }}
				defaultMonth={from}
				modifiers={{ marked: new Date(2026, 9, 2) }}
				modifiersClassNames={{ marked: "hatch-me" }}
			/>,
		);
		const cell = (day: string) =>
			[...container.querySelectorAll("[role=gridcell]")].find(
				(c) => c.textContent?.trim() === day,
			) as HTMLElement;
		expect(cell("2").className).toContain("hatch-me");
		expect(cell("2").className).toContain("bg-accent/12");
		expect(cell("1").className).toContain("rounded-l-full");
	});
});
