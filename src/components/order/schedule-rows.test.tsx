// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRow } from "../../../convex/lib/scheduleRows";
import {
	dayHeading,
	groupByDate,
	isPastRow,
	ScheduleRows,
	scheduleChips,
	scheduleNotes,
} from "./schedule-rows";

// The Link mock serialises where it goes, so a test can assert the inbox
// handoff — the whole point of a row — not just that something is a link.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		search,
		children,
		className,
	}: {
		to: string;
		params?: { productId: string };
		search?: Record<string, unknown>;
		children: ReactNode;
		className?: string;
	}) => (
		<a
			href={`${params ? to.replace("$productId", params.productId) : to}${
				search
					? `?${new URLSearchParams(search as Record<string, string>)}`
					: ""
			}`}
			className={className}
		>
			{children}
		</a>
	),
}));

afterEach(cleanup);

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-10T00:00:00+08:00");

function row(over: Partial<ScheduleRow> = {}): ScheduleRow {
	const base: ScheduleRow = {
		key: "k",
		productId: "p_lunch",
		name: "Luncheon",
		kind: "event",
		date: TODAY + 3 * DAY,
		timeMinutes: 12 * 60,
		seats: 30,
		registered: 14,
		orders: 12,
		paid: 11,
		claimed: 1,
		unpaid: 2,
		awaitingApproval: 0,
		free: 0,
		waitingOnCredits: 0,
	};
	const merged = { ...base, ...over };
	return { ...merged, key: `${merged.date}:${merged.productId}` };
}

const labels = (r: ScheduleRow) => scheduleChips(r).map((c) => c.label);

describe("scheduleChips — the counts, in the order a seller reads them", () => {
	it("an event reads seats against its cap, then the payment split", () => {
		expect(labels(row())).toEqual([
			"30 seats",
			"14 registered",
			"11 paid",
			"1 claimed",
			"2 unpaid",
		]);
	});

	it("an uncapped event says so — never '0 left'", () => {
		expect(labels(row({ seats: undefined }))[0]).toBe("No seat cap");
	});

	it("a full event says Full — and the count isn't printed twice", () => {
		expect(
			labels(row({ registered: 30, paid: 30, claimed: 0, unpaid: 0 })),
		).toEqual(["Full · 30 seats", "30 registered", "30 paid"]);
	});

	it("'0 paid' shows, because that is the alarm; zero claimed/unpaid don't", () => {
		expect(
			labels(row({ registered: 3, paid: 0, claimed: 0, unpaid: 3 })),
		).toEqual(["30 seats", "3 registered", "0 paid", "3 unpaid"]);
		expect(
			labels(row({ registered: 4, paid: 4, claimed: 0, unpaid: 0 })),
		).toEqual(["30 seats", "4 registered", "4 paid"]);
	});

	it("a booking counts bookings and has no seat chip", () => {
		expect(
			labels(
				row({
					kind: "booking",
					seats: undefined,
					registered: 1,
					paid: 1,
					claimed: 0,
					unpaid: 0,
				}),
			),
		).toEqual(["1 booking", "1 paid"]);
	});

	it("a free event says Free, not '0 paid'", () => {
		expect(
			labels(row({ registered: 5, paid: 0, claimed: 0, unpaid: 0, free: 5 })),
		).toEqual(["30 seats", "5 registered", "Free"]);
	});

	it("a nobody-yet event shows its cap and zero, with no payment chips", () => {
		expect(
			labels(row({ registered: 0, orders: 0, paid: 0, claimed: 0, unpaid: 0 })),
		).toEqual(["30 seats", "0 registered"]);
	});
});

describe("scheduleNotes — what the chips can't carry", () => {
	it("explains unapproved requests and credit-gated orders in place", () => {
		expect(
			scheduleNotes(row({ awaitingApproval: 2, waitingOnCredits: 1 })),
		).toEqual([
			"2 seats awaiting your approval — no payment asked yet",
			"1 seat waiting on credits — top up to open",
		]);
	});

	it("is silent on an ordinary row", () => {
		expect(scheduleNotes(row())).toEqual([]);
	});
});

