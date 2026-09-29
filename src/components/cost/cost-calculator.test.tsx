// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CostCalculator } from "./cost-calculator";

/**
 * The region hook needs a router (it reads the root loader's data off router
 * state), so it's stubbed with real `useState` — the `RegionToggle` rendered
 * inside the calculator then drives it exactly as it does in the app, which is
 * the point: these tests exercise the region SWITCH, not the detection.
 */
vi.mock("#/hooks/useLandingRegion", async () => {
	const { useState } = await import("react");
	return { useLandingRegion: () => useState<"MY" | "SG">("MY") };
});

// The support number rides the Convex/TanStack adapter pair; the calculator
// only needs it for a wa.me href. Stub the pair, same as billing-tab.test.tsx.
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));

beforeAll(() => {
	// Radix Slider measures its track; jsdom has no ResizeObserver. Inert
	// polyfill, same as fulfilment-tab.test.tsx.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
});

afterEach(cleanup);

/** Rendered text with NBSP flattened — `formatPrice` separates symbol from amount with one. */
function text(): string {
	return (document.body.textContent ?? "").replace(/ /g, " ");
}

/** Sliders in render order: orders/week, AOV, missed/week, chase minutes. */
function sliders(): HTMLElement[] {
	return screen.getAllByRole("slider");
}

function switchToSingapore(): void {
	fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
}

describe("CostCalculator — switching region re-seeds what the visitor never touched", () => {
	it("renders four sliders and Malaysia's defaults", () => {
		render(<CostCalculator />);
		expect(sliders()).toHaveLength(4);
		expect(text()).toContain("RM 35.00");
	});

	/**
	 * The defect this pins (found in review of PR #238): `update` merged the
	 * patch into the fully-DERIVED inputs, so moving any one slider stamped all
	 * four fields — including this region's defaults — into the "entered" set.
	 * A switch to SG then kept RM 35 and re-read it as S$ 35, inflating missed
	 * revenue ~2.3x on the SG framing.
	 */
	it("re-seeds an untouched AOV after another slider has been moved", () => {
		render(<CostCalculator />);
		fireEvent.keyDown(sliders()[0], { key: "ArrowRight" });
		expect(text()).toContain("RM 35.00");

		switchToSingapore();
		expect(text()).toContain("S$ 15.00");
		expect(text()).not.toContain("S$ 35.00");
	});

	it("keeps an AOV the visitor did enter", () => {
		render(<CostCalculator initialInputs={{ aov: 120 }} />);
		expect(text()).toContain("RM 120.00");

		switchToSingapore();
		// Stated, so it survives — 120 is inside the S$ slider's 0–200 range.
		expect(text()).toContain("S$ 120.00");
	});

	it("clamps an entered value that has no position on the new slider", () => {
		// RM 400 is a valid Malaysian basket and past the S$ ceiling of 200.
		render(<CostCalculator initialInputs={{ aov: 400 }} />);
		expect(text()).toContain("RM 400.00");

		switchToSingapore();
		expect(text()).toContain("S$ 200.00");
	});

	it("moves every currency-shaped figure together, leaving no ringgit behind", () => {
		render(<CostCalculator />);
		expect(text()).toContain("RM149/mo");

		switchToSingapore();
		const shown = text();
		expect(shown).toContain("S$59/mo");
		expect(shown).not.toMatch(/RM\s?\d/);
	});

	it("mirrors the full picture to the URL, defaults included", () => {
		const onInputsChange = vi.fn();
		render(<CostCalculator onInputsChange={onInputsChange} />);

		fireEvent.keyDown(sliders()[0], { key: "ArrowRight" });

		// The route writes every param, so the callback gets derived values too —
		// only the internal "entered" set is narrowed to what was stated.
		expect(onInputsChange).toHaveBeenCalledWith({
			ordersPerWeek: 41,
			aov: 35,
			missedPerWeek: 4,
			chaseMin: 5,
		});
	});
});

/**
 * Credits T5 (z8r3fdfu31): the card prices the plan the visitor's volume
 * actually needs — orders a week × 52 / 12 — not a flat Pro. The three
 * volumes the ticket named, in both currencies; the arithmetic itself is
 * pinned in calculator.test.ts, this pins what the visitor reads.
 */
describe("CostCalculator — the plan behind the price", () => {
	/** The plan block's text, NBSP-flattened. */
	function plan(): string {
		return (screen.getByTestId("cost-plan").textContent ?? "").replace(
			/\u00a0/g,
			" ",
		);
	}
	/** The sticky CTA's WhatsApp message, decoded. */
	function waMessage(): string {
		const link = screen.getByRole("link", { name: /Start with Kedaipal/ });
		return decodeURIComponent(link.getAttribute("href") ?? "");
	}

	it("20 a week: Starter covers it — and the pitch prices Starter, not Pro", () => {
		render(<CostCalculator initialInputs={{ ordersPerWeek: 20 }} />);
		expect(plan()).toContain("Your plan at about 87 orders a month");
		expect(plan()).toContain("Starter");
		expect(plan()).toContain("RM79/mo");
		expect(plan()).toContain("Starter includes 100 credits a month");
		expect(plan()).not.toContain("Cheaper than");
		expect(text()).toContain("Start with Kedaipal — RM79/mo");

		switchToSingapore();
		expect(plan()).toContain("S$29/mo");
		expect(text()).not.toMatch(/RM\s?\d/);
	});

	it("60 a week: Pro + 2 × 50 credits, honestly set against Scale", () => {
		render(<CostCalculator initialInputs={{ ordersPerWeek: 60 }} />);
		expect(plan()).toContain("about 260 orders a month");
		expect(plan()).toContain("Pro + 2 × 50 credits");
		expect(plan()).toContain("RM239/mo");
		expect(plan()).toContain(
			"Pro includes 200 credits a month; top-ups cover the other 60",
		);
		expect(plan()).toContain("last 12 months");
		expect(plan()).toContain("Cheaper than Scale at RM399/mo");
		expect(waMessage()).toContain(
			"get started on Pro + 2 × 50 credits (RM239/mo)",
		);

		switchToSingapore();
		expect(plan()).toContain("Pro + 2 × 50 credits");
		expect(plan()).toContain("S$103/mo");
		expect(plan()).toContain("Cheaper than Scale at S$149/mo");
	});

	it("130 a week: the currencies part ways, and the bigger tier is named in full", () => {
		render(<CostCalculator initialInputs={{ ordersPerWeek: 130 }} />);
		expect(plan()).toContain("about 564 orders a month");
		expect(plan()).toContain("Pro + 2 × 200 credits");
		expect(plan()).toContain("RM469/mo");
		// The runner-up is the whole option — Scale alone is RM399, not RM489.
		expect(plan()).toContain("Cheaper than Scale + 2 × 50 credits at RM489/mo");

		switchToSingapore();
		expect(plan()).toContain("Scale + 2 × 50 credits");
		expect(plan()).toContain("S$193/mo");
		// Scale is the top tier: there's no bigger plan to have beaten, so no
		// comparison line — never a "cheaper than" a smaller tier.
		expect(plan()).not.toContain("Cheaper than");
	});

	it("a verdict of not-worth-it-yet still shows which plan it was measured against", () => {
		// No missed orders → disqualified; the plan block explains the price.
		render(
			<CostCalculator
				initialInputs={{ ordersPerWeek: 20, missedPerWeek: 0 }}
			/>,
		);
		expect(screen.getByText(/Nothing's leaking/)).toBeTruthy();
		expect(plan()).toContain("Starter");
		expect(plan()).toContain("RM79/mo");
	});
});
