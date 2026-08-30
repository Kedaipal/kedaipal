// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductDescription } from "./product-page";

// jsdom has no ResizeObserver (the clamp re-measures with one on reflow).
class RO {
	observe() {}
	unobserve() {}
	disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

/**
 * jsdom has no layout, so `scrollHeight`/`clientHeight` are both 0 and the
 * clamp would never trigger on its own. Stubbing them is what makes the
 * overflow path testable at all — the alternative is asserting nothing and
 * leaving the toggle to manual checking.
 */
function stubOverflow(overflowing: boolean) {
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get() {
			// A collapsed, overflowing element reports more content than it shows.
			return this.classList.contains("line-clamp-3") && overflowing ? 200 : 60;
		},
	});
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 60,
	});
}

afterEach(() => {
	cleanup();
	// @ts-expect-error — restore jsdom's own zero-height getters.
	delete HTMLElement.prototype.scrollHeight;
	// @ts-expect-error — same.
	delete HTMLElement.prototype.clientHeight;
});

describe("ProductDescription", () => {
	it("renders the seller's copy", () => {
		stubOverflow(false);
		render(<ProductDescription text="Kek batik, no nuts. 2 days notice." />);
		expect(screen.getByText("Kek batik, no nuts. 2 days notice.")).toBeTruthy();
	});

	it("shows no toggle when the copy already fits", () => {
		stubOverflow(false);
		render(<ProductDescription text="Short and sweet." />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("offers Read more when the copy overflows the clamp", () => {
		stubOverflow(true);
		render(<ProductDescription text={"Ingredients. ".repeat(60)} />);
		expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
	});

	// The subtle one: expanded, scrollHeight === clientHeight, so a naive
	// re-measure decides the text no longer overflows and rips "Show less" out
	// from under the reader — stranding them in expanded state with no way back.
	it("keeps the toggle after expanding, and collapses again", () => {
		stubOverflow(true);
		const { container } = render(
			<ProductDescription text={"Ingredients. ".repeat(60)} />,
		);
		const clamped = () => !!container.querySelector(".line-clamp-3");
		expect(clamped()).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Read more" }));
		const showLess = screen.getByRole("button", { name: "Show less" });
		expect(showLess.getAttribute("aria-expanded")).toBe("true");
		expect(clamped()).toBe(false);

		fireEvent.click(showLess);
		expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
		expect(clamped()).toBe(true);
	});
});
