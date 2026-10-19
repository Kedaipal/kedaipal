// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingRegionProvider } from "../../hooks/useLandingRegion";
import { couriersFor, mockQuotes } from "../../lib/couriers";
import { m } from "../../paraglide/messages";
import { SellerFlow } from "./seller-flow";
import { firstStepOf, TIMELINE_HOLDS } from "./seller-flow-timeline";

/**
 * The walkthrough (z8r3fdtpub T3): three steps, one frame, the real UI.
 * The frame is decorative; the step copy carries the content. These tests
 * drive the one timeline and pin what each phase shows, that a click jumps,
 * that Singapore gets the rider-only story, and that reduced motion renders
 * a still a reader can still page through.
 */

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
			select({ matches: [{ loaderData: { region: "MY" } }] }),
	};
});

let reduced = false;
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return {
		...actual,
		useReducedMotion: () => reduced,
		useInView: () => true,
		// jsdom never finishes an exit animation, so `mode="wait"` would hold
		// the old phase on screen forever; the swap itself is not under test.
		AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
	};
});

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function installMatchMedia() {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

function renderFlow() {
	return render(
		<LandingRegionProvider>
			<SellerFlow />
		</LandingRegionProvider>,
	);
}

function switchToSg() {
	fireEvent.click(screen.getByRole("button", { name: m.region_sg() }));
}

/** One `act` per step — the hook re-arms its timer from an effect. */
let cursor = 0;
function stepTo(index: number) {
	while (cursor < index) {
		act(() => vi.advanceTimersByTime(TIMELINE_HOLDS[cursor]));
		cursor += 1;
	}
}

/** The frame's text alone — the step copy beside it names the same words. */
function frame(): string {
	return screen.getByTestId("flow-frame").textContent ?? "";
}

function stepButton(n: 1 | 2 | 3) {
	return screen.getByRole("button", { name: m.flow_step_label({ step: n }) });
}

describe("SellerFlow", () => {
	beforeEach(() => {
		reduced = false;
		cursor = 0;
		installMatchMedia();
		vi.stubGlobal("IntersectionObserver", NeverInViewObserver);
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
		vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
			timeZone: "UTC",
		} as Intl.ResolvedDateTimeFormatOptions);
		// biome-ignore lint/suspicious/noDocumentCookie: jsdom keeps cookies across tests in a file; the region pick from one test must not leak into the next.
		document.cookie = "kp_landing_region=; Max-Age=0; Path=/";
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("opens on phase 1 with the inbox at rest, then the order lands", () => {
		vi.useFakeTimers();
		renderFlow();
		expect(frame()).toContain(m.hero_after_inbox());
		expect(frame()).not.toContain(m.hero_after_status_1());
		expect(stepButton(1).getAttribute("aria-current")).toBe("step");
		stepTo(1);
		expect(frame()).toContain(m.hero_after_status_1());
		expect(frame()).toContain(m.hero_after_toast_1());
		expect(frame()).toContain(m.flow_bubble_1());
	});

	it("phase 2 opens on How to pay", () => {
		vi.useFakeTimers();
		const { container } = renderFlow();
		stepTo(firstStepOf(2));
		expect(frame()).toContain(m.handshake_how_to_pay());
		expect(frame()).not.toContain(m.delivery_quote_title());
		expect(container.textContent).toContain(m.flow_progress({ step: 2 }));
		expect(stepButton(2).getAttribute("aria-current")).toBe("step");
	});

	it("phase 3 opens on the asking beat and ends shipped with the quoted courier", () => {
		vi.useFakeTimers();
		renderFlow();
		stepTo(firstStepOf(3));
		expect(frame()).toContain(m.delivery_quote_getting());
		stepTo(TIMELINE_HOLDS.length - 1);
		const courier = mockQuotes("MY")[0].name;
		expect(frame()).toContain(m.delivery_quote_shipped({ courier }));
		expect(frame()).toContain(m.flow_bubble_3({ courier }));
	});

	it("clicking a step jumps there", () => {
		vi.useFakeTimers();
		renderFlow();
		fireEvent.click(stepButton(3));
		expect(frame()).toContain(m.delivery_quote_title());
		expect(stepButton(3).getAttribute("aria-current")).toBe("step");
		expect(stepButton(1).getAttribute("aria-current")).toBeNull();
	});

	it("SG phase 03 is rider-only", () => {
		vi.useFakeTimers();
		const { container } = renderFlow();
		switchToSg();
		fireEvent.click(stepButton(3));
		const text = container.textContent ?? "";
		expect(text).toContain(m.flow_step_3_body_rider());
		expect(text).not.toContain(m.flow_step_3_body());
		expect(text).toContain(m.delivery_sg_note());
		const grid = screen.getByRole("list", {
			name: m.delivery_catalogue_label(),
		});
		expect(grid.querySelectorAll("li")).toHaveLength(couriersFor("SG").length);
		expect(frame()).toContain(m.delivery_quote_asking_rider());
	});

	it("reduced motion: a still, and the step buttons still switch phase", () => {
		reduced = true;
		vi.useFakeTimers();
		renderFlow();
		// Phase 1's still is the landed order; nothing advances on its own.
		expect(frame()).toContain(m.hero_after_status_1());
		act(() => vi.advanceTimersByTime(60_000));
		expect(frame()).not.toContain(m.handshake_how_to_pay());
		fireEvent.click(stepButton(2));
		expect(frame()).toContain(m.handshake_buyer_received_title());
	});

	it("scrolls the step row to the active pill as the story advances", () => {
		vi.useFakeTimers();
		const scrollTo = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});
		renderFlow();
		fireEvent.click(stepButton(3));
		// The row scrolls sideways to the pill; the page itself is never
		// scrolled (a `scrollIntoView` would drag the reader up the page).
		expect(scrollTo).toHaveBeenCalled();
		const call = scrollTo.mock.calls.at(-1)?.[0];
		expect(call).toMatchObject({ left: expect.any(Number) });
		expect(call).not.toHaveProperty("top");
	});

	it("the frame is decorative and the steps carry the content", () => {
		renderFlow();
		// The active step's body renders twice on purpose: in its row (desktop)
		// and under the pills (phone), one hidden per breakpoint.
		expect(screen.getAllByText(m.flow_step_1_body()).length).toBeGreaterThan(0);
		expect(screen.getByText(m.flow_step_2_body())).toBeTruthy();
		expect(screen.getByText(m.flow_step_3_body())).toBeTruthy();
		expect(screen.getByTestId("flow-frame").getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			m.flow_heading(),
		);
	});
});
