// @vitest-environment jsdom
/**
 * The seller's approve card speaks the listing's own vocabulary (z8r3fdhpm7,
 * found in the Chrome test). It said "Check-in / Check-out / 7 nights" for
 * every package — a gym month, a 4-open-day course — while the order summary
 * under it said the true thing, so the seller approved one booking reading two
 * different ones.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { DAY_MS, MYT_OFFSET_MS } from "../../../convex/lib/fulfilmentDate";
import { BookingRequestCard } from "./booking-request-card";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const SAT_3_OCT = Date.UTC(2026, 9, 3) - MYT_OFFSET_MS;
const d = (n: number) => SAT_3_OCT + n * DAY_MS;

function renderCard(
	order: Partial<Parameters<typeof BookingRequestCard>[0]["order"]>,
) {
	render(
		<BookingRequestCard
			order={{
				_id: "ord_1" as Id<"orders">,
				shortId: "ORD-3LDT",
				createdAt: Date.now(),
				total: 25000,
				securityDeposit: 5000,
				currency: "MYR",
				items: [{ name: "Campsite 2" }],
				bookingContext: { capacityPerNight: 3, peakOtherBookings: 0 },
				...order,
			}}
		/>,
	);
}

describe("BookingRequestCard", () => {
	it("an open-days package: starts / last day / open days, and what it skips", () => {
		renderCard({
			bookingCheckIn: d(0),
			bookingCheckOut: d(7), // Sat 3 → Fri 9 is the last day
			bookingPackaged: true,
			bookingSkippedDays: [d(1), d(3), d(4)],
		});
		expect(screen.getByText("Starts")).toBeTruthy();
		expect(screen.getByText("Last day")).toBeTruthy();
		expect(screen.getByText("Fri, 9 Oct 2026")).toBeTruthy();
		expect(screen.queryByText("Sat, 10 Oct 2026")).toBeNull();
		expect(screen.getByText("Campsite 2 · 4 open days")).toBeTruthy();
		expect(
			screen.getByText("Skips Sun 4 Oct, Tue 6 Oct, Wed 7 Oct (store closed)"),
		).toBeTruthy();
		expect(
			screen.getByText(/No other bookings on those days \(capacity 3\)/),
		).toBeTruthy();
	});

	it("a stay keeps check-in / check-out and nights", () => {
		renderCard({ bookingCheckIn: d(0), bookingCheckOut: d(2) });
		expect(screen.getByText("Check-in")).toBeTruthy();
		expect(screen.getByText("Check-out")).toBeTruthy();
		expect(screen.getByText("Mon, 5 Oct 2026")).toBeTruthy();
		expect(screen.getByText("Campsite 2 · 2 nights")).toBeTruthy();
		expect(screen.getByText(/on those nights/)).toBeTruthy();
	});
});
