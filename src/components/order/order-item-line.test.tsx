// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DAY_MS, MYT_OFFSET_MS } from "../../../convex/lib/fulfilmentDate";
import {
	WEEKDAY_NIGHTS_LABEL,
	weekendNightsLabel,
} from "../../../convex/lib/productKind";
import { OrderItemLine } from "./order-item-line";

afterEach(cleanup);

const D0 = Date.UTC(2026, 7, 31) - MYT_OFFSET_MS; // 31 Aug 2026, MYT midnight
const day = (n: number) => D0 + n * DAY_MS;

function line(props: Partial<Parameters<typeof OrderItemLine>[0]> = {}) {
	return render(
		<ul>
			<OrderItemLine
				name="Campsite"
				quantity={2}
				unitPrice={8000}
				lineTotal={16000}
				currency="MYR"
				{...props}
			/>
		</ul>,
	);
}

describe("OrderItemLine", () => {
	it("keeps 'N × price' for an ordinary product line", () => {
		line({ name: "Kuih lapis" });
		expect(screen.getByText(/2 × RM\s?160\.00|2 × RM\s?80\.00/)).toBeTruthy();
	});

	it("reads a stay as NIGHTS with its dates, never as a quantity", () => {
		// The reported bug: a 2-night stay rendered "2 × RM 80.00", which reads
		// as two campsites. `quantity` is the night count by design (bookings
		// ride the standard money math) — so the DISPLAY has to say so.
		line({ booking: { checkIn: day(0), checkOut: day(2), packaged: false } });
		const detail = screen.getByText(/2 nights/);
		expect(detail).toBeTruthy();
		expect(detail.textContent).toContain("31 Aug");
		expect(detail.textContent).toContain("2 Sep");
		// The bare quantity form must be gone.
		expect(screen.queryByText(/^2 × /)).toBeNull();
	});

	it("singularises a one-night stay", () => {
		line({
			quantity: 1,
			lineTotal: 8000,
			booking: { checkIn: day(0), checkOut: day(1), packaged: false },
		});
		expect(screen.getByText(/1 night ×/)).toBeTruthy();
		expect(screen.queryByText(/1 nights/)).toBeNull();
	});

	it("states a package as its validity window, with no nightly rate", () => {
		// A month package is ONE flat price for a window — quoting "30 nights ×
		// RM 450" would invent a per-night rate the seller never set.
		line({
			quantity: 1,
			unitPrice: 45000,
			lineTotal: 45000,
			booking: { checkIn: day(0), checkOut: day(30), packaged: true },
		});
		const detail = screen.getByText(/Valid/);
		expect(detail.textContent).toContain("31 Aug");
		// Ends on the LAST USABLE day, not the exclusive check-out.
		expect(detail.textContent).toContain("29 Sep");
		expect(detail.textContent).not.toContain("×");
	});

	it("names the kind of night on a split stay, without repeating the label (S13)", () => {
		// Thu 10 → Mon 14 Sep: the weekend line charges 2 of the 4 nights.
		const thu = Date.UTC(2026, 8, 10) - MYT_OFFSET_MS;
		line({
			variantLabel: weekendNightsLabel([5, 6]),
			quantity: 2,
			unitPrice: 12_000,
			lineTotal: 24_000,
			booking: {
				checkIn: thu,
				checkOut: thu + 4 * DAY_MS,
				packaged: false,
				weekendDays: [5, 6],
			},
		});
		const detail = screen.getByText(/2 weekend nights ×/);
		expect(detail.textContent).toMatch(/RM\s?120\.00/);
		// The frozen label is what the sub-line just said — not printed twice.
		expect(screen.queryByText("Weekend nights (Fri & Sat)")).toBeNull();
	});

	it("a split line names ITS OWN nights, never the whole stay (S13)", () => {
		// The reported confusion: both lines of a Thu→Sat stay printed
		// "17 Sep → 19 Sep", so each looked priced for the entire stay and
		// neither said which night cost more.
		const thu = Date.UTC(2026, 8, 17) - MYT_OFFSET_MS;
		const span = { checkIn: thu, checkOut: thu + 2 * DAY_MS, packaged: false };
		const { unmount } = line({
			variantLabel: WEEKDAY_NIGHTS_LABEL,
			quantity: 1,
			unitPrice: 4000,
			lineTotal: 4000,
			booking: { ...span, weekendDays: [5, 6] },
		});
		// Thursday night only — not the Friday the weekend line charges for.
		expect(screen.getByText(/1 weekday night ×/).textContent).toContain(
			"Thu 17 Sep",
		);
		expect(screen.queryByText(/Sat 19 Sep/)).toBeNull();
		unmount();

		line({
			variantLabel: weekendNightsLabel([5, 6]),
			quantity: 1,
			unitPrice: 5000,
			lineTotal: 5000,
			booking: { ...span, weekendDays: [5, 6] },
		});
		expect(screen.getByText(/1 weekend night ×/).textContent).toContain(
			"Fri 18 Sep",
		);
	});

	it("lists a weekday line's non-contiguous nights", () => {
		// Thu 17 → Mon 21: weekday nights are the Thursday AND the Sunday, so
		// no single range could describe this line.
		const thu = Date.UTC(2026, 8, 17) - MYT_OFFSET_MS;
		line({
			variantLabel: WEEKDAY_NIGHTS_LABEL,
			quantity: 2,
			unitPrice: 4000,
			lineTotal: 8000,
			booking: {
				checkIn: thu,
				checkOut: thu + 4 * DAY_MS,
				packaged: false,
				weekendDays: [5, 6],
			},
		});
		const detail = screen.getByText(/2 weekday nights ×/).textContent ?? "";
		expect(detail).toContain("Thu 17 Sep");
		expect(detail).toContain("Sun 20 Sep");
	});

	it("falls back to the stay span on a pre-S13 booking with no frozen night set", () => {
		const thu = Date.UTC(2026, 8, 17) - MYT_OFFSET_MS;
		line({
			variantLabel: WEEKDAY_NIGHTS_LABEL,
			quantity: 1,
			unitPrice: 4000,
			lineTotal: 4000,
			// weekendDays absent — the split can't be located, so the line still
			// says something true rather than nothing.
			booking: { checkIn: thu, checkOut: thu + 2 * DAY_MS, packaged: false },
		});
		const detail = screen.getByText(/1 weekday night ×/).textContent ?? "";
		expect(detail).toContain("17 Sep");
		expect(detail).toContain("19 Sep");
	});

	it("singularises a one-night weekday line", () => {
		line({
			variantLabel: WEEKDAY_NIGHTS_LABEL,
			quantity: 1,
			lineTotal: 8000,
			booking: { checkIn: day(0), checkOut: day(3), packaged: false },
		});
		expect(screen.getByText(/1 weekday night ×/)).toBeTruthy();
		expect(screen.queryByText("Weekday nights")).toBeNull();
	});

	it("an ordinary variant label on a booking line still shows beside the name", () => {
		line({
			variantLabel: "Riverside",
			booking: { checkIn: day(0), checkOut: day(2), packaged: false },
		});
		expect(screen.getByText("Riverside")).toBeTruthy();
		expect(screen.getByText(/2 nights ×/)).toBeTruthy();
	});

	it("shows the variant label and the line total", () => {
		line({ variantLabel: "Riverside", lineTotal: 16000 });
		expect(screen.getByText("Riverside")).toBeTruthy();
		expect(screen.getByText("RM 160.00")).toBeTruthy();
	});
});
