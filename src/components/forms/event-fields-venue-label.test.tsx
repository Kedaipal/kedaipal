// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_EVENT_DRAFT, EventFields } from "./event-fields";

/**
 * A venue name is free text the seller typed, of no bounded length, shown in a
 * control that CANNOT ellipsize — a native `<select>` cuts an overrunning
 * option mid-word with nothing to say it did. Found driving the product wizard
 * (1 Oct 2026): "Kompleks Sukan Negeri Tampines Meetup Point" read as
 * "Kompleks Sukan Neger", which two venues sharing a prefix would make
 * genuinely ambiguous.
 *
 * The width is the fix; `title` is the recovery. This file pins the recovery
 * and the single author of the option text — the visible `<option>` and the
 * tooltip must never say two different things about the same place.
 *
 * Its own file: `event-fields.test.ts` is pure-logic with no DOM environment.
 */

afterEach(cleanup);

const LONG = "Kompleks Sukan Negeri Tampines Meetup Point";

const VENUES = [
	{ _id: "loc_a", label: "Tampines Hub Counter", isActive: true },
	{ _id: "loc_long", label: LONG, isActive: true },
	{ _id: "loc_hidden", label: "Old Warehouse Bay 3", isActive: false },
];

function renderPicker(venueId: string) {
	render(
		<EventFields
			draft={{ ...EMPTY_EVENT_DRAFT, on: true, date: "2026-12-04", venueId }}
			onChange={() => {}}
			locked={false}
			noToggle
			venues={VENUES}
		/>,
	);
	return screen.getByLabelText("Venue");
}

describe("EventFields — the venue name survives a control that can't ellipsize", () => {
	it("carries the picked venue's full name as the title", () => {
		expect(renderPicker("loc_long").getAttribute("title")).toBe(LONG);
	});

	it("leaves the title off before a venue is picked, so the placeholder isn't echoed", () => {
		expect(renderPicker("").getAttribute("title")).toBeNull();
	});

	/**
	 * One author (`venueOptionLabel`): the title is the text of the option the
	 * seller actually chose, suffix and all. Spell the suffix a second time at
	 * the title and a hidden venue starts reading as two different places.
	 */
	it("says the same thing in the option and the title for a hidden venue", () => {
		const select = renderPicker("loc_hidden");
		const picked = (select as HTMLSelectElement).selectedOptions[0];
		expect(picked.textContent).toBe("Old Warehouse Bay 3 — hidden from buyers");
		expect(select.getAttribute("title")).toBe(picked.textContent);
	});
});
