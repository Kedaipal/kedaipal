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
