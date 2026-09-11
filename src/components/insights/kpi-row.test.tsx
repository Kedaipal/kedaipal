// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { formatPriceCompact } from "../../lib/format";
import { DEPOSIT_EXCLUSION_HINT, KpiRow } from "./kpi-row";

afterEach(cleanup);

// `formatPriceCompact` joins symbol and amount with a non-breaking space;
// testing-library's default normalizer collapses it to a plain space in the
// DOM text, so the expected copy is normalized the same way.
const shown = (s: string) => s.replace(/\u00a0/g, " ");

// RM210 earned of which RM160 collected — distinct from every other tile value
// so `getByText` on a price can only ever hit one tile.
const base = {
	earned: 21_000,
	collected: 16_000,
	orderCount: 2,
	aov: 10_500,
	currency: "MYR",
};

describe("KpiRow — Revenue earned sub-label (z8r3fdcw70)", () => {
	test("no deposits in the window: the status range, and no mention of deposits", () => {
		render(<KpiRow {...base} depositsHeld={0} />);
		expect(screen.getByText("confirmed → delivered")).toBeTruthy();
		expect(screen.queryByText(/security deposit/i)).toBeNull();
		expect(screen.queryByTitle(DEPOSIT_EXCLUSION_HINT)).toBeNull();
	});

	test("deposits in the window: the excluded amount in store currency, the reason on hover", () => {
		render(<KpiRow {...base} depositsHeld={10_000} />);
		const sub = screen.getByText(
			shown(`excl. ${formatPriceCompact(10_000, "MYR")} security deposits`),
		);
		expect(sub.getAttribute("title")).toBe(DEPOSIT_EXCLUSION_HINT);
		expect(screen.queryByText("confirmed → delivered")).toBeNull();
		// The headline stays the deposit-net figure it was handed, not the gross.
		expect(
			screen.getByText(shown(formatPriceCompact(21_000, "MYR"))),
		).toBeTruthy();
	});

	test("an SG store states the amount in its own currency", () => {
		render(<KpiRow {...base} currency="SGD" depositsHeld={5_000} />);
		expect(
			screen.getByText(
				shown(`excl. ${formatPriceCompact(5_000, "SGD")} security deposits`),
			),
		).toBeTruthy();
	});

	test("a large deposit total compacts like the tiles do", () => {
		// RM 12,400.50 → whole ringgit in a tight slot; the sub-label follows the
		// same rule as the value above it so the two never disagree on format.
		render(<KpiRow {...base} depositsHeld={1_240_050} />);
		expect(
			screen.getByText(
				shown(
					`excl. ${formatPriceCompact(1_240_050, "MYR")} security deposits`,
				),
			),
		).toBeTruthy();
	});
});
