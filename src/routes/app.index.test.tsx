// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Home's STATE SWITCH (z8r3fdrgzj) — which of the page's shapes a store gets.
 *
 * The route file's whole job is this decision, and every one of the design's
 * boards is one of its outcomes, so the boards are what this pins. Rendering
 * detail belongs to the component tests; what matters here is that a brand-new
 * store never sees a revenue hero and a locked store never sees its credit card
 * at the bottom of the page.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00+08:00");

/** Everything the route reads, in one place the tests move. */
const state = {
	retailer: null as Record<string, unknown> | null,
	products: [] as unknown[],
	counts: {
		new: 3,
		dueToday: 6,
		unpaid: 9,
		unpaidAmount: 92_000,
		unpaidStale: 0,
		unpaidStaleAmount: 0,
		unpaidStaleOldestAt: 0,
	},
	dueByDay: [] as { start: number; count: number }[],
	balance: null as Record<string, unknown> | null,
	canSeeInsights: true,
	search: {} as Record<string, unknown>,
};

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => ({
		...opts,
		useSearch: () => state.search,
	}),
	// Carries `to` AND `search`, because what these links CARRY is the thing
	// under test: a count that opens a differently-scoped list is the bug class
	// this suite exists to catch.
	Link: ({
		children,
		to,
		search,
	}: {
		children: ReactNode;
		to?: string;
		search?: unknown;
	}) => (
		<a href={to ?? "/"} data-search={JSON.stringify(search ?? null)}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query"> | undefined }) => {
		if (!opts?.__fn) return { data: undefined };
		const name = getFunctionName(opts.__fn);
		if (name.startsWith("products:")) return { data: state.products };
		if (name.startsWith("orders:searchOrders"))
			return { data: { counts: state.counts } };
		if (name.startsWith("orders:countDueByDay"))
			return { data: state.dueByDay };
		if (name.startsWith("pickupLocations:")) return { data: { hasAny: false } };
		if (name.startsWith("credits:getBalance")) return { data: state.balance };
		return { data: undefined };
	},
}));
vi.mock("../hooks/useDashboardRetailer", () => ({
	useDashboardRetailer: () => state.retailer,
}));
vi.mock("../hooks/usePermission", () => ({
	usePermission: () => ({ canRead: state.canSeeInsights, canWrite: true }),
}));
vi.mock("../hooks/useChecklistStamp", () => ({
	useChecklistStamp: () => ({ stamp: vi.fn(), active: false }),
}));

// Heavy children stubbed to a marker — their own suites cover them.
vi.mock("../components/credits/credit-meter", () => ({
	CreditMeter: () => <div data-testid="credit-card">credits</div>,
}));
vi.mock("../components/dashboard/white-glove-card", () => ({
	WhiteGloveCard: () => null,
}));
vi.mock("../components/settings/country-setup-panel", () => ({
	CountrySetupPanel: () => null,
}));
vi.mock("../components/dashboard/storefront-qr-dialog", () => ({
	StorefrontQrDialog: () => null,
}));
vi.mock("../components/dashboard/tagged-share-links", () => ({
	TaggedShareLinks: () => null,
}));
vi.mock("../components/dashboard/first-order-celebration", () => ({
	FirstOrderCelebration: () => <div data-testid="celebration">live!</div>,
}));
// The sales half owns its own reads; this suite only cares THAT it is there.
// The real SalesSection owns the money queries, which this suite does not care
// about — but it also HOSTS the desktop rail, so the stub must still render the
// `exceptions` and `planAhead` it is handed, or the page's operational half
// would vanish from every assertion below while working fine in the app.
vi.mock("../components/home/sales-section", () => ({
	SalesSection: ({
		exceptions,
		planAhead,
	}: {
		exceptions?: ReactNode;
		planAhead?: ReactNode;
	}) => (
		<div data-testid="sales-section">
			sales
			{exceptions}
			{planAhead}
		</div>
	),
}));

const { Route } = await import("./app.index");
const Home = (Route as unknown as { component: () => ReactNode }).component;

