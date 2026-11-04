// @vitest-environment jsdom
// The admin seller directory (z8r3fdh37c, paginated 4 Nov 2026): a Status
// menu that filters and counts, a Sort menu, search across contact facts — all
// three applied by the SERVER, which the mock below stands in for — infinite
// scroll through the pages with a Load more fallback and a named end, rows
// kept on screen while a new first page loads, the desktop table vs the phone
// cards, the read-only detail sheet, the CSV that walks every page, and the
// one-door Manage menu (owner decision, 20 Sep 2026).
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";

const {
	navigateSpy,
	setActAsSpy,
	downloadCsvSpy,
	desktop,
	paged,
	convexQuerySpy,
} = vi.hoisted(() => ({
	navigateSpy: vi.fn(),
	setActAsSpy: vi.fn(),
	downloadCsvSpy: vi.fn(),
	desktop: { value: true },
	/** The stand-in server: the whole book plus the pagination status the
	 * page should see. The `usePaginatedQuery` mock filters, searches and
	 * sorts `rows` from the args the page passes, exactly as
	 * `adminSellers.listSellersPage` does, so a test that picks a filter
	 * proves the ARGS reached the query, not that the page filtered. */
	paged: {
		rows: [] as unknown[],
		status: "Exhausted" as
			| "LoadingFirstPage"
			| "CanLoadMore"
			| "LoadingMore"
			| "Exhausted",
		loadMore: vi.fn(),
		lastArgs: null as unknown,
	},
	convexQuerySpy: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: unknown) => opts,
	useNavigate: () => navigateSpy,
	Link: ({
		to,
		hash,
		children,
		...rest
	}: {
		to: string;
		hash?: string;
		children: React.ReactNode;
	}) => (
		<a href={hash ? `${to}#${hash}` : to} {...rest}>
			{children}
		</a>
	),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
const queryData = new Map<string, unknown>();
vi.mock("@tanstack/react-query", async () => {
	const { countSellerBuckets } = await import("../lib/admin-seller-view");
	const { api } = await import("../../convex/_generated/api");
	return {
		useQuery: (q: { __fn: FunctionReference<"query">; args: unknown }) => {
			const name = getFunctionName(q.__fn);
			if (queryData.has(name)) return { data: queryData.get(name) };
			// The counts query tallies the same book the list mock serves.
			if (name === getFunctionName(api.adminSellers.countSellerBuckets)) {
				return {
					data: {
						counts: countSellerBuckets(paged.rows as AdminSellerRow[]),
						capped: false,
					},
				};
			}
			if (name === getFunctionName(api.enterprise.listContractTemplates)) {
				return { data: q.args === "skip" ? undefined : [] };
			}
			return { data: undefined };
		},
	};
});
vi.mock("../hooks/useActAs", () => ({
	useActAs: () => ({ setActAs: setActAsSpy }),
}));
vi.mock("../hooks/useIsDesktop", () => ({
	useIsDesktop: () => desktop.value,
}));
vi.mock("../lib/download", () => ({ downloadCsv: downloadCsvSpy }));

// The load-more sentinel observes its zone; jsdom ships no IntersectionObserver.
vi.stubGlobal(
	"IntersectionObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
);

// Radix positions menus with floating-ui, which watches the trigger with a
// ResizeObserver jsdom doesn't ship.
vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

const mutationSpies = new Map<string, ReturnType<typeof vi.fn>>();
type PageArgs = {
	filter?: SellerFilter;
	sort?: SellerSort;
	q?: string;
	paginationOpts?: { numItems: number; cursor: string | null };
};
vi.mock("convex/react", async () => {
	const { filterSellers, sortSellers } = await import(
		"../lib/admin-seller-view"
	);
	const serve = (args: PageArgs) =>
		sortSellers(
			filterSellers(
				paged.rows as AdminSellerRow[],
				args.filter ?? "all",
				args.q ?? "",
			),
			args.sort ?? "founding",
		);
	return {
		useMutation: (ref: FunctionReference<"mutation">) => {
			const name = getFunctionName(ref);
			if (!mutationSpies.has(name)) {
				mutationSpies.set(name, vi.fn().mockResolvedValue({ ok: true }));
			}
			return mutationSpies.get(name);
		},
		useConvex: () => ({ query: convexQuerySpy }),
		usePaginatedQuery: (
			ref: FunctionReference<"query">,
			args: PageArgs | "skip",
		) => {
			// The credit ledger drawer's paginated read (Credits T5) stays empty.
			if (getFunctionName(ref) !== "adminSellers:listSellersPage") {
				return { results: [], status: "Exhausted", loadMore: () => {} };
			}
			paged.lastArgs = args;
			const results =
				args === "skip" || paged.status === "LoadingFirstPage"
					? []
					: serve(args);
			return {
				results,
				status: paged.status,
				loadMore: paged.loadMore,
				isLoading:
					paged.status === "LoadingFirstPage" || paged.status === "LoadingMore",
			};
		},
	};
});

import { SellerCard } from "../components/admin/seller-card";
import {
	filterSellers,
	type SellerFilter,
	type SellerSort,
	sortSellers,
} from "../lib/admin-seller-view";
import { formatShortDate } from "../lib/format";
import {
	AdminSellersContent,
	PAGE_SIZE,
	Route,
	type SellersSearch,
} from "./app.admin.sellers";

const startActAsSpy = () =>
	mutationSpies.get(getFunctionName(api.admin.startActAsSession));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 22, 12).getTime();
const at = (days: number) => NOW + days * DAY;

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_comp" as AdminSellerRow["_id"],
		availability: { state: "open" },
		storeName: "Mak Kuih",
		slug: "mak-kuih",
		ownerUserId: "u_owner",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		foundingIntent: false,
		subscriptionStatus: "trialing",
		plan: "pro",
		comped: false,
		createdAt: at(-20),
		unclaimed: false,
		referralEditable: true,
		hasPaidInvoice: false,
		acquisition: { suggested: null },
		purging: false,
		marketplace: { internal: false },
		country: "MY",
		currency: "MYR",
		billingCurrency: "MYR",
		...overrides,
	};
}

