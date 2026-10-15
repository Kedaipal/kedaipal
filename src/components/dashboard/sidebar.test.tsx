// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

// The sidebar's collapse used to be an instant class swap; it now animates.
// These tests pin the three behaviours that make the motion safe rather than
// the motion itself: (1) every transition is gated behind
// prefers-reduced-motion, (2) no transition exists on the first paint, so
// restoring a saved collapsed state on page load never plays as a slide, and
// (3) a collapsed rail keeps its old semantics — labels hidden from the
// accessibility tree, the tier pill inert.

let collapsed = false;
const setCollapsed = vi.fn();
vi.mock("../../hooks/useSidebarCollapsed", () => ({
	useSidebarCollapsed: () => [collapsed, setCollapsed],
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useUser: () => ({
		user: {
			fullName: "Zaki",
			primaryEmailAddress: { emailAddress: "zaki@example.com" },
		},
	}),
	UserButton: () => <div data-slot="user-button" />,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		...props
	}: {
		children: ReactNode | ((state: { isActive: boolean }) => ReactNode);
		[key: string]: unknown;
	}) => {
		const {
			to,
			search: _search,
			activeOptions: _a,
			activeProps: _b,
			inactiveProps: _c,
			...rest
		} = props as Record<string, unknown>;
		return (
			<a href={String(to)} {...(rest as Record<string, never>)}>
				{typeof children === "function"
					? children({ isActive: false })
					: children}
			</a>
		);
	},
}));

vi.mock("../../hooks/useActAs", () => ({
	useActAs: () => ({ setActAs: vi.fn() }),
}));
vi.mock("../../hooks/usePermission", () => ({
	usePermission: () => ({ canRead: true, canWrite: true }),
}));
// The real pill is a Link and the real nav items are buttons — the stubs keep
// the element TYPE, because what matters here is whether a hidden one can
// still take focus.
vi.mock("./tier-pill", () => ({
	TierPill: () => <a href="/app/settings">Pro</a>,
}));
vi.mock("./whats-new", () => ({
	WhatsNewNavItem: ({ variant }: { variant: string }) => (
		<button type="button" data-variant={variant}>
			What's new
		</button>
	),
}));
vi.mock("./app-version-row", () => ({
	AppVersionRow: () => <div data-slot="app-version" />,
}));
vi.mock("../ui/app-image", () => ({
	AppImage: (props: { alt: string }) => <img alt={props.alt} src="/x.svg" />,
}));
vi.mock("../app/pro-gate", () => ({
	ProBadge: () => <span data-slot="pro-badge" />,
}));

/** Capture rAF callbacks so the test controls when motion arms. */
let rafQueue: FrameRequestCallback[] = [];
beforeEach(() => {
	rafQueue = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
		rafQueue.push(cb);
		return rafQueue.length;
	});
	vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	collapsed = false;
});

function armMotion() {
	act(() => {
		for (const cb of rafQueue.splice(0)) cb(performance.now());
	});
}

function asideOf(container: HTMLElement) {
	return container.querySelector(
		'[aria-label="Dashboard navigation"]',
	) as HTMLElement;
}