function retailer(over: Record<string, unknown> = {}) {
	return {
		_id: "r1",
		slug: "dapurlina",
		storeName: "Dapur Lina",
		country: "MY",
		currency: "MYR",
		waPhone: "60123456789",
		paymentMethods: [{ kind: "bank" }],
		linkSharedAt: NOW - DAY,
		activatedAt: NOW - 30 * DAY,
		subscription: { status: "active", plan: "pro" },
		...over,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	state.retailer = retailer();
	state.products = [{ _id: "p1", active: true, inStock: true }];
	state.counts = {
		new: 3,
		dueToday: 6,
		unpaid: 9,
		unpaidAmount: 92_000,
		unpaidStale: 0,
		unpaidStaleAmount: 0,
		unpaidStaleOldestAt: 0,
	};
	state.dueByDay = [];
	state.balance = null;
	state.canSeeInsights = true;
	state.search = {};
});
afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

describe("the steady board", () => {
	it("leads with the action strip and the sales section", () => {
		render(<Home />);
		expect(screen.getByLabelText("Needs you today")).toBeTruthy();
		expect(screen.getByTestId("sales-section")).toBeTruthy();
	});

	it("does NOT show recent orders — the Orders tab covers them", () => {
		// Decision 3. The old Home subscribed `orders.listByRetailer` purely to
		// render five rows that duplicated the New cell above them.
		render(<Home />);
		expect(screen.queryByText(/recent orders/i)).toBeNull();
	});

	it("shows Plan ahead only once there is a week to show", () => {
		render(<Home />);
		expect(screen.queryByText("Plan ahead")).toBeNull();
		cleanup();
		state.dueByDay = Array.from({ length: 7 }, (_, i) => ({
			start: NOW + i * DAY,
			count: i,
		}));
		render(<Home />);
		expect(screen.getByText("Plan ahead")).toBeTruthy();
	});
});

describe("onboarding boards", () => {
	it("a brand-new store gets the welcome card and no sales hero", () => {
		state.retailer = retailer({
			waPhone: "",
			paymentMethods: [],
			linkSharedAt: undefined,
			activatedAt: undefined,
			subscription: { status: "trialing", plan: "pro" },
		});
		state.products = [];
		render(<Home />);
		expect(screen.getByText("Let's get your store ready")).toBeTruthy();
		expect(screen.queryByTestId("sales-section")).toBeNull();
		// Nothing to action yet — the strip would be three zeroes.
		expect(screen.queryByLabelText("Needs you today")).toBeNull();
	});

	it("set up but waiting shows where the money will appear, not a zero hero", () => {
		state.retailer = retailer({ activatedAt: undefined });
		render(<Home />);
		expect(screen.getByText("Your first order will show up here")).toBeTruthy();
		expect(screen.queryByTestId("sales-section")).toBeNull();
	});

	it("the first order brings the celebration AND the real sales section", () => {
		state.retailer = retailer({ activatedAt: NOW - DAY });
		render(<Home />);
		expect(screen.getByTestId("celebration")).toBeTruthy();
		expect(screen.getByTestId("sales-section")).toBeTruthy();
	});

	it("the celebration expires — it is a moment, not a permanent banner", () => {
		state.retailer = retailer({ activatedAt: NOW - 8 * DAY });
		render(<Home />);
		expect(screen.queryByTestId("celebration")).toBeNull();
	});
});

