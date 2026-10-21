// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanSkipsNote } from "./plan-skips-note";

afterEach(cleanup);

// Mon 5 Oct 2026, MYT midnight; "now" is that Wednesday at noon.
const MON = Date.UTC(2026, 9, 4, 16);
const DAY = 86_400_000;
const WED_NOON = MON + 2 * DAY + 4 * 3_600_000;

const plan = (extra: Record<string, unknown> = {}) => ({
	status: "confirmed",
	bookingCheckIn: MON,
	bookingCheckOut: MON + 5 * DAY,
	bookingOpenDays: true,
	...extra,
});

describe("PlanSkipsNote", () => {
	it("says nothing on a plan that can't be skipped", () => {
		const { container } = render(
			<PlanSkipsNote
				order={plan({ bookingOpenDays: false })}
				storeName="Sue Chef"
				ms={false}
				now={WED_NOON}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("counts the days left with today included, and says how to ask for a skip", () => {
		render(
			<PlanSkipsNote
				order={plan()}
				storeName="Sue Chef"
				ms={false}
				now={WED_NOON}
			/>,
		);
		// Wed, Thu, Fri.
		expect(screen.getByText("3 days left, today included")).toBeTruthy();
		expect(
			screen.getByText(
				"Can't make a day? Message Sue Chef — they can skip it and add a day to the end of your package.",
			),
		).toBeTruthy();
	});

	it("names every skip, the cap, and the new last day", () => {
		render(
			<PlanSkipsNote
				order={plan({
					bookingCheckOut: MON + 8 * DAY,
					bookingSkippedDays: [MON + DAY, MON + 5 * DAY, MON + 6 * DAY],
					bookingCustomerSkips: [MON + DAY],
				})}
				maxSkips={3}
				storeName="Sue Chef"
				ms={false}
				now={WED_NOON}
			/>,
		);
		expect(screen.getByText(/Skipped at your request:/)).toBeTruthy();
		expect(screen.getByText("Tue 6 Oct")).toBeTruthy();
		expect(
			screen.getByText(/\(1 of 3\)\. Your last day is now Mon, 12 Oct 2026\./),
		).toBeTruthy();
		expect(screen.getByText(/up to 3 per package/)).toBeTruthy();
		// Wed, Thu, Fri, then (weekend skipped) Mon.
		expect(screen.getByText("4 days left, today included")).toBeTruthy();
	});

	it("on the last day says so; after the plan, no promise", () => {
		const { rerender } = render(
			<PlanSkipsNote
				order={plan()}
				storeName="Sue Chef"
				ms={false}
				now={MON + 4 * DAY + 3_600_000}
			/>,
		);
		expect(screen.getByText("Last day: today")).toBeTruthy();
		rerender(
			<PlanSkipsNote
				order={plan()}
				storeName="Sue Chef"
				ms={false}
				now={MON + 5 * DAY + 3_600_000}
			/>,
		);
		expect(screen.queryByText(/Can't make a day/)).toBeNull();
		expect(screen.queryByText(/days left/)).toBeNull();
	});

	it("speaks Malay for a Malay store", () => {
		render(
			<PlanSkipsNote order={plan()} storeName="Sue Chef" ms now={WED_NOON} />,
		);
		expect(screen.getByText("3 hari lagi, termasuk hari ini")).toBeTruthy();
	});
});
