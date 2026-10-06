// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	ENTERPRISE_FROM_ORDERS,
	LISTED_PLANS,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
} from "../../../convex/lib/plans";
import { PricingTeaser } from "./pricing-teaser";

/**
 * The landing pricing teaser after the credits release (Credits T5,
 * z8r3fdfu31) and Enterprise (T6, z8r3fdkp8h): the Starter and Pro cards open
 * on their monthly credits, the sub says every plan includes an order
 * allowance, the taglines match `/pricing`, and the third card is Enterprise —
 * "Custom", no number, a "Talk to Arif" WhatsApp link where the others have a
 * sign-up, and its unbuilt rows carry "Soon" instead of reading as included.
 */

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ isSignedIn: false }),
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
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

describe("PricingTeaser — credits, and Enterprise by conversation", () => {
	it("says every plan includes a monthly order allowance, and states the real trial", () => {
		render(<PricingTeaser />);
		expect(text()).toContain("Every plan includes a monthly order allowance");
		expect(text()).toContain("14 days or 200 orders, whichever comes first");
	});

	it("opens every listed card on its credits, from PLAN_CREDIT_GRANT", () => {
		render(<PricingTeaser />);
		for (const plan of LISTED_PLANS) {
			expect(text()).toContain(
				`${PLAN_CREDIT_GRANT[plan]} credits a month — 1 per order`,
			);
		}
		// Enterprise's credits are per contract — no number to print.
		expect(text()).toContain("Credits sized to your volume");
	});

	it("carries the taglines, Enterprise's threshold read from the constant", () => {
		render(<PricingTeaser />);
		expect(screen.getByText("Take orders on WhatsApp")).toBeTruthy();
		expect(screen.getByText("Orders and payments")).toBeTruthy();
		expect(
			screen.getByText(
				`Built for ${ENTERPRISE_FROM_ORDERS.toLocaleString("en")}+ orders a month`,
			),
		).toBeTruthy();
	});

	it("prices Enterprise as Custom and sends it to a chat with Arif, not a sign-up", () => {
		render(<PricingTeaser />);
		expect(screen.getByText("Custom")).toBeTruthy();
		expect(screen.queryByText(/Coming soon/i)).toBeNull();
		// Starter and Pro sign up; Enterprise talks.
		expect(
			screen.getAllByRole("link", { name: /Start free — pay when you sell/ }),
		).toHaveLength(2);
		const talk = screen.getByRole("link", { name: /Talk to Arif/ });
		const href = talk.getAttribute("href") ?? "";
		expect(href).toContain("wa.me/60123456789");
		expect(decodeURIComponent(href)).toContain("Kedaipal Enterprise");
		expect(talk.getAttribute("target")).toBe("_blank");
	});

	it("marks Enterprise's unbuilt rows Soon, and its team row unlimited", () => {
		render(<PricingTeaser />);
		const outlets = screen.getByText("Multiple outlets").closest("li");
		const broadcast = screen
			.getByText("Broadcast to customer list")
			.closest("li");
		expect(outlets?.textContent).toContain("Soon");
		expect(broadcast?.textContent).toContain("Soon");
		expect(
			screen.getByText("Unlimited teammates").closest("li")?.textContent,
		).not.toContain("Soon");
	});

	it("says who's on the team the way /pricing does", () => {
		render(<PricingTeaser />);
		expect(screen.getByText("Just you")).toBeTruthy();
		expect(screen.getByText("You + 2 teammates")).toBeTruthy();
		expect(screen.getByText("Unlimited teammates")).toBeTruthy();
		expect(text()).not.toMatch(/\b\d users?\b/);
	});

	it("switches every price to S$ for Singapore, with no ringgit left", () => {
		render(<PricingTeaser />);
		fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
		for (const plan of LISTED_PLANS) {
			expect(text()).toContain(`S$ ${PLAN_MONTHLY_PRICES.SGD[plan] / 100}`);
		}
		expect(text()).not.toMatch(/RM\s?\d/);
		// Enterprise has no price in either currency.
		expect(screen.getByText("Custom")).toBeTruthy();
	});
});
