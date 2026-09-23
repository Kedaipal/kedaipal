// @vitest-environment jsdom
// The admin seller directory (z8r3fdh37c): status chips that filter and
// count, a sort menu, search across contact facts, the desktop table vs the
// phone cards, the read-only detail sheet with its copy controls, the CSV
// export, and the one-door Manage menu (owner decision, 20 Sep 2026).
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";

const { navigateSpy, setActAsSpy, downloadCsvSpy, desktop } = vi.hoisted(
	() => ({
		navigateSpy: vi.fn(),
		setActAsSpy: vi.fn(),
		downloadCsvSpy: vi.fn(),
		desktop: { value: true },
	}),
);
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
vi.mock("@tanstack/react-query", () => ({
	useQuery: (q: { __fn: FunctionReference<"query"> }) => ({
		data: queryData.get(getFunctionName(q.__fn)),
	}),
}));
vi.mock("../hooks/useActAs", () => ({
	useActAs: () => ({ setActAs: setActAsSpy }),
}));
vi.mock("../hooks/useIsDesktop", () => ({
	useIsDesktop: () => desktop.value,
}));
vi.mock("../lib/download", () => ({ downloadCsv: downloadCsvSpy }));

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
vi.mock("convex/react", () => ({
	useMutation: (ref: FunctionReference<"mutation">) => {
		const name = getFunctionName(ref);
		if (!mutationSpies.has(name)) {
			mutationSpies.set(name, vi.fn().mockResolvedValue({ ok: true }));
		}
		return mutationSpies.get(name);
	},
}));

import { SellerCard } from "../components/admin/seller-card";
import { AdminSellersContent, type SellersSearch } from "./app.admin.sellers";

const startActAsSpy = () =>
	mutationSpies.get(getFunctionName(api.admin.startActAsSession));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 22, 12).getTime();
const at = (days: number) => NOW + days * DAY;

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_comp" as AdminSellerRow["_id"],
		storeName: "Mak Kuih",
		slug: "mak-kuih",
		ownerUserId: "u_owner",
		ownerIsAdmin: false,
		isFoundingMember: false,
		subscriptionStatus: "trialing",
		plan: "pro",
		comped: false,
		createdAt: at(-20),
		purging: false,
		country: "MY",
		currency: "MYR",
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

function renderDirectory(initial?: SellersSearch) {
	queryData.set(getFunctionName(api.admin.listSellersForAdmin), ROWS);
	queryData.set(getFunctionName(api.admin.devStorePurgeEnabled), true);
	return render(<Harness initial={initial} />);
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

describe("directory — chips, sort, search", () => {
	it("chips carry counts, Past due sits first after All, and picking one filters the rows", () => {
		renderDirectory();
		const chips = Array.from(
			document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
		);
		const labels = chips.map((b) => b.textContent);
		expect(labels[0]).toBe("All4");
		expect(labels[1]).toBe("Past due1");
		expect(chips[0].getAttribute("aria-pressed")).toBe("true");
		expect(
			screen.queryByRole("button", { name: /No subscription/ }),
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /^Past due/ }));
		expect(
			screen
				.getByRole("button", { name: /^Past due/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getAllByRole("row")).toHaveLength(2); // header + Lekor
		expect(screen.getByText("Showing 1 of 4")).toBeTruthy();
	});

	it("sort by expiry puts the soonest deadline first and dateless rows last", () => {
		renderDirectory();
		openMenu(/^Sort: Founding rank/);
		fireEvent.click(screen.getByRole("menuitemradio", { name: /Expiry/ }));
		const names = screen
			.getAllByRole("row")
			.slice(1)
			.map((r) => r.getAttribute("data-seller"));
		// Lekor's bill was due 19 days ago, Fish's trial ends in 6, Bearcamp
		// renews in 22, the admin store has no date.
		expect(names).toEqual([
			"lekor-mr-ganu",
			"waadaafish",
			"bearcamp-malaysia",
			"kp-demo",
		]);
		expect(screen.getByRole("button", { name: /^Sort: Expiry/ })).toBeTruthy();
	});

	it("search reaches the email and the phone, not just the name", () => {
		renderDirectory();
		const box = screen.getByLabelText("Search sellers");
		fireEvent.change(box, { target: { value: "hello@bearcamp" } });
		expect(screen.getAllByRole("row")).toHaveLength(2);
		expect(screen.getByRole("row", { name: /Bearcamp/ })).toBeTruthy();
		fireEvent.change(box, { target: { value: "+60 19-876" } });
		expect(screen.getByRole("row", { name: /Waa Daa Fish/ })).toBeTruthy();
		expect(screen.getAllByRole("row")).toHaveLength(2);
	});

	it("no matches names the filter that is hiding the rest and clears it in one tap", () => {
		renderDirectory({ status: "past_due", q: "kuih" });
		expect(screen.getByText("No past due sellers match “kuih”")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Clear search and filters" }),
		);
		expect(screen.getAllByRole("row")).toHaveLength(5);
		expect(
			screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("Export CSV writes the visible rows and is disabled-with-reason when nothing matches", () => {
		renderDirectory({ status: "active" });
		fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
		expect(downloadCsvSpy).toHaveBeenCalledTimes(1);
		const [filename, csv] = downloadCsvSpy.mock.calls[0] as [string, string];
		expect(filename).toBe("kedaipal-sellers-2026-09-22.csv");
		expect(csv.split("\r\n")).toHaveLength(2);
		expect(csv).toContain("hello@bearcamp.example");
		expect(csv).not.toContain("lekor@example.com");

		cleanup();
		renderDirectory({ status: "cancelled" });
		const button = screen.getByRole("button", { name: /Export CSV/ });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("title")).toMatch(/no rows match/);
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
