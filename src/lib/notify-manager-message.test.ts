import { describe, expect, it } from "vitest";
import { MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import { buildNotifyManagerMessage } from "./notify-manager-message";

const THU_SEP_18 = Date.UTC(2026, 8, 18) - MYT_OFFSET_MS;

const base = {
	shortId: "ORD-7Q2K",
	location: {
		label: "Huff & Puff Cafe",
		address: "Jln SS2/24, Petaling Jaya",
	},
	customerName: "Aisyah",
	customerWaPhone: "60123456789",
	items: [{ name: "Ice Cream Puff", quantity: 2, price: 1200 }],
	total: 2400,
	currency: "MYR",
};

describe("buildNotifyManagerMessage", () => {
	it("tells the manager WHEN, right under the header", () => {
		const lines = buildNotifyManagerMessage({
			...base,
			fulfilmentDate: THU_SEP_18,
			fulfilmentTimeMinutes: 11 * 60 + 30,
		}).split("\n");
		expect(lines[0]).toBe("📦 New pickup order ORD-7Q2K — Huff & Puff Cafe");
		expect(lines[1]).toMatch(/^Collect on: .*18 Sep.*11:30 AM$/);
	});

	it("a date with no time still says the day", () => {
		const lines = buildNotifyManagerMessage({
			...base,
			fulfilmentDate: THU_SEP_18,
		}).split("\n");
		expect(lines[1]).toMatch(/^Collect on: .*18 Sep/);
		expect(lines[1]).not.toMatch(/AM|PM/);
	});

	it("a drop-off point is a meet-up, not a collection", () => {
		const out = buildNotifyManagerMessage({
			...base,
			location: { ...base.location, locationType: "drop_off" as const },
			fulfilmentDate: THU_SEP_18,
		});
		expect(out).toContain("Meet on:");
		expect(out).not.toContain("Collect on:");
	});

	it("an order with no date simply has no When line — nothing else moves", () => {
		const lines = buildNotifyManagerMessage(base).split("\n");
		expect(lines[1]).toMatch(/^Customer: Aisyah /);
	});

	it("does not forward the buyer's pickup notes — they're addressed to the buyer", () => {
		const out = buildNotifyManagerMessage({
			...base,
			fulfilmentDate: THU_SEP_18,
		});
		expect(out).not.toContain("Before you collect");
		expect(out).toContain("Please prepare for collection.");
	});
});

describe("event RSVPs speak guest language (`z8r3fdff9u`)", () => {
	it("names the event, the whole range and the guest — and never says collection", () => {
		const out = buildNotifyManagerMessage({
			...base,
			fulfilmentDate: THU_SEP_18,
			fulfilmentTimeMinutes: 8 * 60,
			event: { name: "BNI Breakfast", endDate: THU_SEP_18 + 2 * 86_400_000 },
		});
		const lines = out.split("\n");
		expect(lines[0]).toBe("🎟️ New RSVP ORD-7Q2K — BNI Breakfast");
		expect(lines[1]).toMatch(/^Event: Fri, 18 Sep 2026 · 8:00 AM to Sun, 20 Sep 2026 at /);
		expect(lines[2]).toMatch(/^Guest: /);
		expect(out).toContain("Please add them to the guest list.");
		expect(out).not.toContain("prepare for collection");
		expect(out).not.toContain("Collect on");
	});
});
