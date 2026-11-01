// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	pricedWithoutWeight,
	WeightGapNote,
	weightGapLine,
} from "./weight-gap-note";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, ...props }: Record<string, unknown> & { to?: string }) => (
		<a href={to} {...props} />
	),
}));

afterEach(cleanup);

const floored = {
	fee: 475,
	mode: "live" as const,
	quoteProvider: "delyva" as const,
	weightFloored: true,
	unweighedLines: 2,
};

/** A heavier cart: the weighed lines passed a kilo, so the floor never fired,
 * and the unweighed ones priced at nothing (PR #416 review). */
const heavyWithGaps = {
	fee: 950,
	mode: "live" as const,
	quoteProvider: "delyva" as const,
	unweighedLines: 5,
};

/** The seller's order says when the courier priced it without part of the
 * weight (23 Oct 2026; widened to heavy carts by the PR #416 review). */
describe("pricedWithoutWeight", () => {
	it("is a Delyva-won live quote that was floored OR had unweighed lines", () => {
		expect(pricedWithoutWeight(floored)).toBe(true);
		expect(pricedWithoutWeight(heavyWithGaps)).toBe(true);
		// Floored by a custom line alone: still a gap, nothing to set.
		expect(pricedWithoutWeight({ ...floored, unweighedLines: 0 })).toBe(true);
	});

	it("is nothing else", () => {
		expect(pricedWithoutWeight({ ...floored, quoteProvider: "lalamove" })).toBe(
			false,
		);
		expect(pricedWithoutWeight({ ...floored, mode: "weight" })).toBe(false);
		expect(pricedWithoutWeight({ ...heavyWithGaps, unweighedLines: 0 })).toBe(
			false,
		);
		expect(pricedWithoutWeight(undefined)).toBe(false);
	});
});

describe("weightGapLine", () => {
	it("a floored cart counts the items a product weight would have priced", () => {
		expect(weightGapLine(floored)).toBe(
			"Priced at the 1 kg floor at checkout — 2 items had no weight then. A heavier parcel costs you the difference when you book.",
		);
		expect(weightGapLine({ ...floored, unweighedLines: 1 })).toContain(
			"1 item had no weight then",
		);
	});

	it("a heavier cart says the unweighed items were priced without their weight", () => {
		expect(weightGapLine(heavyWithGaps)).toBe(
			"5 items had no weight at checkout and were priced without it. A heavier parcel costs you the difference when you book.",
		);
		expect(weightGapLine({ ...heavyWithGaps, unweighedLines: 1 })).toBe(
			"1 item had no weight at checkout and was priced without it. A heavier parcel costs you the difference when you book.",
		);
	});

	it("a custom line floored it: nothing to set, so no blame and no link", () => {
		expect(weightGapLine({ ...floored, unweighedLines: 0 })).toContain(
			"a custom item has no fixed weight",
		);
		render(<WeightGapNote snapshot={{ ...floored, unweighedLines: 0 }} />);
		expect(screen.queryByRole("link")).toBeNull();
	});
});

describe("WeightGapNote", () => {
	it("links the bulk fill when there are weights to set — floored or not", () => {
		render(<WeightGapNote snapshot={heavyWithGaps} />);
		expect(
			screen
				.getByRole("link", { name: /set parcel weights/i })
				.getAttribute("href"),
		).toBe("/app/products/weights");
	});
});
