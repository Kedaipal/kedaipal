// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingRegionProvider } from "../../hooks/useLandingRegion";
import { couriersFor, mockQuotes } from "../../lib/couriers";
import { m } from "../../paraglide/messages";
import { Delivery, DISPATCH_BEATS, SHIPPED_BEAT } from "./delivery";

/**
 * The region-dependent behaviour the ticket's edge cases name: MY renders the
 * Malaysian catalogue with the cold badges; SG renders only what is live plus
 * the "being enabled" note and drops nothing it can't book; the rider bullet
 * follows the catalogue. Plus the review findings on PR #275: the copy above
 * the catalogue must be as honest as the note below it (no "cold chain
 * included" over a one-courier region), and the mock card must ship the
 * courier it booked — which means driving the beat loop, not freezing it.
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

// The dispatch card's useInView is pinned per test — false so the static
// assertions read beat 0, true so the loop test can run the story. FadeIn's
// whileInView still reaches for a real IntersectionObserver, so jsdom gets a
// stub that never fires (FadeIn's visibility is not under test here).
let inView = false;
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useInView: () => inView };
});

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

/** A chip is either a name (text) or a brand mark (img alt) — one accessor. */
function chipNames(grid: HTMLElement): string[] {
	return Array.from(grid.querySelectorAll("li")).map((li) => {
		const img = li.querySelector("img");
		return img?.getAttribute("alt") || li.textContent || "";
	});
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

function renderDelivery() {
	return render(
		<LandingRegionProvider>
			<Delivery />
		</LandingRegionProvider>,
	);
}

function switchToSg() {
	fireEvent.click(screen.getByRole("button", { name: m.region_sg() }));
}

/**
 * Step the dispatch loop `count` beats forward. One `act` per beat: the hook
 * re-arms its timer from an effect, and React flushes effects only when an
 * `act` closes — one big advance would fire the first timer and then find
 * nothing armed for the rest of the window.
 */
function stepLoop(count: number) {
	for (let i = 0; i < count; i++) {
		act(() => vi.advanceTimersByTime(DISPATCH_BEATS[beatCursor]));
		beatCursor = (beatCursor + 1) % DISPATCH_BEATS.length;
	}
}
let beatCursor = 0;

describe("Delivery", () => {
	beforeEach(() => {
		inView = false;
		beatCursor = 0;
		installMatchMedia();
		vi.stubGlobal("IntersectionObserver", NeverInViewObserver);
		// useBeatLoop freezes in a hidden tab; jsdom does not report "visible".
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
		// Pin Intl so the time-zone fallback can't flip the region under the test.
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

	it("lists every visible Malaysian courier once in the grid, cold lanes badged", () => {
		renderDelivery();
		const grid = screen.getByRole("list", { name: m.delivery_label() });
		const names = couriersFor("MY").map((c) => c.name);
		const rendered = chipNames(grid);
		for (const name of names) expect(rendered.join("|")).toContain(name);
		const coldCount = couriersFor("MY").filter(
			(c) => c.group === "cold",
		).length;
		expect(rendered.length).toBe(names.length);
		expect(grid.textContent?.split(m.delivery_cold()).length - 1).toBe(
			coldCount,
		);
		expect(screen.getByText(m.delivery_cold_note())).toBeTruthy();
		expect(screen.getByText(m.delivery_point_3())).toBeTruthy();
	});

	it("makes Malaysia the full claim: cold chain in the heading, sub and bullets, Delyva on the card", () => {
		renderDelivery();
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			m.delivery_heading(),
		);
		expect(screen.getByText(m.delivery_sub())).toBeTruthy();
		expect(screen.getByText(m.delivery_point_1())).toBeTruthy();
		expect(screen.getByText(m.delivery_point_2())).toBeTruthy();
		expect(screen.getByTestId("dispatch-provider").dataset.provider).toBe(
			"delyva",
		);
		expect(screen.getByText(m.delivery_quote_note())).toBeTruthy();
	});

	it("shows Singapore only what is live, with the being-enabled note", () => {
		renderDelivery();
		switchToSg();
		const grid = screen.getByRole("list", { name: m.delivery_label() });
		const rendered = chipNames(grid);
		expect(rendered.length).toBe(couriersFor("SG").length);
		expect(rendered.join("|")).toContain("Lalamove");
		expect(rendered.join("|")).not.toContain("Ninja Cold");
		expect(screen.getByText(m.delivery_sg_note())).toBeTruthy();
		// The rider bullet stays because Lalamove SG is live.
		expect(screen.getByText(m.delivery_point_3())).toBeTruthy();
	});

	it("never overclaims for Singapore: rider-only heading, sub and bullet, no cold-chain bullet, Lalamove on the card", () => {
		renderDelivery();
		switchToSg();
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			m.delivery_heading_rider(),
		);
		expect(screen.getByText(m.delivery_sub_rider())).toBeTruthy();
		expect(screen.getByText(m.delivery_point_1_rider())).toBeTruthy();
		expect(screen.queryByText(m.delivery_heading())).toBeNull();
		expect(screen.queryByText(m.delivery_sub())).toBeNull();
		expect(screen.queryByText(m.delivery_point_1())).toBeNull();
		expect(screen.queryByText(m.delivery_point_2())).toBeNull();
		// The card quotes Lalamove, so it must not claim Delyva credit.
		expect(screen.getByTestId("dispatch-provider").dataset.provider).toBe(
			"lalamove",
		);
		expect(screen.getByText(m.delivery_quote_note_rider())).toBeTruthy();
		expect(screen.queryByText(m.delivery_quote_note())).toBeNull();
	});

	it("quotes the mock card in the region's currency", () => {
		// `formatPrice` joins symbol and amount with a non-breaking space.
		const { container } = renderDelivery();
		expect(container.textContent).toMatch(/RM\u00a0\d/);
		switchToSg();
		expect(container.textContent).toMatch(/S\$\u00a0\d/);
		expect(container.textContent).not.toMatch(/RM\u00a0\d/);
	});

	it("ships the courier it booked, in both regions — never the hero's J&T", () => {
		vi.useFakeTimers();
		inView = true;
		const { container } = renderDelivery();

		const my = mockQuotes("MY")[0];
		const shippedMy = m.delivery_quote_shipped({ courier: my.name });
		expect(container.textContent).not.toContain(shippedMy);
		stepLoop(SHIPPED_BEAT);
		expect(container.textContent).toContain(shippedMy);

		// The region flip swaps the quotes under a running loop; one full cycle
		// lands back on the shipped beat, now reading the SG courier.
		switchToSg();
		const sg = mockQuotes("SG")[0];
		expect(sg.name).toBe("Lalamove");
		stepLoop(DISPATCH_BEATS.length);
		expect(container.textContent).toContain(
			m.delivery_quote_shipped({ courier: sg.name }),
		);
		expect(container.textContent).not.toContain(m.hero_after_status_4());
	});
});
