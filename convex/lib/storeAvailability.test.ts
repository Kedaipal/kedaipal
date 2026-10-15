import { describe, expect, it } from "vitest";
import {
	cleanAvailabilityNote,
	counterClosedMessage,
	resolveStoreAvailability,
	STORE_PAUSE_NOTE_MAX,
	takesBuyerOrders,
	takesCounterOrders,
	unavailableMessage,
} from "./storeAvailability";

/**
 * The store-availability rules (`z8r3fdudf7`): one precedence, two doors.
 * Every pair is pinned, because the order is what makes "lifting one switch
 * reveals the next" true rather than "lifting one switch reopens the store".
 */

const HOLD = 1;
const seller = { sellerPausedAt: 2, sellerPauseNote: "Back on 1 Nov" };

describe("resolveStoreAvailability — precedence", () => {
	it("nothing switched off is open", () => {
		expect(resolveStoreAvailability({})).toEqual({ state: "open" });
		expect(resolveStoreAvailability({ row: null })).toEqual({ state: "open" });
	});

	it("admin offline > admin paused > hold > seller paused", () => {
		expect(
			resolveStoreAvailability({
				holdPausedAt: HOLD,
				row: { ...seller, adminMode: "offline", adminNote: "x" },
			}),
		).toEqual({ state: "offline", by: "admin", note: "x" });
		expect(
			resolveStoreAvailability({
				holdPausedAt: HOLD,
				row: { ...seller, adminMode: "paused" },
			}),
		).toMatchObject({ state: "paused", by: "admin" });
		expect(
			resolveStoreAvailability({ holdPausedAt: HOLD, row: seller }),
		).toEqual({ state: "paused", by: "hold" });
		expect(resolveStoreAvailability({ row: seller })).toEqual({
			state: "paused",
			by: "seller",
			note: "Back on 1 Nov",
		});
	});
});

describe("the two doors", () => {
	const at = (row: Parameters<typeof resolveStoreAvailability>[0]) =>
		resolveStoreAvailability(row);

	it("a seller's own pause closes the storefront but not the counter", () => {
		const a = at({ row: seller });
		expect(takesBuyerOrders(a)).toBe(false);
		expect(takesCounterOrders(a)).toBe(true);
	});

	it("a hold and every Kedaipal switch close the counter too", () => {
		for (const a of [
			at({ holdPausedAt: HOLD }),
			at({ row: { adminMode: "paused" } }),
			at({ row: { adminMode: "offline" } }),
		]) {
			expect(takesBuyerOrders(a)).toBe(false);
			expect(takesCounterOrders(a)).toBe(false);
		}
	});
});

describe("unavailableMessage — what a refused buyer reads", () => {
	it("Kedaipal's switch is neutral: no note, no reason, never 'suspended'", () => {
		const paused = unavailableMessage(
			{ state: "paused", by: "admin", note: "Unpaid invoice" },
			"Corks Out",
		);
		const offline = unavailableMessage(
			{ state: "offline", by: "admin", note: "Unpaid invoice" },
			"Corks Out",
		);
		for (const m of [paused, offline]) {
			expect(m).not.toMatch(/unpaid|suspend|invoice/i);
		}
		expect(offline).toBe("Corks Out isn't available right now.");
		expect(paused).toMatch(/isn't taking orders right now/);
	});

	it("the seller's note reaches their buyers; a hold keeps its seasonal wording", () => {
		expect(
			unavailableMessage({ state: "paused", by: "seller", note: "Back on 1 Nov" }, "Kek"),
		).toBe("Kek isn't taking orders right now — Back on 1 Nov");
		expect(unavailableMessage({ state: "paused", by: "hold" }, "Kek")).toMatch(
			/seasonal break/,
		);
	});
});

describe("counterClosedMessage — the SELLER's sentence at a closed till", () => {
	it("is empty while the counter is open, the seller's own pause included", () => {
		expect(counterClosedMessage({ state: "open" })).toBe("");
		expect(
			counterClosedMessage({ state: "paused", by: "seller", note: "Back soon" }),
		).toBe("");
	});

	it("names who closed it and the one way back — never buyer copy", () => {
		const admin = counterClosedMessage({ state: "paused", by: "admin" });
		expect(admin).toMatch(/^Kedaipal has paused ordering at your store/);
		expect(admin).toMatch(/Message us/);
		expect(
			counterClosedMessage({ state: "offline", by: "admin" }),
		).toMatch(/^Kedaipal has taken your store offline/);
		expect(counterClosedMessage({ state: "paused", by: "hold" })).toMatch(
			/Off-Season Hold.*Billing/,
		);
		for (const a of [
			{ state: "paused", by: "admin" },
			{ state: "offline", by: "admin" },
			{ state: "paused", by: "hold" },
		] as const)
			expect(counterClosedMessage(a)).not.toMatch(/Browse the menu|check back/);
	});

	it("never repeats Kedaipal's private note to the seller's till either", () => {
		expect(
			counterClosedMessage({ state: "paused", by: "admin", note: "Unpaid" }),
		).not.toMatch(/Unpaid/);
	});
});

it("cleanAvailabilityNote trims, collapses, caps and treats blank as none", () => {
	expect(cleanAvailabilityNote("  Back   soon ")).toBe("Back soon");
	expect(cleanAvailabilityNote("   ")).toBeUndefined();
	expect(cleanAvailabilityNote("x".repeat(500))).toHaveLength(
		STORE_PAUSE_NOTE_MAX,
	);
});