const ROWS: AdminSellerRow[] = [
	seller({
		_id: "r_bear" as AdminSellerRow["_id"],
		storeName: "Bearcamp Malaysia",
		slug: "bearcamp-malaysia",
		foundingMemberRank: 1,
		subscriptionStatus: "active",
		billingCycle: "monthly",
		currentPeriodEnd: at(22),
		ownerEmail: "hello@bearcamp.example",
		waPhone: "60123456789",
		autoRenew: {
			method: "card",
			methodLabel: "Visa ·· 4242",
			attachedAt: at(-60),
		},
		lastActAsAt: at(-4),
		credits: {
			plan: 80,
			purchased: 50,
			periodKey: "2026-09",
			periodGrant: 200,
		},
	}),
	seller({
		_id: "r_lekor" as AdminSellerRow["_id"],
		storeName: "Lekor Mr.Ganu",
		slug: "lekor-mr-ganu",
		foundingMemberRank: 2,
		subscriptionStatus: "past_due",
		billingCycle: "monthly",
		ownerEmail: "lekor@example.com",
		waPhone: "60134567890",
		pendingInvoice: {
			invoiceNumber: "KP-0142",
			dueDate: at(-19),
			total: 9900,
			currency: "MYR",
			hasPayNowLink: true,
			plan: "pro",
			billingCycle: "monthly",
			kind: "plan",
		},
		credits: {
			plan: -15,
			purchased: 0,
			periodKey: "2026-09",
			periodGrant: 100,
			exhaustedAt: at(-3),
			customGrant: 150,
		},
	}),
	seller({
		_id: "r_fish" as AdminSellerRow["_id"],
		storeName: "Waa Daa Fish",
		slug: "waadaafish",
		subscriptionStatus: "trialing",
		trialEndsAt: at(6),
		waPhone: "60198765432",
	}),
	seller({
		_id: "r_admin" as AdminSellerRow["_id"],
		storeName: "Kedaipal Demo",
		slug: "kp-demo",
		ownerIsAdmin: true,
	}),
];

/** The route test's stand-in for the router: URL state in React state. */
function Harness({ initial = {} }: { initial?: SellersSearch }) {
	const [search, setSearch] = useState<SellersSearch>(initial);
	return <AdminSellersContent search={search} onSearchChange={setSearch} />;
}

function renderDirectory(
	initial?: SellersSearch,
	rows: AdminSellerRow[] = ROWS,
) {
	paged.rows = rows;
	queryData.set(getFunctionName(api.admin.devStorePurgeEnabled), true);
	return render(<Harness initial={initial} />);
}

/** Open an `OptionMenu` by its closed name ("Status: All sellers"). */
function openOptionMenu(name: RegExp | string) {
	fireEvent.click(screen.getByRole("button", { name }));
}

/** Radix opens the menu on pointerdown alone — firing Enter as well would
 * TOGGLE it straight back shut. */
function openMenu(name: RegExp | string) {
	const trigger = screen.getByRole("button", { name });
	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
	return trigger;
}

