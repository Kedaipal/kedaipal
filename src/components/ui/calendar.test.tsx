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
});
