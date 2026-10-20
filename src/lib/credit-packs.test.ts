import { describe, expect, it } from "vitest";
import { CREDIT_PACKS } from "../../convex/lib/plans";
import {
	afterTopUpLine,
	opensLine,
	packOffers,
	wholePrice,
} from "./credit-packs";

describe("packOffers — what each pack is worth, side by side", () => {
	it("MYR: the 200 pack is the better value and says what it saves against 4 × 50", () => {
		const [small, big] = packOffers(CREDIT_PACKS.MYR);
		expect(small).toMatchObject({
			credits: 50,
			perCreditMinor: 90, // RM 45 / 50
			bestValue: false,
			saving: null,
		});
		expect(big).toMatchObject({
			credits: 200,
			perCreditMinor: 80, // RM 160 / 200
			bestValue: true,
			// 4 × RM 45 = RM 180, the 200 pack is RM 160.
			saving: { minor: 2000, versus: { count: 4, credits: 50 } },
		});
	});

	it("SGD: a fractional per-credit price rounds to the cent, the saving doesn't", () => {
		const [small, big] = packOffers(CREDIT_PACKS.SGD);
		expect(small.perCreditMinor).toBe(44); // S$ 22 / 50
		expect(big.perCreditMinor).toBe(38); // S$ 75 / 200 = 37.5
		// 4 × S$ 22 = S$ 88, the 200 pack is S$ 75.
		expect(big.saving).toEqual({
			minor: 1300,
			versus: { count: 4, credits: 50 },
		});
		expect(big.bestValue).toBe(true);
	});

	it("packs that cost the same per credit claim no best value and no saving", () => {
		const offers = packOffers([
			{ id: "a", credits: 50, priceMinor: 5000, currency: "MYR" },
			{ id: "b", credits: 100, priceMinor: 10000, currency: "MYR" },
		]);
		expect(offers.every((o) => !o.bestValue && o.saving === null)).toBe(true);
	});

	it("credits that don't divide evenly still show the saving, without a count", () => {
		const [, odd] = packOffers([
			{ id: "a", credits: 50, priceMinor: 5000, currency: "MYR" },
			{ id: "b", credits: 120, priceMinor: 10000, currency: "MYR" },
		]);
		expect(odd.saving).toEqual({ minor: 2000, versus: null });
	});

	it("one pack: nothing to compare", () => {
		const [only] = packOffers([
			{ id: "a", credits: 50, priceMinor: 4500, currency: "MYR" },
		]);
		expect(only).toMatchObject({ bestValue: false, saving: null });
	});
});

describe("wholePrice — the way /pricing quotes a price", () => {
	it("drops cents only when there are none", () => {
		expect(wholePrice(2200, "SGD")).toBe(wholePrice(2200, "SGD").trim());
		expect(wholePrice(2200, "SGD")).toMatch(/22$/);
		expect(wholePrice(2200, "SGD")).not.toMatch(/\.00/);
		expect(wholePrice(38, "SGD")).toMatch(/0\.38$/);
		expect(wholePrice(16000, "MYR")).toMatch(/^RM\s?160$/);
	});
});

describe("afterTopUpLine — the result of the tap, before the tap", () => {
	it("adds to what's left", () => {
		expect(afterTopUpLine(10, 50)).toBe("After this top-up: 60 orders left.");
		expect(afterTopUpLine(0, 50)).toBe("After this top-up: 50 orders left.");
	});

	it("pays a debt first, and says so", () => {
		expect(afterTopUpLine(-15, 50)).toBe(
			"Covers the 15 owed and leaves 35 orders.",
		);
		expect(afterTopUpLine(-49, 50)).toBe(
			"Covers the 49 owed and leaves 1 order.",
		);
		expect(afterTopUpLine(-50, 50)).toBe("Covers the 50 owed exactly.");
		expect(afterTopUpLine(-80, 50)).toBe(
			"Covers 50 of the 80 owed — 30 still owed after it.",
		);
	});
});

describe("opensLine — what the pack OPENS, before the tap (Credits T3.1)", () => {
	it("a pack that covers the queue opens all of it", () => {
		expect(opensLine(3, 50)).toBe(
			"That opens all 3 orders waiting on credits.",
		);
		expect(opensLine(3, 3)).toBe("That opens all 3 orders waiting on credits.");
		expect(opensLine(1, 50)).toBe("That opens the order waiting on credits.");
	});

	it("a pack smaller than the queue can never over-promise", () => {
		// Each credit frees exactly one order, oldest first — so the sentence is
		// arithmetic, not optimism. This is the half the old copy got wrong:
		// "your store unlocks as soon as it's paid" was a promise a 50-pack
		// against 80 waiting orders could not keep.
		expect(opensLine(80, 50)).toBe(
			"That opens the 50 orders that have waited longest — 30 orders would still be waiting.",
		);
		// One credit reads as "the oldest order", never "the 1 order that have
		// waited longest".
		expect(opensLine(2, 1)).toBe(
			"That opens the oldest order — 1 order would still be waiting.",
		);
	});

	// PR #347 review, 9 Oct 2026. The queue advances by POSITION and a
	// cancelled order keeps the position its debit claimed, so a credit landing
	// on a dead position opens nothing. `min(waiting, credits)` therefore
	// over-promised by exactly the number of dead positions in front.
	describe("positions held by cancelled orders", () => {
		it("THE regression: 4 live behind 2 cancelled, a 4-pack opens 2", () => {
			// Offsets 3,4,5,6 — positions 1 and 2 are cancelled orders that still
			// owe their credits. Before the fix this read "opens all 4 orders".
			const line = opensLine(4, 4, [3, 4, 5, 6]);
			expect(line).toContain(
				"That opens the 2 orders that have waited longest",
			);
			expect(line).toContain("2 orders would still be waiting");
			expect(line).not.toContain("all 4");
		});

		it("a pack that can't reach the oldest says how far short it falls", () => {
			// Verified on dev (10 Oct): a cancelled gated order's refund moves
			// the watermark the single position that order held, so positions
			// and debt stay in lockstep and no credit is ever wasted — paying
			// exactly the debt always clears the live queue. So the line names
			// the SHORTFALL; an earlier draft blamed "orders you cancelled",
			// which read as a wasted credit and was not true.
			expect(opensLine(1, 2, [3])).toBe(
				"That doesn't open an order yet — the one waiting needs 3 credits.",
			);
			expect(opensLine(1, 1, [2])).toBe(
				"That doesn't open an order yet — the one waiting needs 2 credits.",
			);
		});

		it("never blames a cancellation for a credit that paid down real debt", () => {
			for (const line of [
				opensLine(4, 4, [3, 4, 5, 6]),
				opensLine(1, 2, [3]),
				opensLine(4, 6, [3, 4, 5, 6]),
			])
				expect(line).not.toMatch(/you cancelled/);
		});

		it("a pack big enough still opens everything", () => {
			expect(opensLine(4, 6, [3, 4, 5, 6])).toBe(
				"That opens all 4 orders waiting on credits.",
			);
		});

		it("an unbroken queue is word-for-word what it always was", () => {
			// The ordinary store has no cancelled gated orders, and its copy must
			// not change: offsets [1..n] and the no-offsets call agree exactly.
			for (const [waiting, credits] of [
				[3, 50],
				[3, 3],
				[1, 50],
				[80, 50],
				[2, 1],
			] as const) {
				const unbroken = Array.from({ length: waiting }, (_, i) => i + 1);
				expect(opensLine(waiting, credits, unbroken)).toBe(
					opensLine(waiting, credits),
				);
			}
		});
	});
});
