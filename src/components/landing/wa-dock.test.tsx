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
import {
	LandingRegionProvider,
	useLandingRegionContext,
} from "../../hooks/useLandingRegion";
import { m } from "../../paraglide/messages";
import { RegionToggle } from "./landing-ui";
import { WaDock } from "./wa-dock";

/**
 * The floating WhatsApp dock (z8r3fdtpub T1, after docket.io's persistent
 * "Talk to me"): a demo pill plus two question chips that change with the
 * section under the reader and prefill the chat. It appears once the hero
 * has scrolled out and hides while the final CTA is on screen, so it never
 * doubles an ask that is already in front of the reader.
 */

const { trackDemoCta, authState } = vi.hoisted(() => ({
	trackDemoCta: vi.fn(),
	authState: { isSignedIn: false },
}));
vi.mock("../../lib/ga-events", () => ({ trackDemoCta }));
vi.mock("@clerk/tanstack-react-start", () => ({ useAuth: () => authState }));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
			select({ matches: [{ loaderData: { region: "MY" } }] }),
	};
});
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return {
		...actual,
		useReducedMotion: () => true,
		AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
	};
});

type Entry = { target: Element; isIntersecting: boolean };
const observers: { cb: (entries: Entry[]) => void; targets: Element[] }[] = [];
class FakeObserver {
	targets: Element[] = [];
	constructor(cb: (entries: Entry[]) => void) {
		observers.push({ cb, targets: this.targets });
	}
	observe(el: Element) {
		this.targets.push(el);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}
function report(id: string, isIntersecting: boolean) {
	const el = document.getElementById(id);
	if (!el) throw new Error(`no #${id}`);
	for (const o of observers) {
		if (o.targets.includes(el))
			act(() => o.cb([{ target: el, isIntersecting }]));
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

/** The page's toggle lives in other sections; the dock only reads the region. */
function RegionSwitch() {
	const [region, setRegion] = useLandingRegionContext();
	return <RegionToggle region={region} onChange={setRegion} />;
}

function renderDock() {
	return render(
		<LandingRegionProvider>
			<RegionSwitch />
			<div>
				<section id="top" />
				<section id="demo" />
				<section id="flow" />
				<section id="pricing" />
				<section id="final" />
				<footer id="site-footer" />
			</div>
			<WaDock />
		</LandingRegionProvider>,
	);
}

const dock = () =>
	screen.queryByRole("complementary", { name: m.dock_label() });
const demoLink = () =>
	screen
		.getAllByRole("link")
		.filter((a) => /wa\.me/.test(a.getAttribute("href") ?? ""));

describe("WaDock", () => {
	beforeEach(() => {
		observers.length = 0;
		authState.isSignedIn = false;
		trackDemoCta.mockClear();
		installMatchMedia();
		vi.stubGlobal("IntersectionObserver", FakeObserver);
		vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
			timeZone: "UTC",
		} as Intl.ResolvedDateTimeFormatOptions);
		// biome-ignore lint/suspicious/noDocumentCookie: jsdom keeps cookies across tests in a file; the region pick from one test must not leak into the next.
		document.cookie = "kp_landing_region=; Max-Age=0; Path=/";
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("stays hidden until the hero scrolls out, and hides again on the final CTA", () => {
		renderDock();
		expect(dock()).toBeNull();
		report("top", true);
		expect(dock()).toBeNull();
		report("top", false);
		expect(dock()).not.toBeNull();
		report("final", true);
		expect(dock()).toBeNull();
		report("final", false);
		expect(dock()).not.toBeNull();
	});

	it("hides while the footer is on screen, so it never covers the page's last lines", () => {
		renderDock();
		report("top", false);
		expect(dock()).not.toBeNull();
		report("site-footer", true);
		expect(dock()).toBeNull();
	});

	it("never shows a demo pill to a signed-in seller", () => {
		authState.isSignedIn = true;
		renderDock();
		report("top", false);
		expect(dock()).toBeNull();
	});

	it("keeps every chip at the 44px touch floor", () => {
		renderDock();
		report("top", false);
		for (const chip of screen.getAllByRole("link")) {
			if (chip.textContent?.includes(m.book_demo_cta_long())) continue;
			expect(chip.className).toContain("min-h-11");
		}
	});

	it("asks the section's question: fit at the top, a live store on the flow, the plan on pricing", () => {
		renderDock();
		report("top", false);
		report("demo", true);
		expect(screen.getByText(m.dock_chip_fit())).toBeTruthy();
		report("flow", true);
		expect(screen.getByText(m.dock_chip_store())).toBeTruthy();
		report("pricing", true);
		expect(screen.getByText(m.dock_chip_plan({ currency: "RM" }))).toBeTruthy();
	});

	it("prefills the chat with the chip and reports which chip", () => {
		renderDock();
		report("top", false);
		report("flow", true);
		const chip = screen.getByText(m.dock_chip_store()).closest("a");
		expect(chip?.getAttribute("href")).toContain(
			encodeURIComponent(m.dock_chip_store()),
		);
		if (chip) fireEvent.click(chip);
		expect(trackDemoCta).toHaveBeenCalledWith("dock", m.dock_chip_store());
		// The pill itself is the plain demo ask.
		const pill = demoLink().find((a) =>
			a.textContent?.includes(m.book_demo_cta()),
		);
		expect(pill).toBeTruthy();
		if (pill) fireEvent.click(pill);
		expect(trackDemoCta).toHaveBeenCalledWith("dock", undefined);
	});

	it("quotes the plan question in the region's currency", () => {
		renderDock();
		report("top", false);
		report("pricing", true);
		fireEvent.click(screen.getByRole("button", { name: m.region_sg() }));
		expect(screen.getByText(m.dock_chip_plan({ currency: "S$" }))).toBeTruthy();
	});
});
