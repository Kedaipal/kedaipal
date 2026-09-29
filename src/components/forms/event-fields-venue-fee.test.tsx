// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_EVENT_DRAFT, EventFields } from "./event-fields";

/**
 * The seller's half of "an event venue charges no pickup fee" (`z8r3fdjgvd`).
 *
 * `buildEventVenueSnapshot` stops charging it, and `PickupSummaryCard` stops
 * advertising it to the buyer — but the seller is the one who CONFIGURED that
 * fee. Without a word here they pick a venue that carries a fee, see it on
 * their Fulfilment row, and quietly collect nothing on every RSVP. CLAUDE.md:
 * a constraint is surfaced, never enforced silently — and to whichever side it
 * affects, which here is both.
 *
 * Its own file: `event-fields.test.ts` is pure-logic (no DOM environment), and
 * this needs a render.
 */

afterEach(cleanup);

const VENUES = [
	{ _id: "loc_free", label: "The Studio", isActive: true },
	{ _id: "loc_paid", label: "Eco Majestic", isActive: true, fee: 500 },
];

function renderPicker(venueId: string, venues = VENUES) {
	return render(
		<EventFields
			draft={{ ...EMPTY_EVENT_DRAFT, on: true, date: "2026-12-04", venueId }}
			onChange={() => {}}
			locked={false}
			noToggle
			venues={venues}
		/>,
	);
}

const NOTE = /guests of this event aren't charged it/i;

describe("EventFields — the venue's pickup fee (z8r3fdjgvd)", () => {
	it("says a paid venue's fee is not charged to guests", () => {
		renderPicker("loc_paid");
		const note = screen.getByText(NOTE);
		// Names the point, so a multi-outlet seller knows WHICH fee is meant.
		expect(note.textContent).toMatch(/Eco Majestic/);
		// The reason, not just the rule — it is what makes it stick.
		expect(note.textContent).toMatch(/attending, not collecting/i);
	});

	it("says nothing when the picked venue is free", () => {
		// Mutation-guard: an unconditional note invents a fee rule on the stores
		// that have no fee, which is most of them.
		renderPicker("loc_free");
		expect(screen.queryByText(NOTE)).toBeNull();
	});

	it("says nothing before a venue is picked", () => {
		renderPicker("");
		expect(screen.queryByText(NOTE)).toBeNull();
	});

	it("a single-venue store gets the note without picking anything", () => {
		// With one point there is no selector at all — the venue is a stated
		// fact — so keying the note on `draft.venueId` alone would never fire on
		// exactly the stores least likely to go looking.
		render(
			<EventFields
				draft={{ ...EMPTY_EVENT_DRAFT, on: true, date: "2026-12-04" }}
				onChange={() => {}}
				locked={false}
				noToggle
				venues={[VENUES[1]]}
			/>,
		);
		expect(screen.getByText(NOTE).textContent).toMatch(/Eco Majestic/);
	});
});