beforeEach(() => {
	mutationSpies.clear();
	navigateSpy.mockClear();
	setActAsSpy.mockClear();
	downloadCsvSpy.mockClear();
	queryData.clear();
	paged.rows = [];
	paged.status = "Exhausted";
	paged.loadMore.mockClear();
	paged.lastArgs = null;
	// The CSV walks the book through `useConvex().query`; the stand-in hands
	// back TWO rows per call whatever was asked, so a four-row export proves
	// the walk followed the cursor rather than taking the first page.
	convexQuerySpy
		.mockReset()
		.mockImplementation(async (_ref: unknown, args: PageArgs) => {
			const all = sortSellers(
				filterSellers(
					paged.rows as AdminSellerRow[],
					args.filter ?? "all",
					args.q ?? "",
				),
				args.sort ?? "founding",
			);
			const start = args.paginationOpts?.cursor
				? Number(args.paginationOpts.cursor)
				: 0;
			const page = all.slice(start, start + 2);
			const end = start + page.length;
			return { page, isDone: end >= all.length, continueCursor: String(end) };
		});
	desktop.value = true;
	vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("directory — desktop table", () => {
	it("shows every contact and billing fact on the row, each contact with its own copy control", () => {
		renderDirectory();
		const row = screen.getByRole("row", { name: /Bearcamp Malaysia/ });
		expect(within(row).getByText("hello@bearcamp.example")).toBeTruthy();
		expect(within(row).getByText("+60 12-345 6789")).toBeTruthy();
		expect(
			within(row).getByRole("button", {
				name: "Copy email hello@bearcamp.example",
			}),
		).toBeTruthy();
		expect(
			within(row).getByRole("button", {
				name: "Copy WhatsApp +60 12-345 6789",
			}),
		).toBeTruthy();
		expect(
			within(row)
				.getByRole("link", { name: /Chat on WhatsApp/ })
				.getAttribute("href"),
		).toBe("https://wa.me/60123456789");
		expect(within(row).getByText("Active")).toBeTruthy();
		expect(within(row).getByText("Pro")).toBeTruthy();
		expect(
			within(row).getByText("Monthly · auto-renew Visa ·· 4242"),
		).toBeTruthy();
		expect(within(row).getByText(/^Renews /)).toBeTruthy();
		expect(within(row).getByText("in 22 days")).toBeTruthy();
	});

	it("a missing contact says so in words and grows no buttons; a past-due row says why and how late", () => {
		renderDirectory();
		const fish = screen.getByRole("row", { name: /Waa Daa Fish/ });
		expect(within(fish).getByText("No email on file")).toBeTruthy();
		expect(
			within(fish).queryByRole("button", { name: /Copy email/ }),
		).toBeNull();
		expect(within(fish).getByText("in 6 days")).toBeTruthy();

		const lekor = screen.getByRole("row", { name: /Lekor/ });
		expect(within(lekor).getByText("Past due")).toBeTruthy();
		expect(within(lekor).getByText("KP-0142 unpaid")).toBeTruthy();
		expect(within(lekor).getByText("19 days overdue")).toBeTruthy();
		expect(within(lekor).getByText("Monthly · Pay-now link")).toBeTruthy();
	});

	it("founding rank first by default; an admin store reads Admin with no expiry", () => {
		renderDirectory();
		const names = screen
			.getAllByRole("row")
			.slice(1)
			.map((r) => r.getAttribute("data-seller"));
		expect(names).toEqual([
			"bearcamp-malaysia",
			"lekor-mr-ganu",
			"waadaafish",
			"kp-demo",
		]);
		const admin = screen.getByRole("row", { name: /Kedaipal Demo/ });
		expect(within(admin).getByText("Admin")).toBeTruthy();
		expect(within(admin).getByText("Never billed")).toBeTruthy();
	});
});

describe("directory — Status menu, Sort menu, search", () => {
	it("the Status menu carries counts over the book, Past due first in the action group, and picking one sends the filter to the query", () => {
		renderDirectory();
		openOptionMenu("Status: All sellers");
		const rows = within(screen.getByRole("dialog"))
			.getAllByRole("button")
			.filter((b) => b.hasAttribute("aria-pressed"));
		const names = rows.map((b) => b.getAttribute("aria-label"));
		expect(names[0]).toBe("All sellers, 4 sellers");
		expect(screen.getByText("Needs your action")).toBeTruthy();
		expect(names[1]).toBe("Past due, 1 seller");
		// No option vanishes at zero — a 0 is the answer to "why is it empty?".
		expect(
			screen.getByRole("button", { name: "No subscription, 0 sellers" }),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Past due, 1 seller" }));
		expect((paged.lastArgs as PageArgs).filter).toBe("past_due");
		expect(screen.getAllByRole("row")).toHaveLength(2); // header + Lekor
		expect(
			screen.getByRole("button", { name: "Status: Past due, 1 seller" }),
		).toBeTruthy();
		expect(screen.getByText("1 past due seller")).toBeTruthy();
	});

	it("the Sort menu offers exactly the three index-backed sorts and sends the pick to the query", () => {
		renderDirectory();
		openOptionMenu("Sort: Founding rank");
		const options = ["Founding rank", "Newest store", "Name A–Z"];
		for (const name of options) {
			expect(screen.getByRole("button", { name })).toBeTruthy();
		}
		expect(screen.queryByRole("button", { name: /Expiry/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Credits/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Name A–Z" }));
		expect((paged.lastArgs as PageArgs).sort).toBe("name");
		const names = screen
			.getAllByRole("row")
			.slice(1)
			.map((r) => r.getAttribute("data-seller"));
		expect(names).toEqual([
			"bearcamp-malaysia",
			"kp-demo",
			"lekor-mr-ganu",
			"waadaafish",
		]);
		expect(screen.getByRole("button", { name: "Sort: Name A–Z" })).toBeTruthy();
	});

	it("search reaches the email and the phone through the query, after the typing pauses", async () => {
		renderDirectory();
		const box = screen.getByLabelText("Search sellers");
		fireEvent.change(box, { target: { value: "hello@bearcamp" } });
		// The URL has it at once; the query waits for the debounce.
		expect((paged.lastArgs as PageArgs).q).toBe("");
		expect(screen.getByText("Searching…")).toBeTruthy();
		await waitFor(() =>
			expect((paged.lastArgs as PageArgs).q).toBe("hello@bearcamp"),
		);
		expect(screen.getAllByRole("row")).toHaveLength(2);
		expect(screen.getByRole("row", { name: /Bearcamp/ })).toBeTruthy();
		expect(screen.getByText("1 match")).toBeTruthy();
		fireEvent.change(box, { target: { value: "+60 19-876" } });
		await waitFor(() =>
			expect(screen.getByRole("row", { name: /Waa Daa Fish/ })).toBeTruthy(),
		);
		expect(screen.getAllByRole("row")).toHaveLength(2);
	});

	// z8r3fdtk87: a hand-typed or shared `?q=9981` reaches validateSearch as
	// the NUMBER 9981 (TanStack JSON-parses the URL), and a key the validator
	// left out leaked that number to `q.trim()` — "Something went wrong". The
	// router-merge half is pinned in src/lib/search-params.test.tsx and swept
	// for every route in search-params-sweep.test.ts.
	it("a numeric ?q= from a pasted link is read as text, and junk closes every key", () => {
		const validate = (
			Route as unknown as {
				validateSearch: (s: Record<string, unknown>) => SellersSearch;
			}
		).validateSearch;
		expect(validate({ q: 9981 })).toEqual({ q: "9981" });
		const junk = validate({ q: [1], status: 7, sort: true });
		expect(junk).toEqual({});
		for (const key of ["q", "status", "sort"]) {
			expect(Object.hasOwn(junk, key)).toBe(true);
		}
		// The two retired sorts in an old link fall back to the default.
		expect(validate({ sort: "expiry" })).toEqual({});
		expect(validate({ sort: "credits" })).toEqual({});
	});

	it("an all-digit query from a link is sent at once and finds the slug, the name and the phone that carry it", () => {
		const yuzu = seller({
			_id: "r_yuzu" as AdminSellerRow["_id"],
			storeName: "Yuzu Bakes",
			slug: "9981yuzu",
		});
		const named = seller({
			_id: "r_named" as AdminSellerRow["_id"],
			storeName: "Kedai 9981",
			slug: "kedai-lama",
		});
		const phoned = seller({
			_id: "r_phoned" as AdminSellerRow["_id"],
			storeName: "Pak Ali Satay",
			slug: "pak-ali",
			notifyWaPhone: "60129981234",
		});
		renderDirectory({ q: "9981" }, [...ROWS, yuzu, named, phoned]);
		expect((paged.lastArgs as PageArgs).q).toBe("9981");
		// Header row + the three matches; nothing else carries 9981.
		expect(screen.getAllByRole("row")).toHaveLength(4);
		for (const name of [/Yuzu Bakes/, /Kedai 9981/, /Pak Ali Satay/]) {
			expect(screen.getByRole("row", { name })).toBeTruthy();
		}
		expect(screen.getByText("End of results for “9981”")).toBeTruthy();
	});

	it("no matches names the filter that is hiding the rest and clears it in one tap", async () => {
		renderDirectory({ status: "past_due", q: "kuih" });
		expect(screen.getByText("No past due sellers match “kuih”")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Clear search and filters" }),
		);
		// The filter clears at once; the search clears when the debounce fires.
		await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(5));
		expect(
			screen.getByRole("button", { name: "Status: All sellers" }),
		).toBeTruthy();
	});

	it("Export CSV walks EVERY page of the current filter, and is disabled-with-reason when nothing matches", async () => {
		renderDirectory({ status: "active" }, [
			...ROWS,
			seller({
				_id: "r_a2" as AdminSellerRow["_id"],
				storeName: "Second Active",
				slug: "second-active",
				subscriptionStatus: "active",
				ownerEmail: "second@active.example",
			}),
			seller({
				_id: "r_a3" as AdminSellerRow["_id"],
				storeName: "Third Active",
				slug: "third-active",
				subscriptionStatus: "active",
				ownerEmail: "third@active.example",
			}),
		]);
		fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
		await waitFor(() => expect(downloadCsvSpy).toHaveBeenCalledTimes(1));
		// Three active rows at two per server page = two calls, cursor threaded.
		expect(convexQuerySpy).toHaveBeenCalledTimes(2);
		expect(
			(convexQuerySpy.mock.calls[1]?.[1] as PageArgs).paginationOpts?.cursor,
		).toBe("2");
		expect((convexQuerySpy.mock.calls[0]?.[1] as PageArgs).filter).toBe(
			"active",
		);
		const [filename, csv] = downloadCsvSpy.mock.calls[0] as [string, string];
		expect(filename).toBe("kedaipal-sellers-2026-09-22.csv");
		expect(csv.split("\r\n")).toHaveLength(4);
		expect(csv).toContain("hello@bearcamp.example");
		expect(csv).toContain("third@active.example");
		expect(csv).not.toContain("lekor@example.com");

		cleanup();
		renderDirectory({ status: "cancelled" });
		const button = screen.getByRole("button", { name: /Export CSV/ });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("title")).toMatch(/no rows match/);
	});
});

describe("directory — infinite scroll", () => {
	it("a page that can load more shows the Load more fallback, which asks for the next page", () => {
		paged.status = "CanLoadMore";
		renderDirectory();
		const button = screen.getByRole("button", { name: "Load more" });
		expect(
			screen.getByText(`Scroll or press to load the next ${PAGE_SIZE}`),
		).toBeTruthy();
		fireEvent.click(button);
		expect(paged.loadMore).toHaveBeenCalledWith(PAGE_SIZE);
	});

	it("while the next page loads the rows stay and skeletons follow them; at the end the list says so with the count", () => {
		paged.status = "LoadingMore";
		renderDirectory();
		expect(screen.getAllByRole("row")).toHaveLength(5);
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(
			screen.getByText(`Loading the next ${PAGE_SIZE} sellers…`),
		).toBeTruthy();
		cleanup();
		paged.status = "Exhausted";
		renderDirectory();
		expect(screen.getByText("That’s every seller · 4")).toBeTruthy();
		cleanup();
		renderDirectory({ status: "past_due" });
		expect(screen.getByText("That’s every past due sellers · 1")).toBeTruthy();
	});

	it("a new search keeps the last rows on screen, dimmed and busy, instead of blanking to skeletons", async () => {
		renderDirectory();
		expect(screen.getAllByRole("row")).toHaveLength(5);
		// The server is now answering a new first page.
		paged.status = "LoadingFirstPage";
		fireEvent.change(screen.getByLabelText("Search sellers"), {
			target: { value: "bear" },
		});
		await waitFor(() => expect((paged.lastArgs as PageArgs).q).toBe("bear"));
		const table = screen.getByRole("table");
		expect(screen.getAllByRole("row")).toHaveLength(5);
		expect(table.closest("[aria-busy='true']")).not.toBeNull();
		expect(
			screen.getByRole("progressbar", { name: "Loading sellers" }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
	});

	it("the very first load shows skeletons, never a false empty state", () => {
		paged.status = "LoadingFirstPage";
		renderDirectory();
		expect(screen.queryByRole("table")).toBeNull();
		expect(screen.queryByText(/No sellers/)).toBeNull();
		expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
		expect(
			screen.getByRole("button", { name: /Export CSV/ }).getAttribute("title"),
		).toBe("Still loading");
	});
});

describe("directory — detail sheet", () => {
	it("the store name opens a read-only sheet with every fact copyable and a Copy summary", async () => {
		renderDirectory();
		fireEvent.click(screen.getByRole("button", { name: "Bearcamp Malaysia" }));
		const sheet = await screen.findByRole("dialog");
		expect(
			within(sheet).getByRole("heading", { name: "Bearcamp Malaysia" }),
		).toBeTruthy();
		// No alerts number on this row: the line says so rather than vanishing.
		expect(within(sheet).getByText("Order alerts to")).toBeTruthy();
		expect(within(sheet).getByText("No WhatsApp on file")).toBeTruthy();
		expect(
			within(sheet).getByText(
				"kedaipal.com/bearcamp-malaysia".replace(
					"kedaipal.com",
					window.location.host,
				),
			),
		).toBeTruthy();
		expect(
			within(sheet).getByRole("button", { name: "Copy storefront link" }),
		).toBeTruthy();
		expect(
			within(sheet).getByRole("button", { name: /Copy a summary of Bearcamp/ }),
		).toBeTruthy();
		expect(within(sheet).getByText("Visa ·· 4242")).toBeTruthy();
		expect(within(sheet).getByText("Never paid")).toBeTruthy();
		expect(within(sheet).getByText(/4 days ago/)).toBeTruthy(); // last act-as
		// Opening the sheet entered nothing.
		expect(setActAsSpy).not.toHaveBeenCalled();

		// Its primary button IS the act-as door.
		fireEvent.click(within(sheet).getByRole("button", { name: "Open store" }));
		expect(setActAsSpy).toHaveBeenCalledWith("r_bear");
		expect(startActAsSpy()).toHaveBeenCalledWith({ retailerId: "r_bear" });
		expect(navigateSpy).toHaveBeenCalledWith({ to: "/app" });
	});

	it("a contract's allowances read on the sheet, not only inside the edit form", async () => {
		// A negotiated term the summary hides is a term the next admin
		// discovers by hitting it (z8r3fdkp8h seats/broadcasts).
		paged.rows = [
			seller({
				_id: "r_hsl" as AdminSellerRow["_id"],
				storeName: "Mama's Delights",
				slug: "mamas-delights",
				subscriptionStatus: "active",
				plan: "enterprise",
				billingCycle: "monthly",
				enterprise: {
					baseFeeMinor: 88_800,
					currency: "MYR",
					includedCredits: 1500,
					overageRateMinor: 60,
					blockSize: 5000,
					teammates: 12,
					broadcastQuota: 500,
					contactName: "HSL Food GM",
					setAt: at(-1),
				},
			}),
			seller({
				_id: "r_unl" as AdminSellerRow["_id"],
				storeName: "Unlimited Deal",
				slug: "unlimited-deal",
				subscriptionStatus: "active",
				plan: "enterprise",
				billingCycle: "monthly",
				enterprise: {
					baseFeeMinor: 120_000,
					currency: "MYR",
					includedCredits: 2000,
					overageRateMinor: 50,
					blockSize: 5000,
					contactName: "Someone",
					setAt: at(-1),
				},
			}),
		];
		queryData.set(getFunctionName(api.admin.devStorePurgeEnabled), false);
		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Mama's Delights" }));
		let sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText(/12 teammates \+ the owner/)).toBeTruthy();
		expect(within(sheet).getByText(/500 broadcasts\/mo/)).toBeTruthy();
		fireEvent.keyDown(document.body, { key: "Escape" });

		// A deal that names no allowances reads the tier's unlimited, and says
		// nothing about broadcasts it never negotiated.
		fireEvent.click(screen.getByRole("button", { name: "Unlimited Deal" }));
		sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText("Unlimited teammates")).toBeTruthy();
		expect(within(sheet).queryByText(/broadcasts\/mo/)).toBeNull();
	});

	it("an open Enterprise ask reads on the sheet and dismisses in place; the chip filters to it", async () => {
		// The lead exists so an ask can't be forgotten (z8r3fdkp8h follow-up):
		// a chip in the owes-action front group, and the answer (contract or
		// dismiss) right where the admin already works.
		paged.rows = [
			ROWS[0],
			seller({
				_id: "r_lead" as AdminSellerRow["_id"],
				storeName: "Mama's Delights",
				slug: "mamas-delights",
				subscriptionStatus: "trialing",
				enterpriseInterestAt: at(-3),
			}),
		];
		queryData.set(getFunctionName(api.admin.devStorePurgeEnabled), false);
		render(<Harness initial={{ status: "wants_enterprise" }} />);

		// The Status trigger carries the count and the filter shows only the ask.
		expect(
			screen.getByRole("button", {
				name: "Status: Wants Enterprise, 1 seller",
			}),
		).toBeTruthy();
		expect(screen.getByText("Mama's Delights")).toBeTruthy();
		expect(screen.queryByText("Bearcamp Malaysia")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Mama's Delights" }));
		const sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText("Wants Enterprise")).toBeTruthy();
		expect(within(sheet).getByText(/3 days ago/)).toBeTruthy();
		fireEvent.click(within(sheet).getByRole("button", { name: "Dismiss" }));
		expect(
			mutationSpies.get(getFunctionName(api.enterprise.dismissInterest)),
		).toHaveBeenCalledWith({ retailerId: "r_lead" });
	});
});

describe("directory — phone", () => {
	it("renders cards instead of a table, with 44px copy targets", () => {
		desktop.value = false;
		renderDirectory();
		expect(screen.queryByRole("table")).toBeNull();
		expect(screen.getAllByRole("listitem")).toHaveLength(4);
		const copy = screen.getByRole("button", {
			name: "Copy email hello@bearcamp.example",
		});
		expect(copy.className).toMatch(/h-11/);
	});
});

// ---------------------------------------------------------------------------
// SellerCard — one Manage menu per row (owner decision, 20 Sep 2026)
// ---------------------------------------------------------------------------

function renderCard(row: AdminSellerRow, purgeEnabled = false) {
	const onViewDetails = vi.fn();
	render(
		<ul>
			<SellerCard
				seller={row}
				purgeEnabled={purgeEnabled}
				onViewDetails={onViewDetails}
				now={NOW}
			/>
		</ul>,
	);
	return { onViewDetails };
}

describe("SellerCard — Store highlights at a glance (z8r3fdkmyp)", () => {
	it("a live paid window shows a Highlight pill naming its last day", () => {
		const until = NOW + 7 * 24 * 60 * 60 * 1000;
		renderCard(
			seller({ marketplace: { sponsoredUntil: until, internal: false } }),
		);
		const pill = screen.getByText(/^Highlight · to /);
		// Full date (with year) in the tooltip; day + month on the pill.
		expect(pill.getAttribute("title")).toBe(
			`On Store highlights through ${formatShortDate(until - 1)}`,
		);
	});

	it("a comped Sponsor store shows 'Highlight · comped' with no window set", () => {
		renderCard(
			seller({
				comped: true,
				comp: { kind: "sponsor", label: "Sponsored by Kedaipal", grantedAt: 0 },
			}),
		);
		expect(screen.getByText("Highlight · comped")).toBeTruthy();
	});

	it("nothing for an expired window, a kept-off comp, or an internal store", () => {
		renderCard(
			seller({ marketplace: { sponsoredUntil: NOW - 1, internal: false } }),
		);
		expect(screen.queryByText(/^Highlight/)).toBeNull();
		cleanup();
		renderCard(
			seller({
				comped: true,
				comp: { kind: "partner", grantedAt: 0 },
				marketplace: { compHighlightOffAt: NOW - 1, internal: false },
			}),
		);
		expect(screen.queryByText(/^Highlight/)).toBeNull();
		cleanup();
		renderCard(
			seller({
				comped: true,
				comp: { kind: "internal", grantedAt: 0 },
				marketplace: { internal: true },
			}),
		);
		expect(screen.queryByText(/^Highlight/)).toBeNull();
	});

	it("hidden by an admin: 'Hidden from /stores' — and it outranks a live highlight", () => {
		renderCard(
			seller({
				marketplace: {
					hidden: { at: at(-2) },
					sponsoredUntil: at(7),
					internal: false,
				},
			}),
		);
		expect(screen.getByText("Hidden from /stores").getAttribute("title")).toBe(
			`Hidden from /stores by an admin since ${formatShortDate(at(-2))}`,
		);
		expect(screen.queryByText(/^Highlight/)).toBeNull();
	});
});

describe("SellerCard — hide from /stores (z8r3fdkmyp)", () => {
	const hideSpy = () =>
		mutationSpies.get(getFunctionName(api.admin.hideFromMarketplace));
	const showSpy = () =>
		mutationSpies.get(getFunctionName(api.admin.showOnMarketplace));

	it("hiding goes through a confirm that names the consequence, with the optional note", async () => {
		renderCard(seller());
		openMenu(/Manage Mak Kuih/);
		expect(screen.getByText(/storefront and orders unaffected/)).toBeTruthy();
		fireEvent.click(screen.getByText("Hide from /stores"));
		expect(await screen.findByText("Hide Mak Kuih from /stores?")).toBeTruthy();
		expect(
			screen.getByText(/whatever the seller's own switch says/),
		).toBeTruthy();
		expect(hideSpy()).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText(/Note to the seller/), {
			target: { value: "  Add real photos.  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Hide from /stores" }));
		await waitFor(() =>
			expect(hideSpy()).toHaveBeenCalledWith({
				retailerId: "r_comp",
				note: "Add real photos.",
			}),
		);
	});

	it("a hidden store's item says since when, pauses its highlight, and shows it again in one click", () => {
		renderCard(
			seller({
				comped: true,
				comp: { kind: "sponsor", grantedAt: 0 },
				marketplace: { hidden: { at: at(-3) }, internal: false },
			}),
		);
		openMenu(/Manage Mak Kuih/);
		expect(
			screen.getByText(`Hidden since ${formatShortDate(at(-3))}`),
		).toBeTruthy();
		// The highlight keeps its setting but must not read as featured.
		expect(screen.getByText("Paused while hidden from /stores")).toBeTruthy();
		expect(screen.queryByText(/While comped/)).toBeNull();
		fireEvent.click(screen.getByText("Show on /stores again"));
		expect(showSpy()).toHaveBeenCalledWith({ retailerId: "r_comp" });
	});

	it("an internal store: disabled, with the reason in place", () => {
		renderCard(seller({ marketplace: { internal: true } }));
		openMenu(/Manage Mak Kuih/);
		const item = screen
			.getByText("Hide from /stores")
			.closest('[role="menuitem"]');
		expect(item?.getAttribute("aria-disabled")).toBe("true");
		expect(
			screen.getByText("Internal store — never listed anyway"),
		).toBeTruthy();
	});
});

describe("SellerCard — the Manage menu", () => {
	it("one door: nothing on the row enters act-as; the name opens details, the rest are copy controls", () => {
		const { onViewDetails } = renderCard(
			seller({ ownerEmail: "mak@example.com", waPhone: "60111111111" }),
			true,
		);
		const names = screen
			.getAllByRole("button")
			.map((b) => b.getAttribute("aria-label") ?? b.textContent);
		for (const n of names) {
			expect(n).toMatch(/^(Mak Kuih|Manage Mak Kuih|Copy )/);
		}
		fireEvent.click(screen.getByRole("button", { name: "Mak Kuih" }));
		expect(onViewDetails).toHaveBeenCalledTimes(1);
		expect(setActAsSpy).not.toHaveBeenCalled();

		openMenu(/Manage Mak Kuih/);
		expect(screen.getByText("Open store")).toBeTruthy();
		expect(screen.getByText(/Act-as mode/)).toBeTruthy();
		expect(screen.getByText("View details")).toBeTruthy();
		expect(screen.getByText("Turn on comp upgrade")).toBeTruthy();
		expect(screen.getByText(/never billed/)).toBeTruthy();
		expect(screen.getByText("Delete store")).toBeTruthy();
		expect(screen.getByText(/Dev only/)).toBeTruthy();
	});

	it("Open store enters act-as: session started, audit fired, dashboard opened", () => {
		renderCard(seller());
		openMenu(/Manage Mak Kuih/);
		fireEvent.click(screen.getByText("Open store"));
		expect(setActAsSpy).toHaveBeenCalledWith("r_comp");
		expect(startActAsSpy()).toHaveBeenCalledWith({ retailerId: "r_comp" });
		expect(navigateSpy).toHaveBeenCalledWith({ to: "/app" });
	});

	it("the comp item opens the comp dialog, worded for the toggle's position", async () => {
		renderCard(seller());
		openMenu(/Manage Mak Kuih/);
		fireEvent.click(screen.getByText("Turn on comp upgrade"));
		expect(await screen.findByText("Comp upgrade — Mak Kuih")).toBeTruthy();
		// A comped row's item reads as the edit door instead.
		cleanup();
		renderCard(
			seller({
				comped: true,
				subscriptionStatus: "active",
				comp: {
					kind: "sponsor",
					label: "Sponsored by Bearcamp",
					grantedAt: new Date(2026, 8, 14).getTime(),
				},
			}),
		);
		openMenu(/Manage Mak Kuih/);
		expect(screen.getByText("Comp upgrade — on")).toBeTruthy();
		expect(screen.getByText(/turn it off/)).toBeTruthy();
	});

	it("an admin-owned store: comp disabled with the reason readable in place, not behind a hover", () => {
		renderCard(seller({ ownerIsAdmin: true }));
		openMenu(/Manage Mak Kuih/);
		const item = screen
			.getByText("Turn on comp upgrade")
			.closest('[role="menuitem"]');
		expect(item?.getAttribute("aria-disabled")).toBe("true");
		expect(screen.getByText("Admin store — always free already")).toBeTruthy();
	});

	it("Delete store exists only where the dev purge is enabled, and goes through the slug confirm", async () => {
		renderCard(seller(), false);
		openMenu(/Manage Mak Kuih/);
		expect(screen.queryByText("Delete store")).toBeNull();
		cleanup();

		renderCard(seller(), true);
		openMenu(/Manage Mak Kuih/);
		fireEvent.click(screen.getByText("Delete store"));
		expect(await screen.findByText("Delete Mak Kuih?")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete store" })).toBeTruthy();
	});

	it("a purging row shows Deleting… and no Manage door", () => {
		renderCard(seller({ purging: true }), true);
		expect(screen.getByText("Deleting…")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Manage/ })).toBeNull();
	});
});

/**
 * Kedaipal Credits T5: the directory reads each store's credits, sorts the
 * owing ones to the top, and the sheet opens the full ledger drawer.
 */
describe("directory — credits", () => {
	it("the row reads each store's credits: left, owed with since-when, or no account yet", () => {
		renderDirectory();
		const row = (slug: string) =>
			screen
				.getAllByRole("row")
				.find((r) => r.getAttribute("data-seller") === slug) as HTMLElement;
		expect(within(row("bearcamp-malaysia")).getByText("130 left")).toBeTruthy();
		expect(within(row("lekor-mr-ganu")).getByText("15 owed")).toBeTruthy();
		expect(within(row("lekor-mr-ganu")).getByText(/Out since/)).toBeTruthy();
		expect(
			within(row("waadaafish")).getByText("No credit account yet"),
		).toBeTruthy();
	});

	it("the sheet's Credits section names the custom grant and opens the ledger as a page of the same drawer", async () => {
		renderDirectory();
		fireEvent.click(screen.getByRole("button", { name: "Lekor Mr.Ganu" }));
		const sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText("150 a month")).toBeTruthy();
		expect(within(sheet).getByText(/Sep 2026/)).toBeTruthy();
		fireEvent.click(
			within(sheet).getByRole("button", { name: "Open credit ledger" }),
		);
		expect(
			await screen.findByRole("heading", { name: "Credit ledger" }),
		).toBeTruthy();
		// One drawer — never a second one stacked on the seller's.
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
		// The way back names the seller and returns focus to what opened it.
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Lekor Mr.Ganu",
			}),
		);
		const reopen = await screen.findByRole("button", {
			name: "Open credit ledger",
		});
		expect(document.activeElement).toBe(reopen);
	});

	it("the CSV carries the credit columns", async () => {
		renderDirectory();
		fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
		await waitFor(() => expect(downloadCsvSpy).toHaveBeenCalledTimes(1));
		const csv = downloadCsvSpy.mock.calls[0]?.[1] as string;
		const [header] = csv.split("\r\n");
		for (const column of [
			"Credits left",
			"Plan credits",
			"Extra credits",
			"Out of credits since",
			"Custom grant",
		])
			expect(header).toContain(column);
	});
});

