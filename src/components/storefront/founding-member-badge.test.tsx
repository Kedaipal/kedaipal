// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoundingMemberBadge } from "./founding-member-badge";

afterEach(cleanup);

describe("FoundingMemberBadge", () => {
	it("shows the rank when provided", () => {
		render(<FoundingMemberBadge rank={3} />);
		expect(screen.getByText("Founding Member #3")).toBeTruthy();
	});

	it("omits the rank suffix when absent", () => {
		render(<FoundingMemberBadge />);
		const el = screen.getByText("Founding Member");
		expect(el.textContent).toBe("Founding Member");
	});

	it("renders both badge artwork variants (navy for light, mint for dark)", () => {
		const { container } = render(<FoundingMemberBadge rank={1} />);
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).toContain("/img/badges/founding-badge-navy.png");
		expect(srcs).toContain("/img/badges/founding-badge-mint.png");
	});

	it("keeps the default (off-cover) label dark on the light header", () => {
		const { container } = render(<FoundingMemberBadge rank={2} />);
		const span = container.querySelector("span");
		expect(span?.className).toContain("text-foreground");
		expect(span?.className).not.toContain("text-white");
	});

	it("on a cover image, uses the light-on-scrim treatment (white label, mint emblem only)", () => {
		const { container } = render(<FoundingMemberBadge rank={4} onCover />);
		// Label flips to white + drop-shadow so it matches the store name/blurb
		// and can't wash out on a dark cover.
		const span = container.querySelector("span");
		expect(span?.className).toContain("text-white");
		expect(span?.className).toContain("drop-shadow");
		expect(span?.className).not.toContain("text-foreground");
		// Only the mint emblem renders (reads on the dark scrim regardless of
		// theme); the theme-driven navy variant is gone so it can't show through.
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).toEqual(["/img/badges/founding-badge-mint.png"]);
		expect(srcs).not.toContain("/img/badges/founding-badge-navy.png");
		// Label + rank still carry the meaning for screen readers.
		expect(screen.getByText("Founding Member #4")).toBeTruthy();
	});

	it("marks the artwork decorative so the visible label carries meaning", () => {
		const { container } = render(<FoundingMemberBadge rank={1} />);
		for (const img of container.querySelectorAll("img")) {
			expect(img.getAttribute("alt")).toBe("");
			expect(img.getAttribute("aria-hidden")).toBe("true");
		}
		// Screen readers still get "Founding Member #1" from the text node.
		expect(screen.getByText("Founding Member #1")).toBeTruthy();
	});
});
