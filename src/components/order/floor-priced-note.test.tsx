// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FloorPricedNote,
	floorPricedLine,
	pricedAtFloor,
} from "./floor-priced-note";

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

/** The seller's order says when the one-kilo floor priced it (23 Oct 2026). */
describe("pricedAtFloor", () => {
	it("is a Delyva-won live quote that was floored, and nothing else", () => {
		expect(pricedAtFloor(floored)).toBe(true);
		expect(pricedAtFloor({ ...floored, quoteProvider: "lalamove" })).toBe(
			false,
		);
		expect(pricedAtFloor({ ...floored, weightFloored: undefined })).toBe(false);
		expect(pricedAtFloor({ ...floored, mode: "weight" })).toBe(false);
		expect(pricedAtFloor(undefined)).toBe(false);
	});
});

describe("floorPricedLine", () => {
	it("counts the items a product weight would have priced, and blames the seller's side", () => {
		expect(floorPricedLine(floored)).toBe(
			"Priced at the 1 kg floor — 2 items had no weight. A heavier parcel costs you the difference when you book.",
		);
		expect(floorPricedLine({ ...floored, unweighedLines: 1 })).toContain(
			"1 item had no weight",
		);
	});

	it("a custom line floored it: nothing to set, so no blame and no link", () => {
		expect(floorPricedLine({ ...floored, unweighedLines: 0 })).toContain(
			"a custom item has no fixed weight",
		);
		render(<FloorPricedNote snapshot={{ ...floored, unweighedLines: 0 }} />);
		expect(screen.queryByRole("link")).toBeNull();
	});
});

describe("FloorPricedNote", () => {
	it("links the bulk fill when there are weights to set", () => {
		render(<FloorPricedNote snapshot={floored} />);
		expect(
			screen
				.getByRole("link", { name: /set parcel weights/i })
				.getAttribute("href"),
		).toBe("/app/products/weights");
	});
});
