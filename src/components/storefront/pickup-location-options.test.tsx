// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	PickupLocationRadioList,
	PickupSummaryCard,
	type PublicPickupLocation,
} from "./pickup-location-options";

afterEach(cleanup);

function location(
	overrides: Partial<PublicPickupLocation> = {},
): PublicPickupLocation {
	return {
		_id: "loc_1" as Id<"pickupLocations">,
		label: "Main shop",
		address: "12 Jalan Mawar, Petaling Jaya",
		locationType: "self_collect",
		sortOrder: 0,
		...overrides,
	};
}

// A pickup point's own note is readable — and its links tappable — wherever
// the buyer picks the point (z8r3fdn2uj).
describe("pickup point notes at checkout", () => {
	it("the single-point card links a Markdown label", () => {
		render(
			<PickupSummaryCard
				location={location({
					notes: "Park at the [back lot](https://x.co/park).",
				})}
				currency="MYR"
			/>,
		);
		expect(
			screen.getByRole("link", { name: "back lot" }).getAttribute("href"),
		).toBe("https://x.co/park");
	});

	it("every option in the picker shows its note, with a tappable link", () => {
		const onChange = vi.fn();
		render(
			<PickupLocationRadioList
				locations={[
					location({ notes: "Ring the bell at https://x.co/door" }),
					location({
						_id: "loc_2" as Id<"pickupLocations">,
						label: "Pasar stall",
						notes: "Stall 14, by the fruit seller.",
					}),
				]}
				currency="MYR"
				value=""
				onChange={onChange}
			/>,
		);
		expect(screen.getByText("Stall 14, by the fruit seller.")).toBeTruthy();
		const link = screen.getByRole("link", { name: "https://x.co/door" });
		// Opening the link must not also choose the option.
		fireEvent.click(link);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("pickup option accessible name", () => {
	it("names the radio by the point's label, not the whole card", () => {
		render(
			<PickupLocationRadioList
				locations={[location({ notes: "Ring the bell at https://x.co/door" })]}
				currency="MYR"
				value=""
				onChange={() => {}}
			/>,
		);
		const radio = screen.getByRole("radio", { name: "Main shop" });
		expect(radio).toBeTruthy();
		expect(screen.getByText("12 Jalan Mawar, Petaling Jaya").id).toBe(
			radio.getAttribute("aria-describedby"),
		);
	});
});
