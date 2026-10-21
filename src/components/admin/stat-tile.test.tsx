// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatTile, type StatTileTone } from "./stat-tile";

afterEach(cleanup);

function renderTile(tone: StatTileTone) {
	render(
		<StatTile
			label="Pending"
			value="1"
			helper="Invoices to settle"
			icon={<svg data-testid="icon" />}
			tone={tone}
		/>,
	);
	const well = screen.getByTestId("icon").parentElement as HTMLElement;
	const tile = well.parentElement as HTMLElement;
	return { well, tile };
}

describe("StatTile", () => {
	it("renders label, value and helper", () => {
		renderTile("info");
		expect(screen.getByText("Pending")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("Invoices to settle")).toBeTruthy();
	});

	// z8r3fdwf9t: the well was `bg-white/70` with no dark pair — a near-white
	// disc behind a pale icon on a dark tile. It must tint from the tile's ink.
	it.each<StatTileTone>([
		"neutral",
		"info",
		"warn",
		"success",
		"danger",
	])("the %s icon well is white in light and the tile's own ink in dark", (tone) => {
		const { well } = renderTile(tone);
		expect(well.className).toContain("bg-white/70");
		expect(well.className).toContain("dark:bg-current/15");
	});

	it("danger reads in red with a dark pair, not the faint destructive token", () => {
		const { tile } = renderTile("danger");
		expect(tile.className).toContain("text-red-800");
		expect(tile.className).toContain("dark:text-red-200");
		expect(tile.className).not.toContain("text-destructive");
	});
});
