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
import { m } from "../../paraglide/messages";
import { WaDock } from "./wa-dock";

/**
 * The floating WhatsApp dock (z8r3fdtpub T1): one "Book a demo" pill. It
 * appears once the hero has scrolled out, hides while the final CTA or the
 * footer is on screen, and never shows to a signed-in seller.
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

function renderDock() {
	return render(
		<>
			<div>
				<section id="top" />
				<section id="final" />
				<footer id="site-footer" />
			</div>
			<WaDock />
		</>,
	);
}

const dock = () =>
	screen.queryByRole("complementary", { name: m.dock_label() });

describe("WaDock", () => {
	beforeEach(() => {
		observers.length = 0;
		authState.isSignedIn = false;
		trackDemoCta.mockClear();
		vi.stubGlobal("IntersectionObserver", FakeObserver);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
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

	it("is one pill — the demo ask — that reports its placement", () => {
		renderDock();
		report("top", false);
		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(1);
		expect(links[0].textContent).toContain(m.book_demo_cta_long());
		expect(links[0].getAttribute("href")).toContain("wa.me/60123456789");
		fireEvent.click(links[0]);
		expect(trackDemoCta).toHaveBeenCalledWith("dock");
	});
});
