// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AllProductsDivider } from "./product-grid";

afterEach(cleanup);

/**
 * The divider's *conditional* behaviour is pure CSS (`peer-[:not(:empty)]`
 * against the merchandising wrapper), and jsdom has no Tailwind stylesheet or
 * layout engine — asserting `display` here would assert nothing. That part is
 * verified in-browser across all four states (rail+shelf / rail-only /
 * shelf-only / neither); see docs/storefront-landing.md.
 *
 * What IS worth pinning is the class itself: it's load-bearing and invisible,
 * so a well-meaning refactor could drop it and only a human on a quiet store
 * would notice the category tiles sitting on the product grid again.
 */
describe("AllProductsDivider", () => {
	it("labels the grid", () => {
		render(<AllProductsDivider />);
		expect(screen.getByText("All products")).toBeTruthy();
	});

	it("stays hidden unless the preceding merchandising wrapper is non-empty", () => {
		const { container } = render(<AllProductsDivider />);
		const cls = container.firstElementChild?.className ?? "";
		// Hidden by default, revealed only by the peer-empty check.
		expect(cls).toContain("hidden");
		expect(cls).toContain("peer-[:not(:empty)]:flex");
	});

	it("is decorative — the label is a visual rule, not a heading", () => {
		const { container } = render(<AllProductsDivider />);
		expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});
});
