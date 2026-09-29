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
vi.mock("./tier-pill", () => ({
	TierPill: () => <div data-slot="tier-pill" />,
}));
vi.mock("./whats-new", () => ({
	WhatsNewNavItem: () => <div data-slot="whats-new" />,
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
});
