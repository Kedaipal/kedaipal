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

	it("uses the mint accent tokens (Midnight Mint theme, not amber)", () => {
		render(<FoundingMemberBadge rank={1} />);
		const el = screen.getByText("Founding Member #1");
		expect(el.className).toMatch(/bg-accent/);
		expect(el.className).toMatch(/text-accent-foreground/);
		expect(el.className).not.toMatch(/amber/);
	});
});