describe("Sidebar collapse motion", () => {
	it("has NO transition on first paint, so a restored collapsed state never plays as a slide on load", () => {
		const { container } = render(
			<Sidebar retailer={null} newOrdersCount={0} isAdmin />,
		);
		const aside = asideOf(container);
		expect(aside.className).not.toContain("transition-[");

		armMotion();
		expect(aside.className).toContain("transition-[");
	});

	it("gates every armed transition behind prefers-reduced-motion (Tailwind motion-reduce, not a JS branch)", () => {
		const { container } = render(
			<Sidebar retailer={null} newOrdersCount={0} isAdmin />,
		);
		armMotion();
		// nwsapi (jsdom) can't parse "[" inside an attribute selector, so
		// walk the tree instead.
		const animated = Array.from(container.querySelectorAll("*")).filter((el) =>
			(el.getAttribute("class") ?? "").includes("transition-["),
		);
		// Aside + header text + admin label + 3 admin links with their label
		// clusters + chevron + user row and name block all animate.
		expect(animated.length).toBeGreaterThanOrEqual(5);
		for (const el of animated) {
			expect(el.getAttribute("class") ?? "").toContain(
				"motion-reduce:transition-none",
			);
		}
	});

	it("collapsed keeps the old semantics: label clusters are aria-hidden and faded out", () => {
		collapsed = true;
		const { container } = render(
			<Sidebar retailer={null} newOrdersCount={0} isAdmin />,
		);
		const hidden = Array.from(
			container.querySelectorAll('[aria-hidden="true"]'),
		).filter((el) => (el.getAttribute("class") ?? "").includes("opacity-0"));
		// Header identity block + admin section label + one cluster per admin
		// link (3) + the user name block.
		expect(hidden.length).toBeGreaterThanOrEqual(5);
		// Deleting the guard that swaps opacity back on expand must go red:
		expect(
			container.querySelectorAll('[aria-hidden="false"][class*="opacity-0"]')
				.length,
		).toBe(0);
	});

	it("expanded shows the same clusters: nothing stays aria-hidden or transparent", () => {
		collapsed = false;
		const { container } = render(
			<Sidebar retailer={null} newOrdersCount={0} isAdmin />,
		);
		expect(
			Array.from(container.querySelectorAll('[aria-hidden="true"]')).filter(
				(el) => (el.getAttribute("class") ?? "").includes("opacity-0"),
			).length,
		).toBe(0);
	});

	it("expanded renders no aria-hidden at all — the same markup as before the motion", () => {
		collapsed = false;
		const { container } = render(
			<Sidebar retailer={null} newOrdersCount={0} isAdmin />,
		);
		expect(container.querySelectorAll('[aria-hidden="false"]').length).toBe(0);
	});
});

const STORE = { storeName: "Kuih Lab", slug: "kuih-lab" } as never;

describe("hidden controls are out of the focus order, not just invisible (PR #362 review)", () => {
	it("the collapsed tier pill's link is inert — no invisible Tab stop to billing", () => {
		collapsed = true;
		const { container } = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin={false} />,
		);
		const pill = container.querySelector('a[href="/app/settings"]');
		expect(pill?.textContent).toBe("Pro");
		expect(pill?.closest("[inert]")).not.toBeNull();
	});

	it("expanded, the pill is an ordinary link again", () => {
		collapsed = false;
		const { container } = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin={false} />,
		);
		const pill = Array.from(container.querySelectorAll("a")).find(
			(a) => a.textContent === "Pro",
		);
		expect(pill?.closest("[inert]")).toBeNull();
	});

	it("the bottom row keeps exactly one live What's-new control per state", () => {
		const live = (container: HTMLElement) =>
			Array.from(container.querySelectorAll("button[data-variant]"))
				.filter((b) => b.closest("[inert]") === null)
				.map((b) => b.getAttribute("data-variant"));
		collapsed = true;
		const rail = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin={false} />,
		);
		expect(live(rail.container)).toEqual(["icon"]);
		cleanup();
		collapsed = false;
		const open = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin={false} />,
		);
		expect(live(open.container)).toEqual(["meta"]);
	});
});

// jsdom has no layout, so this pins the flex contract that makes a short
// window work: on a laptop-height screen an admin's 14 links outgrow the rail,
// and before this every overflow-hidden row flex-shrank instead — the tier
// pill to a sliver, the links to 2px — while the footer fell off-screen.
describe("a short window scrolls the link list; the chrome never squashes", () => {
	it("header, tier pill and footer keep their height; only the nav gives", () => {
		const { container } = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin />,
		);
		const rows = Array.from(asideOf(container).children) as HTMLElement[];
		const nav = rows.find((el) => el.tagName === "NAV");
		const chrome = rows.filter((el) => el !== nav);
		expect(chrome).toHaveLength(3);
		for (const row of chrome) expect(row.classList).toContain("shrink-0");

		expect(nav?.classList).toContain("min-h-0");
		expect(nav?.classList).toContain("overflow-y-auto");
		// The links are overflow-hidden too — without this they squash, not scroll.
		expect(nav?.classList).toContain("*:shrink-0");
	});

	it("the 68px rail hides its scrollbar so an always-shown one can't push icons off-centre", () => {
		collapsed = true;
		const rail = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin />,
		);
		expect(rail.container.querySelector("nav")?.className).toContain(
			"[scrollbar-width:none]",
		);
		cleanup();
		collapsed = false;
		const open = render(
			<Sidebar retailer={STORE} newOrdersCount={0} isAdmin />,
		);
		expect(open.container.querySelector("nav")?.className).toContain(
			"[scrollbar-width:thin]",
		);
	});
});
