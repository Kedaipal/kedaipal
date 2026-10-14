// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

function open(className?: string) {
	render(
		<DropdownMenu open>
			<DropdownMenuTrigger>Manage</DropdownMenuTrigger>
			<DropdownMenuContent className={className}>
				<DropdownMenuItem>Open store</DropdownMenuItem>
				<DropdownMenuItem>Delete store</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>,
	);
	return screen.getByRole("menu");
}

/**
 * Sibling of `dialog.test.tsx`, for the same bug one primitive over.
 *
 * jsdom has no layout, so these assert the CLASS CONTRACT rather than measured
 * boxes — the right unit here, because the bug was a class combination and not
 * a miscalculation. A dropdown is anchored to its trigger, so a menu taller
 * than the space below it gets slid upward by Radix's collision handling until
 * its first items sit above the viewport; with no cap and a bare
 * `overflow-hidden` hiding BOTH axes, there was nothing to scroll back to.
 *
 * Reported on the admin Sellers "Manage" menu, whose seven described items
 * overflow a laptop window: "Open store" — the first item, and the one an admin
 * reaches for most — was off the top edge and unreachable by any input.
 */
describe("DropdownMenuContent — a tall menu scrolls instead of clipping", () => {
	it("caps its height to the space Radix measured, and scrolls that axis", () => {
		const cls = open().className;
		// The cap and the scroll travel together — either alone is the bug.
		expect(cls).toMatch(
			/\bmax-h-\(--radix-dropdown-menu-content-available-height\)/,
		);
		expect(cls).toMatch(/\boverflow-y-auto\b/);
	});

	it("keeps the x-axis hidden, which is what clips the rounded corners", () => {
		const cls = open().className;
		expect(cls).toMatch(/\boverflow-x-hidden\b/);
		// Bare `overflow-hidden` is the regression: it hides BOTH axes, so the
		// y-cap can no longer scroll and the top items go out of reach again.
		expect(cls).not.toMatch(/\boverflow-hidden\b/);
	});

	it("still lets a caller set its own width", () => {
		// seller-manage-menu.tsx passes `w-72`. The scroll lives on this same
		// element rather than an inner wrapper, so a caller override has to keep
		// landing here without taking the height contract with it.
		const cls = open("w-72").className;
		expect(cls).toMatch(/\bw-72\b/);
		expect(cls).toMatch(
			/\bmax-h-\(--radix-dropdown-menu-content-available-height\)/,
		);
		expect(cls).toMatch(/\boverflow-y-auto\b/);
	});

	it("renders its items inside the menu, where a scroll can reach them", () => {
		const menu = open();
		const first = screen.getByRole("menuitem", { name: "Open store" });
		expect(menu.contains(first)).toBe(true);
	});
});
