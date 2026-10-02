// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
} from "../../../convex/lib/plans";
import { PricingTeaser } from "./pricing-teaser";

/**
 * The landing pricing teaser after the credits release (Credits T5,
 * z8r3fdfu31): every card opens on its monthly credits, the sub says every
 * plan includes an order allowance, the taglines match `/pricing`, and Scale —
 * purchasable since z8r3fdfuhq — has a real CTA while its unbuilt rows carry
 * "Soon" instead of reading as included.
 */

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ isSignedIn: false }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
// The region is a real piece of state here so the MY/SG toggle drives it.
vi.mock("../../hooks/useLandingRegion", async () => {
	const { useState } = await import("react");
	return {
		useLandingRegionContext: () => useState<"MY" | "SG">("MY"),
	};
});
// Embla measures a real layout jsdom doesn't have; the rail's behaviour isn't
// under test.
vi.mock("embla-carousel-react", () => ({ default: () => [() => {}] }));
// The price roll's EXIT animation never completes in jsdom, which would leave
// the outgoing "RM 79" in the DOM after a switch to SG. Reduced motion is a
// real path the component supports (no exit animation), so take it.
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useReducedMotion: () => true };
});

beforeAll(() => {
	class NeverInView {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	}
	globalThis.IntersectionObserver ??= NeverInView as never;
});

afterEach(cleanup);

/** Rendered text, NBSP-flattened. */
const text = () => (document.body.textContent ?? "").replace(/ /g, " ");

describe("PricingTeaser — credits and a purchasable Scale", () => {
	it("says every plan includes a monthly order allowance, and states the real trial", () => {
		render(<PricingTeaser />);
		expect(text()).toContain("Every plan includes a monthly order allowance");
		expect(text()).toContain("14 days or 200 orders, whichever comes first");
	});

	it("opens every card on its credits, from PLAN_CREDIT_GRANT", () => {
		render(<PricingTeaser />);
		for (const credits of Object.values(PLAN_CREDIT_GRANT)) {
			expect(text()).toContain(`${credits} credits a month — 1 per order`);
		}
	});

	it("carries the new taglines, Scale's number read from the grant", () => {
		render(<PricingTeaser />);
		expect(screen.getByText("Take orders on WhatsApp")).toBeTruthy();
		expect(screen.getByText("Orders and payments")).toBeTruthy();
		expect(
			screen.getByText(
				`High-volume kitchens: ${PLAN_CREDIT_GRANT.scale} orders a month`,
			),
		).toBeTruthy();
	});

	it("gives Scale a live CTA — no Coming soon anywhere — and marks its unbuilt rows Soon", () => {
		render(<PricingTeaser />);
		expect(screen.queryByText(/Coming soon/i)).toBeNull();
		expect(
			screen.getAllByRole("link", { name: /Start free — pay when you sell/ }),
		).toHaveLength(3);
		const outlets = screen.getByText("Up to 3 outlets").closest("li");
		const broadcast = screen
			.getByText("Broadcast to customer list")
			.closest("li");
		expect(outlets?.textContent).toContain("Soon");
		expect(broadcast?.textContent).toContain("Soon");
	});

	it("says who's on the team the way /pricing does", () => {
		render(<PricingTeaser />);
		expect(screen.getByText("Just you")).toBeTruthy();
		expect(screen.getByText("You + 2 teammates")).toBeTruthy();
		expect(screen.getByText("You + 5 teammates")).toBeTruthy();
		expect(text()).not.toMatch(/\b\d users?\b/);
	});

	it("switches every price to S$ for Singapore, with no ringgit left", () => {
		render(<PricingTeaser />);
		fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
		for (const plan of ["starter", "pro", "scale"] as const) {
			expect(text()).toContain(`S$ ${PLAN_MONTHLY_PRICES.SGD[plan] / 100}`);
		}
		expect(text()).not.toMatch(/RM\s?\d/);
	});
});
