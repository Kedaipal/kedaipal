// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoundingMemberBadge } from "./founding-member-badge";

afterEach(cleanup);

describe("FoundingMemberBadge", () => {
	it("is a labelled button — the emblem alone must still say what it is", () => {
		render(<FoundingMemberBadge rank={3} />);
		expect(
			screen.getByRole("button", { name: "Founding Member #3 — what's this?" }),
		).toBeTruthy();
	});

	it("omits the rank from the label when absent", () => {
		render(<FoundingMemberBadge />);
		expect(
			screen.getByRole("button", { name: "Founding Member — what's this?" }),
		).toBeTruthy();
	});

	it("tap opens the provenance popover — title, and who issued it", () => {
		render(<FoundingMemberBadge rank={7} />);
		fireEvent.click(screen.getByRole("button"));
		expect(screen.getByText("Founding Member #7")).toBeTruthy();
		expect(
			screen.getByText(
				"One of Kedaipal's first sellers. This badge is issued by Kedaipal, not self-declared.",
			),
		).toBeTruthy();
	});

	it("renders both badge artwork variants (navy for light, mint for dark)", () => {
		const { container } = render(<FoundingMemberBadge rank={1} />);
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).toContain("/img/badges/founding-badge-navy.png");
		expect(srcs).toContain("/img/badges/founding-badge-mint.png");
	});

	it("on a cover image, renders only the mint emblem (reads on the dark scrim regardless of theme)", () => {
		const { container } = render(<FoundingMemberBadge rank={4} onCover />);
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).toEqual(["/img/badges/founding-badge-mint.png"]);
		// The button's label still carries the meaning for screen readers.
		expect(
			screen.getByRole("button", { name: "Founding Member #4 — what's this?" }),
		).toBeTruthy();
	});

	it("marks the artwork decorative so the button label carries the meaning", () => {
		const { container } = render(<FoundingMemberBadge rank={1} />);
		for (const img of container.querySelectorAll("img")) {
			expect(img.getAttribute("alt")).toBe("");
			expect(img.getAttribute("aria-hidden")).toBe("true");
		}
	});

	it("shrinks the emblem to 18px in the app bar via size='sm'", () => {
		const { container } = render(<FoundingMemberBadge rank={2} size="sm" />);
		const img = container.querySelector("img");
		expect(img?.className).toContain("h-[18px]");
	});
});
