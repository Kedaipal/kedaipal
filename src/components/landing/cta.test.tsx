// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import { FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { Nav } from "./nav";

/**
 * Demo-first (z8r3fdtpub T1, 19 Oct 2026): every payer to date closed on a
 * demo or a referral, so "Book a demo" is the page's one accent ask — hero,
 * nav, final CTA — and "Start free — pay when you sell" is a text link, a
 * rung below. The flat-fee badge (14 Oct comment) sits in the hero. A
 * signed-in seller still gets their dashboard door, never a sales pitch.
 */

const { trackDemoCta, trackSignupCta, authState } = vi.hoisted(() => ({
	trackDemoCta: vi.fn(),
	trackSignupCta: vi.fn(),
	authState: { isSignedIn: false },
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => authState,
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("../../lib/ga-events", () => ({ trackDemoCta, trackSignupCta }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
		onClick,
		...rest
	}: {
		children: ReactNode;
		to: string;
		className?: string;
		onClick?: () => void;
	}) => (
		<a href={to} className={className} onClick={onClick} {...rest}>
			{children}
		</a>
	),
}));
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useReducedMotion: () => true, useInView: () => false };
});
vi.mock("./hero-stage", () => ({ HeroStage: () => <div /> }));

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function links(pattern: RegExp): HTMLAnchorElement[] {
	return screen
		.getAllByRole("link")
		.filter((el): el is HTMLAnchorElement =>
			pattern.test(el.getAttribute("href") ?? ""),
		);
}

const demo = () => links(/^https:\/\/wa\.me\//);
const signUp = () => links(/^\/sign-up/);

beforeEach(() => {
	authState.isSignedIn = false;
	trackDemoCta.mockClear();
	trackSignupCta.mockClear();
	vi.stubGlobal("IntersectionObserver", NeverInViewObserver);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("hero — demo first", () => {
	it("makes the WhatsApp demo the accent pill and Start free a text link", () => {
		render(<Hero invite={null} />);
		const pill = demo()[0];
		expect(pill.className).toContain("bg-accent");
		expect(pill.textContent).toContain(m.book_demo_cta_long());
		const link = signUp()[0];
		expect(link.className).not.toContain("bg-accent");
		expect(link.textContent).toContain(m.final_cta());
	});

	it("carries the flat-fee badge and the guarantee under the CTAs", () => {
		const { container } = render(<Hero invite={null} />);
		expect(container.textContent).toContain(m.commission_badge());
		expect(container.textContent).toContain(m.guarantee_line());
	});

	it("fires demo_cta with its placement, and the sign-up link its own", () => {
		render(<Hero invite={null} />);
		fireEvent.click(demo()[0]);
		expect(trackDemoCta).toHaveBeenCalledWith("hero");
		fireEvent.click(signUp()[0]);
		expect(trackSignupCta).toHaveBeenCalledWith("hero");
	});

	it("shows a signed-in seller only the dashboard door", () => {
		authState.isSignedIn = true;
		render(<Hero invite={null} />);
		expect(links(/^\/app$/)).toHaveLength(1);
		expect(demo()).toHaveLength(0);
		expect(signUp()).toHaveLength(0);
	});
});

describe("final CTA — demo first", () => {
	it("mirrors the hero: demo pill, Start free link, the guarantee", () => {
		const { container } = render(<FinalCta />);
		expect(demo()[0].className).toContain("bg-accent");
		expect(signUp()[0].className).not.toContain("bg-accent");
		expect(container.textContent).toContain(m.guarantee_line());
		fireEvent.click(demo()[0]);
		expect(trackDemoCta).toHaveBeenCalledWith("final");
	});

	it("no longer promises a storefront in five minutes", () => {
		expect(m.final_sub()).not.toMatch(/5 ?min/i);
	});
});

describe("nav — demo first", () => {
	it("puts the demo pill in the bar, keeps Log in, drops the sign-up pill", () => {
		render(<Nav />);
		expect(demo()[0].className).toContain("bg-accent");
		expect(links(/^\/sign-in/).length).toBeGreaterThan(0);
		expect(signUp()).toHaveLength(0);
		fireEvent.click(demo()[0]);
		expect(trackDemoCta).toHaveBeenCalledWith("nav");
	});

	it("opens the menu with the demo pill first, then Start free and Log in as outline rows", () => {
		render(<Nav />);
		fireEvent.click(screen.getByLabelText(m.nav_menu_open()));
		// One demo link in the bar, one in the menu.
		expect(demo()).toHaveLength(2);
		const menuSignUp = signUp()[0];
		expect(menuSignUp.className).not.toContain("bg-accent");
		expect(menuSignUp.textContent).toContain(m.nav_start_free());
	});
});
