// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DAY_MS, MYT_OFFSET_MS } from "../../../convex/lib/fulfilmentDate";
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

	it("shows the variant label and the line total", () => {
		line({ variantLabel: "Riverside", lineTotal: 16000 });
		expect(screen.getByText("Riverside")).toBeTruthy();
		expect(screen.getByText("RM 160.00")).toBeTruthy();
	});
});
