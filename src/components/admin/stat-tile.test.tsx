// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	StatTile,
	StatTileGrid,
	type StatTileProps,
	type StatTileTone,
} from "./stat-tile";

afterEach(cleanup);

function renderTile(tone: StatTileTone, value: StatTileProps["value"] = "1") {
	render(
		<StatTile
			label="Pending"
			value={value}
			helper="Invoices to settle"
			icon={<svg data-testid="icon" />}
			tone={tone}
		/>,
	);
	const well = screen.getByTestId("icon").parentElement as HTMLElement;
	const tile = well.closest('[class*="@container"]') as HTMLElement;
	return { well, tile };
}

const tile = (label: string): StatTileProps => ({
	label,
	value: "1",
	helper: "h",
	icon: null,
	tone: "neutral",
});

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
		"progress",
	])("the %s icon well is white in light and the tile's own ink in dark", (tone) => {
		const { well } = renderTile(tone);
		expect(well.className).toContain("bg-white/70");
		expect(well.className).toContain("dark:bg-current/15");
	});

	it("danger reads in red with a dark pair, not the faint destructive token", () => {
		const { tile } = renderTile("danger");
		expect(tile.className).toContain("text-red-800");
		expect(tile.className).toContain("dark:text-red-100");
		expect(tile.className).not.toContain("text-destructive");
	});

	it("dark fills are the house half-strength panel, never a full -950 slab", () => {
		for (const tone of [
			"info",
			"warn",
			"success",
			"danger",
			"progress",
		] as const) {
			const { tile } = renderTile(tone);
			expect(tile.className).toMatch(/dark:bg-\w+-950\/50/);
			expect(tile.className).not.toMatch(/dark:bg-\w+-950(?!\/)/);
			cleanup();
		}
	});

	// At 70% the 11px helper measured 3.6–4.1:1 on the tinted light tiles.
	it("label and helper sit at 85% ink, not 70%", () => {
		renderTile("info");
		expect(screen.getByText("Pending").className).toContain("opacity-85");
		expect(screen.getByText("Invoices to settle").className).toContain(
			"opacity-85",
		);
	});

	// On a 375px phone the tile is 160px: "RM 149.00" used to truncate to
	// "RM 149.…". The figure is never cut off.
	it("never truncates the figure; several amounts stay whole and wrap at the +", () => {
		const { tile } = renderTile("info", ["RM 149.00", "S$ 29.00"]);
		const figure = tile.querySelectorAll("p")[1];
		expect(figure.className).not.toContain("truncate");
		expect(figure.textContent).toBe("RM 149.00 + S$ 29.00");
		const pieces = [...figure.querySelectorAll("span.whitespace-nowrap")].map(
			(s) => s.textContent,
		);
		expect(pieces).toEqual(["RM 149.00", "S$ 29.00"]);
	});

	it("lays out by the tile's own width — stacked when narrow, side by side when wide", () => {
		const { tile } = renderTile("info");
		const row = tile.firstElementChild as HTMLElement;
		expect(row.className).toContain("flex-col");
		expect(row.className).toContain("@[10rem]:flex-row");
	});
});

describe("StatTileGrid", () => {
	const cellsOf = (container: HTMLElement) =>
		[...(container.firstElementChild as HTMLElement).children] as HTMLElement[];

	it("four tiles: four columns on desktop, no spanning", () => {
		const { container } = render(
			<StatTileGrid tiles={["a", "b", "c", "d"].map(tile)} />,
		);
		const grid = container.firstElementChild as HTMLElement;
		expect(grid.className).toContain("lg:grid-cols-4");
		for (const cell of cellsOf(container))
			expect(cell.className).not.toContain("col-span-2");
	});

	// Three tiles in a four-column row left an empty slot on desktop, and an
	// odd tile sat beside nothing on a phone's two-up grid.
	it("three tiles: three columns on desktop, and the odd last spans the phone row", () => {
		const { container } = render(
			<StatTileGrid tiles={["a", "b", "c"].map(tile)} />,
		);
		const grid = container.firstElementChild as HTMLElement;
		expect(grid.className).toContain("lg:grid-cols-3");
		const cells = cellsOf(container);
		expect(cells[2].className).toContain("col-span-2");
		expect(cells[2].className).toContain("lg:col-span-1");
		expect(cells[0].className).not.toContain("col-span-2");
	});
});
