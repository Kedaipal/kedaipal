// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EventHeadcount, EventRsvpPanel } from "./event-rsvp-panel";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

afterEach(cleanup);

const BASE: EventHeadcount = {
	date: Date.UTC(2026, 11, 3, 16),
	taken: 40,
	seats: 40,
	left: 0,
	passed: false,
	options: [{ label: "", seats: 40 }],
};

describe("EventRsvpPanel — buyer-question tallies (z8r3fdkjek)", () => {
	it("tallies each choice question without opening an order", () => {
		render(
			<EventRsvpPanel
				productName="Into The Falls"
				headcount={{
					...BASE,
					questions: [
						{
							questionId: "bring001",
							label: "What are you bringing?",
							options: [
								{ label: "2 Helinox furniture", seats: 17 },
								{ label: "Helinox tent", seats: 23 },
							],
						},
					],
				}}
			/>,
		);
		expect(screen.getByText("What are you bringing?")).toBeTruthy();
		expect(screen.getByText("Helinox tent")).toBeTruthy();
		expect(screen.getByText("23")).toBeTruthy();
		expect(screen.getByText("17")).toBeTruthy();
	});

	it("an event that asks nothing looks exactly as before", () => {
		render(<EventRsvpPanel productName="Breakfast" headcount={BASE} />);
		expect(screen.queryByText("What are you bringing?")).toBeNull();
	});
});
