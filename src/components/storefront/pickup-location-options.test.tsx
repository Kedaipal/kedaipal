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
	it("names the radio by its label and describes it by address + note", () => {
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
		const [addressId, noteId] = (
			radio.getAttribute("aria-describedby") ?? ""
		).split(" ");
		expect(screen.getByText("12 Jalan Mawar, Petaling Jaya").id).toBe(
			addressId,
		);
		// The note text itself — its "Show more" button is not part of it.
		expect(document.getElementById(noteId)?.textContent).toBe(
			"Ring the bell at https://x.co/door",
		);
	});
});

/**
 * `asEventVenue` — the card is showing WHERE AN EVENT HAPPENS, not a pickup
 * option the guest chose (`z8r3fdm32x`).
 *
 * The two suppressions are asserted together on purpose: they are one idea,
 * and the badge half was missed when the fee half shipped. Found by driving
 * the real RSVP page (6 Oct 2026) — "Dewan Serbaguna MPKS · SELF-COLLECT" to a
 * guest who is attending, not collecting.
 */
describe("a venue card is not a pickup option (asEventVenue)", () => {
	it("drops the self-collect / drop-off badge — a guest is attending, not collecting", () => {
		render(
			<PickupSummaryCard
				location={location({ locationType: "self_collect" })}
				currency="MYR"
				asEventVenue
			/>,
		);
		expect(screen.queryByText(/self-collect/i)).toBeNull();
	});

	it("drops a drop-off badge for the same reason", () => {
		render(
			<PickupSummaryCard
				location={location({ locationType: "drop_off" })}
				currency="MYR"
				asEventVenue
			/>,
		);
		expect(screen.queryByText(/drop-off/i)).toBeNull();
	});

	it("still drops the fee chip — an event venue never charges it", () => {
		render(
			<PickupSummaryCard
				location={location({ fee: 500 })}
				currency="MYR"
				asEventVenue
			/>,
		);
		expect(screen.queryByText(/5\.00/)).toBeNull();
	});

	it("keeps the address and the name — suppressing the vocabulary, not the facts", () => {
		render(
			<PickupSummaryCard
				location={location({ fee: 500 })}
				currency="MYR"
				asEventVenue
			/>,
		);
		expect(screen.getByText("Main shop")).toBeTruthy();
		expect(screen.getByText("12 Jalan Mawar, Petaling Jaya")).toBeTruthy();
	});

	it("an ORDINARY pickup card still shows both — the suppression is opt-in", () => {
		render(
			<PickupSummaryCard location={location({ fee: 500 })} currency="MYR" />,
		);
		expect(screen.getByText(/self-collect/i)).toBeTruthy();
		expect(screen.getByText(/5\.00/)).toBeTruthy();
	});
});
