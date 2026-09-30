// @vitest-environment jsdom
// /pricing after the credits release (Credits T5, z8r3fdfu31) and Enterprise
// replacing Scale (T6, z8r3fdkp8h): the credits the page prints are the
// ledger's own numbers, per month in both toggle positions; the pack price is
// the visitor's currency's; Enterprise is "Custom" with a chat, never a price
// or a checkout; and the page says the real trial everywhere it used to say
// "14-day free trial".
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	CREDIT_PACKS,
	ENTERPRISE_FROM_ORDERS,
	LISTED_PLANS,
	PLAN_CREDIT_GRANT,
} from "../../convex/lib/plans";
import { MAX_VARIANTS_PER_PRODUCT } from "../../convex/lib/variant";
import type { SubscriptionView } from "../lib/subscription";

const state = vi.hoisted(() => ({
	auth: { isLoaded: true, isSignedIn: false } as {
		isLoaded: boolean;
		isSignedIn: boolean;
	},
	plan: undefined as SubscriptionView | null | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => ({
		...opts,
		options: opts,
	}),
	Link: ({
		children,
		to,
		hash,
		search,
		className,
	}: {
		children: ReactNode;
		to: string;
		hash?: string;
		search?: Record<string, string>;
		className?: string;
	}) => (
		<a
			href={`${to}${search ? `?${new URLSearchParams(search)}` : ""}${hash ? `#${hash}` : ""}`}
			className={className}
		>
			{children}
		</a>
	),
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => state.auth,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (_fn: unknown, args: unknown) => ({ args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (q: { args: unknown }) => ({
		data: q.args === "skip" ? undefined : state.plan,
	}),
}));
vi.mock("../hooks/useLandingRegion", async () => {
	const { useState } = await import("react");
	return { useLandingRegion: () => useState<"MY" | "SG">("MY") };
});
vi.mock("../hooks/useMarketingLanding", () => ({
	useMarketingLanding: () => {},
}));
vi.mock("../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("../lib/ga-events", () => ({
	trackEvent: () => {},
	trackSignupCta: () => {},
}));
// Chrome the page shares with the landing — not under test here.
vi.mock("../components/landing/nav", () => ({ Nav: () => null }));
vi.mock("../components/landing/footer", () => ({ Footer: () => null }));
vi.mock("../components/landing/money-math", () => ({
	MoneyMathRow: () => null,
}));
vi.mock("embla-carousel-react", () => ({ default: () => [() => {}] }));
// The price roll's exit animation never finishes in jsdom; reduced motion is
// a real path the page supports and leaves no outgoing price behind.
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const { Route } = await import("./pricing");

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

afterEach(() => {
	cleanup();
	state.auth = { isLoaded: true, isSignedIn: false };
	state.plan = undefined;
});

function renderPage() {
	const Page = Route.options.component;
	if (!Page) throw new Error("/pricing has no component");
	return render(<Page />);
}

const text = () => (document.body.textContent ?? "").replace(/ /g, " ");

/** The comparison table's credits row, cell by cell. */
function creditsRow(): string[] {
	const label = screen.getByText("Credits a month (1 credit = 1 order)");
	const row = label.closest("tr");
	if (!row) throw new Error("no credits row");
	return Array.from(row.querySelectorAll("td"))
		.slice(1)
		.map((td) => td.textContent ?? "");
}

describe("/pricing — credits", () => {
	it("prints the ledger's monthly credits on every listed card and in the table", () => {
		renderPage();
		for (const plan of LISTED_PLANS) {
			expect(text()).toContain(
				`${PLAN_CREDIT_GRANT[plan]} credits a month — 1 per order`,
			);
		}
		// Enterprise's credits are per contract — never a number here.
		expect(creditsRow()).toEqual([
			String(PLAN_CREDIT_GRANT.starter),
			String(PLAN_CREDIT_GRANT.pro),
			"Custom",
		]);
		expect(text()).toContain("Credits sized to your volume");
		expect(text()).not.toMatch(/\b400\b/);
	});

	it("keeps credits PER MONTH on the annual toggle — never a yearly total — and says why", () => {
		renderPage();
		fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
		expect(creditsRow()).toEqual(["100", "200", "Custom"]);
		expect(text()).toContain("200 credits a month — 1 per order");
		expect(text()).toContain(
			"On annual you get the same credits every month, locked in for the year you paid.",
		);
		expect(text()).not.toMatch(/\b(1,?200|2,?400|6,?000) credits\b/);
	});

	it("quotes the smallest top-up in the visitor's own currency — S$ never beside RM", () => {
		renderPage();
		const my = CREDIT_PACKS.MYR[0];
		expect(text()).toContain(
			`Top-ups start at RM ${my.priceMinor / 100} for ${my.credits} credits.`,
		);
		fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
		const sg = CREDIT_PACKS.SGD[0];
		expect(text()).toContain(
			`Top-ups start at S$ ${sg.priceMinor / 100} for ${sg.credits} credits.`,
		);
		expect(text()).not.toMatch(/RM\s?\d/);
	});

	it("answers the credits questions, and says the real trial instead of the 14-day one", () => {
		renderPage();
		for (const q of [
			"When do I start paying?",
			"What is a credit?",
			"Is my price changing?",
			"What happens if I run out of credits?",
			"Do unused credits carry over?",
			"Do I get the same credits on the annual plan?",
		]) {
			expect(screen.getByText(q)).toBeTruthy();
		}
		expect(text()).toContain("14 days or 200 orders");
		expect(text()).toContain("Haven't sold by day 15?");
		expect(text()).toContain("Your buyers never see credits.");
		expect(text()).not.toMatch(/14-day|free trial|Off-Season/i);
	});

	it("reads the variant cap the product form enforces", () => {
		renderPage();
		expect(
			screen.getByText(
				`Product variants (up to ${MAX_VARIANTS_PER_PRODUCT} per product)`,
			),
		).toBeTruthy();
	});
});

/** The Enterprise card — the one whose CTA is the chat with Arif. */
function enterpriseCard(): HTMLElement {
	const card = screen
		.getByText(
			`Built for ${ENTERPRISE_FROM_ORDERS.toLocaleString("en")}+ orders a month`,
		)
		.closest<HTMLElement>(".rounded-3xl");
	if (!card) throw new Error("no Enterprise card");
	return card;
}

describe("/pricing — Enterprise is a conversation (T6, z8r3fdkp8h)", () => {
	it("signed out, Starter and Pro invite a free start and Enterprise opens a chat", () => {
		renderPage();
		expect(
			screen.getAllByRole("link", { name: /Start free — pay when you sell/ }),
		).toHaveLength(3); // two cards + the closing CTA
		const talk = within(enterpriseCard()).getByRole("link", {
			name: /Talk to Arif/,
		});
		const href = decodeURIComponent(talk.getAttribute("href") ?? "");
		expect(href).toContain("wa.me/60123456789");
		expect(href).toContain("Kedaipal Enterprise");
		expect(href).toContain(ENTERPRISE_FROM_ORDERS.toLocaleString("en"));
		expect(talk.getAttribute("target")).toBe("_blank");
		// The only "Coming soon" left is on unbuilt table rows.
		for (const badge of screen.queryAllByText("Coming soon")) {
			expect(badge.closest("tr")).not.toBeNull();
		}
	});

	it("never prices Enterprise — Custom in either currency, on either cycle", () => {
		renderPage();
		const card = () => enterpriseCard().textContent ?? "";
		expect(card()).toContain("Custom");
		expect(card()).toContain("Priced for your volume");
		expect(card()).not.toMatch(/RM|S\$|\/mo|Billed/);
		fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
		fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
		expect(card()).toContain("Custom");
		expect(card()).not.toMatch(/RM|S\$|\/mo|Billed/);
	});

	it("sells Enterprise on what is live, and says multi-outlet is not yet", () => {
		renderPage();
		expect(text()).not.toMatch(/Additional outlets/);
		const card = within(enterpriseCard());
		expect(card.getByText("Unlimited teammates")).toBeTruthy();
		expect(
			card.getByText("Multiple outlets").closest("li")?.textContent,
		).toContain("Soon");
	});

	it("an active Pro seller: Pro is current, Starter is managed in Billing, Enterprise is a chat", () => {
		state.auth = { isLoaded: true, isSignedIn: true };
		state.plan = { plan: "pro", status: "active", comped: false };
		renderPage();
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Manage plan/ }).getAttribute("href"),
		).toBe("/app/settings?tab=billing");
		expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
		expect(
			within(enterpriseCard()).getByRole("link", { name: /Talk to Arif/ }),
		).toBeTruthy();
	});

	it("a trialing seller can subscribe to either listed tier", () => {
		state.auth = { isLoaded: true, isSignedIn: true };
		state.plan = { plan: "pro", status: "trialing", comped: false };
		renderPage();
		expect(screen.getAllByRole("link", { name: /^Subscribe/ })).toHaveLength(2);
		expect(
			within(enterpriseCard()).getByRole("link", { name: /Talk to Arif/ }),
		).toBeTruthy();
	});

	it("an Enterprise seller: Enterprise is current, and every other card is a conversation", () => {
		state.auth = { isLoaded: true, isSignedIn: true };
		state.plan = { plan: "enterprise", status: "active", comped: false };
		renderPage();
		expect(within(enterpriseCard()).getByText("Current plan")).toBeTruthy();
		// A contract changes by talking to us — never a self-serve door the
		// server would refuse.
		expect(screen.getAllByRole("link", { name: /Talk to Arif/ })).toHaveLength(
			2,
		);
		expect(
			screen.queryByRole("link", { name: /^Subscribe|Upgrade|Manage plan/ }),
		).toBeNull();
		// Already onboarded — no first-order guarantee under the Pro card.
		const pro = screen
			.getByText("Orders and payments")
			.closest<HTMLElement>(".rounded-3xl");
		expect(pro?.textContent).not.toMatch(/first real order/i);
	});

	it("a sponsored store sees every card included, Enterprise too", () => {
		state.auth = { isLoaded: true, isSignedIn: true };
		state.plan = { plan: "pro", status: "active", comped: true };
		renderPage();
		expect(screen.queryByRole("link", { name: /Talk to Arif/ })).toBeNull();
		expect(
			within(enterpriseCard()).queryByText(/Talk to Arif|Current plan/),
		).toBeNull();
	});
});
