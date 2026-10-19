// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import { RealSellers } from "./real-sellers";

/**
 * Truth fixes 8 and 9 (z8r3fdhj8p): five seller cards — the five kinds in
 * the demo video — under a heading that promised five, and no founder-facing
 * metrics ("Ad spend RM 0" means nothing to a seller). The rail renders its
 * cards twice for the loop; the clone is hidden from assistive tech and from
 * crawlable text.
 */

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useReducedMotion: () => true };
});

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

describe("RealSellers", () => {
	beforeEach(() => vi.stubGlobal("IntersectionObserver", NeverInViewObserver));
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("shows the five kinds from the demo video, once each plus one hidden clone", () => {
		const { container } = render(<RealSellers />);
		const groups = container.querySelectorAll("[data-testid=seller-cards]");
		expect(groups).toHaveLength(2);
		expect(groups[0].querySelectorAll("article")).toHaveLength(5);
		expect(groups[1].getAttribute("aria-hidden")).toBe("true");
		const text = groups[0].textContent ?? "";
		for (const kind of [
			m.proof_kind_5(),
			m.proof_kind_10(),
			m.proof_kind_12(),
			m.proof_kind_7(),
			m.proof_kind_8(),
		]) {
			expect(text).toContain(kind);
		}
	});

	it("carries no founder metrics", () => {
		const { container } = render(<RealSellers />);
		expect(container.textContent).not.toMatch(
			/Ad spend|RM 0\b|Meta verification/,
		);
	});
});
