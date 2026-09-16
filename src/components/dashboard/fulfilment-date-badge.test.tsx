import { describe, expect, it } from "vitest";
import { MYT_OFFSET_MS } from "../../../convex/lib/fulfilmentDate";
import { fulfilmentBadgeLabel } from "./fulfilment-date-badge";

// "Now" is Thu 17 Sep 2026, 10:00 MYT.
const TODAY = Date.UTC(2026, 8, 17) - MYT_OFFSET_MS;
const NOW = TODAY + 10 * 3600_000;
const DAY = 86_400_000;

const label = (over: Partial<Parameters<typeof fulfilmentBadgeLabel>[0]>) =>
	fulfilmentBadgeLabel({
		epoch: TODAY,
		now: NOW,
		size: "sm",
		muted: false,
		...over,
	}).label;

describe("fulfilmentBadgeLabel — the inbox card carries the time (z8r3fdff97)", () => {
	it("today and tomorrow name the TIME, since the word already names the day", () => {
		expect(label({ timeMinutes: 15 * 60 + 30 })).toBe("Today · 3:30 PM");
		expect(label({ epoch: TODAY + DAY, timeMinutes: 9 * 60 })).toBe(
			"Tomorrow · 9:00 AM",
		);
	});

	it("further out, it's the date AND the time", () => {
		const out = label({ epoch: TODAY + 4 * DAY, timeMinutes: 11 * 60 });
		expect(out).toMatch(/21 Sep/);
		expect(out).toMatch(/11:00 AM$/);
	});

	it("no time on the order: unchanged, date-only", () => {
		expect(label({})).toMatch(/^Today · /);
		expect(label({})).not.toMatch(/AM|PM/);
	});

	it("OVERDUE stays date-only — once late, the day is what matters", () => {
		const out = label({ epoch: TODAY - DAY, timeMinutes: 9 * 60 });
		expect(out).toMatch(/^Overdue · /);
		expect(out).not.toMatch(/AM|PM/);
	});

	it("MUTED (done or collected) stays date-only — the moment is history", () => {
		expect(label({ muted: true, timeMinutes: 9 * 60 })).not.toMatch(/AM|PM/);
	});

	it("the detail page's badge ignores the time — it renders its own span beside it", () => {
		expect(label({ size: "md", timeMinutes: 9 * 60 })).not.toMatch(/AM|PM/);
	});
});
