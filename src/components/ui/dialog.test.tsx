// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";

afterEach(cleanup);

function open(className?: string) {
	render(
		<Dialog open onOpenChange={() => {}}>
			<DialogContent className={className}>
				<DialogHeader>
					<DialogTitle>Cancel this order?</DialogTitle>
					<DialogDescription>This can't be undone.</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<button type="button">Confirm</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>,
	);
	return screen.getByRole("dialog");
}

/**
 * jsdom has no layout, so these assert the CLASS CONTRACT rather than measured
 * boxes. That is the right unit here: the bug was a class combination, not a
 * miscalculation. A dialog is centred with `-translate-y-1/2`, so content taller
 * than the viewport overflows at BOTH ends; with the y-axis hidden and no cap
 * it is clipped instead of scrolled and DialogFooter's buttons go out of reach
 * with nothing to scroll back. Measured on a real 375x667 viewport before the
 * fix: a 1457px dialog spanning -395 to 1062, confirm button at 1006, off
 * screen and failing a hit test. After: capped at 635, scrollable, button
 * reachable and hittable.
 */
describe("DialogContent — it must never clip its own footer", () => {
	it("caps its height and scrolls that axis", () => {
		const cls = open().className;
		// The cap and the scroll travel together — either alone is the bug.
		expect(cls).toMatch(/\bmax-h-\[/);
		expect(cls).toMatch(/\boverflow-y-auto\b/);
	});

	it("keeps the x-axis hidden, which is what rounds the full-bleed footer", () => {
		const cls = open().className;
		expect(cls).toMatch(/\boverflow-x-hidden\b/);
		// Bare `overflow-hidden` is the regression: it hides BOTH axes, so the
		// y-cap can no longer scroll and the footer becomes unreachable again.
		expect(cls).not.toMatch(/\boverflow-hidden\b/);
	});

	it("still lets a caller take the padding away", () => {
		// whats-new.tsx passes `gap-0 p-0` to go full-bleed. The scroll lives on
		// this same element rather than an inner wrapper precisely so that
		// override keeps landing where the caller expects it.
		const cls = open("gap-0 p-0").className;
		expect(cls).toMatch(/\bp-0\b/);
		expect(cls).not.toMatch(/\bp-4\b/);
		expect(cls).toMatch(/\bgap-0\b/);
		expect(cls).not.toMatch(/\bgap-4\b/);
		// …and the height/overflow contract survives that override.
		expect(cls).toMatch(/\bmax-h-\[/);
		expect(cls).toMatch(/\boverflow-y-auto\b/);
	});

	it("renders the footer's actions inside the dialog, where a scroll can reach them", () => {
		const dialog = open();
		const confirm = screen.getByRole("button", { name: "Confirm" });
		expect(dialog.contains(confirm)).toBe(true);
		expect(confirm.closest('[data-slot="dialog-footer"]')).toBeTruthy();
	});
});
