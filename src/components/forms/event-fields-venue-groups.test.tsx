// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	EMPTY_EVENT_DRAFT,
	EventFields,
	groupVenues,
	type VenueOption,
} from "./event-fields";

/**
 * The venue picker's grouping (`z8r3fdm32x`).
 *
 * The rejected alternative was "RSVP locations alphabetically first, then the
 * rest": an invisible ordering rule teaches the seller nothing about why an
 * option sits where it does, and sorting this one surface alphabetically while
 * every other reads `sortOrder` would be two rules for one list. Headings do
 * the explaining; the seller's own drag order survives inside them.
 */

afterEach(cleanup);

const VENUES: VenueOption[] = [
	// Deliberately NOT in alphabetical order, and interleaved across groups —
	// this array is what `listForRetailer` returns, i.e. `sortOrder`.
	{ _id: "p2", label: "Zara Stall", isActive: true },
	{ _id: "v1", label: "Community Hall", isActive: true, eventsOnly: true },
	{ _id: "p1", label: "Alpha Store", isActive: true },
	{ _id: "off1", label: "Old Warehouse", isActive: false },
	{ _id: "v2", label: "Backyard Studio", isActive: true, eventsOnly: true },
];

describe("groupVenues", () => {
	it("leads with event venues, then pickup points, then inactive ones", () => {
		expect(groupVenues(VENUES).map((g) => g.heading)).toEqual([
			"Event venues",
			"Pickup points",
			"Inactive",
		]);
	});

	/** The load-bearing one: `sortOrder`, not the alphabet. */
	it("keeps the seller's own order inside each group", () => {
		const groups = groupVenues(VENUES);
		expect(groups[0].venues.map((v) => v.label)).toEqual([
			"Community Hall",
			"Backyard Studio",
		]);
		expect(groups[1].venues.map((v) => v.label)).toEqual([
			"Zara Stall",
			"Alpha Store",
		]);
	});

	it("drops a group that has no venues rather than showing an empty heading", () => {
		expect(
			groupVenues([{ _id: "p1", label: "Only One", isActive: true }]).map(
				(g) => g.heading,
			),
		).toEqual(["Pickup points"]);
	});

	/**
	 * An inactive venue stays listed: naming where an event ALREADY is isn't a
	 * move, and dropping it would render an existing selection as blank.
	 */
	it("keeps an inactive point selectable", () => {
		const groups = groupVenues(VENUES);
		expect(groups[2].venues.map((v) => v._id)).toEqual(["off1"]);
	});

	it("treats a point with no flag as an ordinary pickup point", () => {
		// Legacy rows carry no `eventsOnly` at all — absent must read as false.
		const groups = groupVenues([
			{ _id: "legacy", label: "Legacy Point", isActive: true },
		]);
		expect(groups[0].heading).toBe("Pickup points");
	});
});

describe("EventFields — the picker renders the groups", () => {
	it("wraps each group in an optgroup the OS picker can show", () => {
		const { container } = render(
			<EventFields
				draft={{ ...EMPTY_EVENT_DRAFT, on: true, date: "2026-12-04" }}
				onChange={() => {}}
				locked={false}
				noToggle
				venues={VENUES}
			/>,
		);
		const groups = [...container.querySelectorAll("optgroup")];
		expect(groups.map((g) => g.getAttribute("label"))).toEqual([
			"Event venues",
			"Pickup points",
			"Inactive",
		]);
		// Every venue is still reachable — grouping organises, it never hides.
		expect(
			screen.getByLabelText("Venue").querySelectorAll("option"),
		).toHaveLength(
			VENUES.length + 1, // + the placeholder
		);
	});
});
