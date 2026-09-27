// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { StorefrontHeader, storeInitials } from "./storefront-header";

afterEach(cleanup);

const retailer = {
	storeName: "Dapur Nadia",
	storeDescription: "Kuih & pastry pre-order",
};

describe("StorefrontHeader", () => {
	// The full hero renders ONLY on the store home since z8r3fdegb5 (subpages
	// carry the compact StorefrontAppBar), and the home is *about* the store —
	// so the store name is unconditionally the page's <h1>.
	it("makes the store name the page <h1>", () => {
		render(<StorefrontHeader retailer={retailer} />);
		const heading = screen.getByRole("heading", { level: 1 });
		expect(heading.textContent).toBe("Dapur Nadia");
	});

	it("falls back to the generic tagline when the seller has no blurb", () => {
		render(<StorefrontHeader retailer={{ storeName: "Lekor Mr Ganu" }} />);
		expect(screen.getByText("Browse & order on WhatsApp")).toBeTruthy();
	});

	it("renders an initials tile when the store has no logo — never a hole", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.getByText("DN")).toBeTruthy();
	});

	it("offers Share store only when it has the slug to share", () => {
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		expect(
			screen.getByRole("button", { name: /share store/i }),
		).toBeTruthy();
		cleanup();
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.queryByRole("button", { name: /share store/i })).toBeNull();
	});

	it("carries no Kedaipal mark — the footer owns 'Powered by'", () => {
		const { container } = render(<StorefrontHeader retailer={retailer} />);
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).not.toContain("/logo-3.svg");
		expect(srcs).not.toContain("/logo-dark.svg");
	});
});

describe("storeInitials", () => {
	it("takes the first letters of the first two words", () => {
		expect(storeInitials("Kek Sayang Bakery")).toBe("KS");
	});

	it("takes two characters of a single-word name", () => {
		expect(storeInitials("Hermoolah")).toBe("HE");
	});

	it("survives an empty name", () => {
		expect(storeInitials("  ")).toBe("");
	});
});

describe("StorefrontHeader — opening hours line (86eyp5rav)", () => {
	// An all-day week keeps the assertion clock-independent: whatever minute
	// the test runs at, the status is "Open 24 hours today".
	const allDayWeek = Array.from({ length: 7 }, () => ({
		open: 0,
		close: 1439,
	}));

	it("renders the live status line when the store configured hours", () => {
		render(
			<StorefrontHeader retailer={{ ...retailer, openingHours: allDayWeek }} />,
		);
		expect(screen.getByText("Open 24 hours today")).toBeTruthy();
	});

	it("renders nothing for the 24/7 default (no configured hours)", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.queryByText(/Open 24 hours|Closed ·|Open now/)).toBeNull();
	});
});

describe("StorefrontHeader — closed dates (z8r3fdhpm7)", () => {
	// Clock-independent: every range is built from the real "today".
	const today = todayMytMidnight(Date.now());

	it("on a closed date, a 24/7 store says so — with the reason and when it reopens", () => {
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [
						{ startDate: today, endDate: today, label: "Hari Raya" },
					],
				}}
			/>,
		);
		expect(
			screen.getByText("Closed today · Hari Raya · reopens tomorrow"),
		).toBeTruthy();
	});

	it("warns about a closure starting within two weeks, before the buyer picks a date", () => {
		const start = today + 3 * DAY_MS;
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [
						{
							startDate: start,
							endDate: start + DAY_MS,
							label: "Balik kampung",
						},
					],
				}}
			/>,
		);
		expect(screen.getByText(/^Closed .* · Balik kampung$/)).toBeTruthy();
	});

	it("stays silent for a 24/7 store whose only closure is far off", () => {
		const start = today + 40 * DAY_MS;
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [{ startDate: start, endDate: start }],
				}}
			/>,
		);
		expect(screen.queryByText(/Closed/)).toBeNull();
	});

	it("the schedule dialog never shows today's weekly hours as open on a closed date", () => {
		const allDayWeek = Array.from({ length: 7 }, () => ({
			open: 0,
			close: 1439,
		}));
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					openingHours: allDayWeek,
					closedDates: [
						{ startDate: today, endDate: today, label: "Hari Raya" },
					],
				}}
			/>,
		);
		const trigger = screen.getByRole("button", { name: /Closed today/ });
		// A wrapped status stays left-aligned beside its icon (a <button>
		// centres by default).
		expect(trigger.className).toContain("text-left");
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog");
		const todayRow = within(dialog)
			.getByText(/· Today/)
			.closest("li");
		expect(todayRow?.textContent).toContain("Closed today");
		expect(within(dialog).getByText("Closed dates")).toBeTruthy();
	});
});