describe("the directory's count reads the whole book, and says when it couldn't", () => {
	it("counts plainly from the counts query", () => {
		renderDirectory();
		expect(screen.getByText("4 sellers")).toBeTruthy();
		expect(screen.queryByText(/counted over the newest/)).toBeNull();
	});

	it("names the scan ceiling beside the count and above the list when the counts are capped", () => {
		queryData.set(getFunctionName(api.adminSellers.countSellerBuckets), {
			counts: {
				...Object.fromEntries(
					[
						"all",
						"past_due",
						"unclaimed",
						"trialing",
						"active",
						"on_hold",
						"cancelled",
						"comped",
						"admin",
						"none",
						"wants_enterprise",
						"unavailable",
						"untagged_payers",
					].map((k) => [k, 0]),
				),
				all: 2000,
				trialing: 2000,
			},
			capped: true,
		});
		renderDirectory();
		expect(
			screen.getByText(/2,000 sellers · counted over the newest 2,000/),
		).toBeTruthy();
		expect(
			screen.getByText(/Counts cover the newest 2,000 stores/),
		).toBeTruthy();
	});

	it("says Counting… while the counts are still on their way, never a zero", () => {
		queryData.set(
			getFunctionName(api.adminSellers.countSellerBuckets),
			undefined,
		);
		renderDirectory();
		expect(screen.getByText("Counting…")).toBeTruthy();
		openOptionMenu("Status: All sellers");
		expect(screen.getByRole("button", { name: "All sellers" })).toBeTruthy();
	});
});
