// @vitest-environment jsdom
/**
 * The "this moved" line (ClickUp `z8r3fdff97` test round).
 *
 * Found by driving a reschedule: the seller moves 3:00 PM to 1:00 PM, the
 * buyer's page then reads "Collect on Mon, 21 Sep · 1:00 PM" — indistinguishable
 * from the time they picked themselves — and no message goes out to tell them
 * otherwise. These pin that the page says it changed, says what it was, and
 * stays quiet on orders nobody has touched.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MYT_OFFSET_MS } from "../../../convex/lib/fulfilmentDate";
import { RescheduledNote } from "./rescheduled-note";

afterEach(cleanup);

/** Mon 21 Sep 2026, MYT midnight. */
const MON = Date.UTC(2026, 8, 21) - MYT_OFFSET_MS;

describe("RescheduledNote", () => {
	it("names the store and the moment it moved from", () => {
		render(
			<RescheduledNote
				audience="buyer"
				rescheduledAt={Date.now() - 5 * 60_000}
				fromDate={MON}
				fromTimeMinutes={15 * 60}
				storeName="IndoMart"
			/>,
		);
		const text = document.body.textContent ?? "";
		expect(text).toContain("IndoMart changed this");
		expect(text).toContain("21 Sep 2026");
		expect(text).toContain("3:00 PM");
		expect(text).toContain("5m ago");
	});

	it("keeps the old moment on one line — a wrapped '3:00⏎PM' reads as noise", () => {
		render(
			<RescheduledNote
				audience="buyer"
				rescheduledAt={Date.now()}
				fromDate={MON}
				fromTimeMinutes={15 * 60}
				storeName="IndoMart"
			/>,
		);
		const moment = screen.getByText(/21 Sep 2026 · 3:00 PM/);
		expect(moment.className).toContain("whitespace-nowrap");
	});

	it("a cleared time shows the day it moved from, with no invented hour", () => {
		render(
			<RescheduledNote
				audience="buyer"
				rescheduledAt={Date.now()}
				fromDate={MON}
				fromTimeMinutes={undefined}
				storeName="IndoMart"
			/>,
		);
		const text = document.body.textContent ?? "";
		expect(text).toContain("21 Sep 2026");
		expect(text).not.toMatch(/\d:\d\d\s?(AM|PM)/);
	});

	it("an order that had no date at all says that, instead of a blank 'was'", () => {
		render(
			<RescheduledNote
				audience="buyer"
				rescheduledAt={Date.now()}
				fromDate={undefined}
				fromTimeMinutes={undefined}
				storeName="IndoMart"
			/>,
		);
		expect(document.body.textContent).toContain("it had no date before");
	});

	it("the seller is told WHEN, not who — they may not be the one who moved it", () => {
		render(
			<RescheduledNote
				audience="seller"
				rescheduledAt={Date.now() - 3 * 60 * 60_000}
				fromDate={MON}
				fromTimeMinutes={15 * 60}
				storeName="IndoMart"
			/>,
		);
		const text = document.body.textContent ?? "";
		expect(text).toContain("You moved this");
		expect(text).toContain("3h ago");
	});

	it("renders nothing when the order was never moved", () => {
		const { container } = render(
			<RescheduledNote
				audience="buyer"
				rescheduledAt={undefined}
				fromDate={MON}
				fromTimeMinutes={15 * 60}
				storeName="IndoMart"
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});