describe("the credit card moves with its urgency (decision 6)", () => {
	const balance = (total: number) => ({ total, periodGrant: 200 });

	it("a healthy balance sits down in Your store", () => {
		state.balance = balance(184);
		render(<Home />);
		const card = screen.getByTestId("credit-card");
		const store = screen.getByText("Your store").closest("section");
		expect(store?.contains(card)).toBe(true);
	});

	it("running low moves it above the sales section", () => {
		state.balance = balance(31);
		render(<Home />);
		const card = screen.getByTestId("credit-card");
		const sales = screen.getByTestId("sales-section");
		expect(
			card.compareDocumentPosition(sales) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		const store = screen.getByText("Your store").closest("section");
		expect(store?.contains(card)).toBe(false);
	});

	it("out of credits puts it above the action strip", () => {
		state.balance = balance(0);
		render(<Home />);
		const card = screen.getByTestId("credit-card");
		const strip = screen.getByLabelText("Needs you today");
		expect(
			card.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("out of credits relabels the strip rather than disabling it", () => {
		// The seller must still be able to reach a buyer (Credits T3.1).
		state.balance = balance(0);
		render(<Home />);
		expect(screen.getByText("accepting paused")).toBeTruthy();
		expect(screen.getByText("updates paused")).toBeTruthy();
		expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
	});

	it("a teammate without the credits read sees no card at all", () => {
		state.balance = null;
		render(<Home />);
		expect(screen.queryByTestId("credit-card")).toBeNull();
	});
});

describe("permission and exception states", () => {
	it("a teammate without the insights grant loses the WHOLE sales section", () => {
		state.canSeeInsights = false;
		render(<Home />);
		expect(screen.queryByTestId("sales-section")).toBeNull();
		// …but keeps the operational half of the page.
		expect(screen.getByLabelText("Needs you today")).toBeTruthy();
	});

	it("stale unpaid orders raise an exception row the strip cannot say", () => {
		state.counts = {
			...state.counts,
			unpaidStale: 3,
			unpaidStaleAmount: 38_500,
			unpaidStaleOldestAt: NOW - 5 * DAY,
		};
		render(<Home />);
		expect(
			screen.getByText("3 unpaid orders are over 3 days old"),
		).toBeTruthy();
	});

	it("out-of-stock products raise their own row", () => {
		// `inStock` is the field the product card itself reads. The first version
		// of this row tested `p.stock`, which does not exist on this payload, so
		// `(undefined ?? 0) <= 0` was true for every product and the row counted
		// the whole catalogue — the archived row below is what pins that.
		state.products = [
			{ _id: "p1", active: true, inStock: false },
			{ _id: "p2", active: true, inStock: false },
			{ _id: "p3", active: true, inStock: true },
		];
		render(<Home />);
		expect(screen.getByText("2 products are out of stock")).toBeTruthy();
	});

	it("an ARCHIVED product that is out of stock raises nothing", () => {
		// Buyers can't reach it either way, so it is not an exception to act on.
		state.products = [
			{ _id: "p1", active: false, inStock: false },
			{ _id: "p2", active: true, inStock: true },
		];
		render(<Home />);
		expect(screen.queryByLabelText("Needs a look")).toBeNull();
	});

	it("every count links to a list that answers the SAME question", () => {
		// The whole class of bug found in testing: the strip said "2 New orders"
		// and opened all six, because `statuses=` is not a param the inbox reads.
		state.counts = { ...state.counts, new: 2 };
		render(<Home />);
		const link = (label: string) => {
			const a = screen
				.getAllByRole("link")
				.find((x) => x.textContent?.includes(label));
			return {
				to: a?.getAttribute("href") ?? "",
				search: JSON.parse(a?.getAttribute("data-search") ?? "null"),
			};
		};
		const newOrders = link("New orders");
		expect(newOrders.to).toBe("/app/orders");
		// The count IS the new bucket, so the link must be the new bucket.
		expect(newOrders.search).toEqual({ bucket: ["new"] });

		const collect = link("To collect");
		expect(collect.to).toBe("/app/orders");
		// "Not received" is unpaid AND claimed — both, or the list is narrower
		// than the total above it. And OPEN only: the count starts from open
		// work, so without the buckets "2 unpaid" opened four.
		expect(collect.search).toEqual({
			pay: ["unpaid", "claimed"],
			bucket: ["new", "in_progress"],
		});

		const due = link("Due today");
		expect(due.to).toBe("/app/orders");
		// Open, non-counter, due today — all three rules the count applies.
		expect(due.search).toEqual({
			fwin: "today",
			bucket: ["new", "in_progress"],
			sources: ["storefront", "claim"],
		});

		// Params the inbox does not read must never appear: they are dropped
		// silently, which is how "2" opened a list of 6.
		for (const l of [newOrders, collect, due])
			for (const key of Object.keys(l.search ?? {}))
				expect([
					"bucket",
					"pay",
					"fwin",
					"from",
					"to",
					"ffrom",
					"fto",
					"st",
					"asrc",
					"sources",
				]).toContain(key);
	});

	it("a clean store raises no exception rows at all", () => {
		render(<Home />);
		expect(screen.queryByLabelText("Needs a look")).toBeNull();
	});
});

describe("the period lives in the URL", () => {
	it("defaults to 7 days when nothing is pinned", () => {
		expect(
			(
				Route as unknown as { validateSearch: (s: object) => object }
			).validateSearch({}),
		).toEqual({});
	});

	it("round-trips a real window so a refresh keeps it", () => {
		const v = (Route as unknown as { validateSearch: (s: object) => object })
			.validateSearch;
		expect(v({ p: "30d" })).toEqual({ p: "30d" });
		expect(v({ p: "today" })).toEqual({ p: "today" });
	});

	it("a junk window falls back rather than breaking the page", () => {
		const v = (Route as unknown as { validateSearch: (s: object) => object })
			.validateSearch;
		expect(v({ p: "90d" })).toEqual({ p: "7d" });
	});
});
