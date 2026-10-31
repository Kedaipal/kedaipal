// @vitest-environment jsdom
// "How did you find Kedaipal?" (86eye3eyp): optional with nothing picked,
// one answer at a time (tap again to clear), and the referral field opens in
// place for "Another Kedaipal seller" — or stays open while it holds a store.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	ACQUISITION_CHANNELS,
	type AcquisitionChannel,
} from "../../../convex/lib/metrics";
import { FOUND_US_OPTIONS, FoundUsQuestion } from "./found-us-question";

afterEach(cleanup);

function Harness({
	initial = null,
	referralOpen = false,
}: {
	initial?: AcquisitionChannel | null;
	referralOpen?: boolean;
}) {
	const [value, setValue] = useState<AcquisitionChannel | null>(initial);
	return (
		<>
			<FoundUsQuestion
				value={value}
				onChange={setValue}
				referralOpen={referralOpen}
				referralField={<span>referral-field</span>}
			/>
			<output>{value ?? "none"}</output>
		</>
	);
}

const chip = (name: string) => screen.getByRole("button", { name });

describe("FoundUsQuestion", () => {
	it("offers every channel once, in the seller's words", () => {
		expect(FOUND_US_OPTIONS.map((o) => o.channel).sort()).toEqual(
			[...ACQUISITION_CHANNELS].sort(),
		);
	});

	it("starts with nothing picked and no referral field", () => {
		render(<Harness />);
		for (const option of FOUND_US_OPTIONS)
			expect(chip(option.label).getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByText("referral-field")).toBeNull();
		expect(screen.getByText(/optional/)).toBeTruthy();
	});

	it("picks one answer at a time, and a second tap clears it", () => {
		render(<Harness />);
		fireEvent.click(chip("Google"));
		expect(screen.getByRole("status").textContent).toBe("inbound_search");
		fireEvent.click(chip("A talk or event"));
		expect(screen.getByRole("status").textContent).toBe("talk_event");
		expect(chip("Google").getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(chip("A talk or event"));
		expect(screen.getByRole("status").textContent).toBe("none");
	});

	it("opens the referral field for another seller", () => {
		render(<Harness />);
		fireEvent.click(chip("Another Kedaipal seller"));
		expect(screen.getByText("referral-field")).toBeTruthy();
	});

	it("keeps the referral field open while it holds a store, whatever is picked", () => {
		render(<Harness initial="inbound_social" referralOpen />);
		expect(screen.getByText("referral-field")).toBeTruthy();
	});
});