describe("grouping and time", () => {
	it("groups consecutive rows by date", () => {
		const a = row({ productId: "a" });
		const b = row({ productId: "b" });
		const c = row({ productId: "c", date: TODAY + 5 * DAY });
		expect(groupByDate([a, b, c]).map((d) => d.rows.length)).toEqual([2, 1]);
	});

	it("a two-day seminar is upcoming until its LAST day has passed", () => {
		const seminar = row({ date: TODAY - DAY, endDate: TODAY });
		expect(isPastRow(seminar, TODAY)).toBe(false);
		expect(isPastRow(seminar, TODAY + DAY)).toBe(true);
		expect(isPastRow(row({ date: TODAY - DAY }), TODAY)).toBe(true);
	});

	it("leads with Today / Tomorrow", () => {
		expect(dayHeading(TODAY, TODAY)).toBe("Today · Tue, 10 Nov");
		expect(dayHeading(TODAY + DAY, TODAY)).toBe("Tomorrow · Wed, 11 Nov");
		expect(dayHeading(TODAY + 3 * DAY, TODAY)).toBe("Fri, 13 Nov");
	});

	it("a running multi-day event's start day reads On now — but not in the past section", () => {
		expect(dayHeading(TODAY - DAY, TODAY)).toBe("On now · started Mon, 9 Nov");
		expect(dayHeading(TODAY - DAY, TODAY, true)).toBe("Mon, 9 Nov");
	});
});

describe("ScheduleRows", () => {
	it("each row opens the inbox narrowed to exactly its listing and date", () => {
		render(<ScheduleRows rows={[row()]} todayMyt={TODAY} canSeeHeadcount />);
		const [mobileLink] = screen.getAllByRole("link", {
			name: /Open 12 orders/,
		});
		const href = mobileLink.getAttribute("href") ?? "";
		expect(href.startsWith("/app/orders?")).toBe(true);
		const q = new URLSearchParams(href.split("?")[1]);
		expect(q.get("listing")).toBe("p_lunch");
		expect(q.get("ffrom")).toBe(String(TODAY + 3 * DAY));
		expect(q.get("fto")).toBe(String(TODAY + 3 * DAY));
	});

	it("an event offers its headcount; a booking doesn't have one", () => {
		render(
			<ScheduleRows
				rows={[
					row(),
					row({ kind: "booking", productId: "p_studio", name: "Studio" }),
				]}
				todayMyt={TODAY}
				canSeeHeadcount
			/>,
		);
		const headcounts = screen.getAllByRole("link", { name: /Headcount/ });
		// Once in the mobile cards, once in the desktop table — both the event.
		expect(headcounts).toHaveLength(2);
		for (const h of headcounts)
			expect(h.getAttribute("href")).toBe("/app/products/p_lunch");
	});

	it("hides Headcount from a teammate who can't open products", () => {
		render(
			<ScheduleRows rows={[row()]} todayMyt={TODAY} canSeeHeadcount={false} />,
		);
		expect(screen.queryByRole("link", { name: /Headcount/ })).toBeNull();
	});

	it("a row with nobody registered offers no dead 'Open 0 orders'", () => {
		render(
			<ScheduleRows
				rows={[
					row({ registered: 0, orders: 0, paid: 0, claimed: 0, unpaid: 0 }),
				]}
				todayMyt={TODAY}
				canSeeHeadcount
			/>,
		);
		expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
		expect(screen.getAllByText("No one registered yet").length).toBeGreaterThan(
			0,
		);
	});

	it("a row whose only orders wait on credits says there's nothing to open yet", () => {
		render(
			<ScheduleRows
				rows={[
					row({
						registered: 1,
						orders: 0,
						paid: 0,
						claimed: 0,
						unpaid: 0,
						waitingOnCredits: 1,
					}),
				]}
				todayMyt={TODAY}
				canSeeHeadcount
			/>,
		);
		expect(screen.getAllByText("Nothing to open yet").length).toBeGreaterThan(
			0,
		);
	});

	it("prints each date once, with every listing on it underneath", () => {
		render(
			<ScheduleRows
				rows={[row(), row({ productId: "p_talk", name: "Evening talk" })]}
				todayMyt={TODAY}
				canSeeHeadcount
			/>,
		);
		const headings = screen.getAllByRole("heading", { name: "Fri, 13 Nov" });
		expect(headings).toHaveLength(1);
		const section = headings[0].closest("section");
		if (!section) throw new Error("no section");
		expect(within(section).getByText("Luncheon")).toBeTruthy();
		expect(within(section).getByText("Evening talk")).toBeTruthy();
	});
});
