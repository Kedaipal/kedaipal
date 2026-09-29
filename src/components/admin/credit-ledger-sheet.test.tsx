// @vitest-environment jsdom
// The admin credit ledger drawer (Kedaipal Credits T5): its states (loading,
// no account yet, out of credits, lots), the two levers — adjust and the
// custom monthly grant — each disabled with its reason until it's valid, and
// the paginated ledger with admin notes. The server re-checks everything;
// these pin what the admin is told before the tap.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";

const state = vi.hoisted(() => ({
	account: undefined as unknown,
	ledger: {
		results: [] as unknown[],
		status: "Exhausted" as string,
		loadMore: (() => {}) as (n: number) => void,
	},
	adjust: (async () => ({ plan: 0, purchased: 0 })) as (
		args: unknown,
	) => Promise<unknown>,
	grant: (async () => ({ plan: 0, periodGrant: 0 })) as (
		args: unknown,
	) => Promise<unknown>,
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.account }),
}));
vi.mock("convex/react", () => ({
	usePaginatedQuery: () => state.ledger,
	useMutation: (ref: FunctionReference<"mutation">) =>
		getFunctionName(ref) === getFunctionName(api.credits.adminAdjust)
			? state.adjust
			: state.grant,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreditLedgerBody, ledgerRowLabel } from "./credit-ledger-sheet";

// The body renders the Sheet's header parts, which need their Radix dialog
// context — render it inside an open Sheet like the real drawer does.
import { Sheet, SheetContent } from "../ui/sheet";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 10, 12).getTime();

const seller = {
	_id: "r_lekor",
	storeName: "Lekor Mr.Ganu",
} as unknown as AdminSellerRow;

function view(overrides: Record<string, unknown> = {}) {
	return {
		plan: 80,
		purchased: 50,
		total: 130,
		periodKey: "2026-10",
		periodGrant: 200,
		regime: "monthly",
		nextGrant: 200,
		refreshesAt: NOW + 21 * DAY,
		nextExpiry: { credits: 50, at: NOW + 300 * DAY },
		exhaustedAt: null,
		sellerRefundsLeft: 10,
		customGrant: false,
		...overrides,
	};
}

function renderBody() {
	return render(
		<Sheet open>
			<SheetContent>
				<CreditLedgerBody seller={seller} />
			</SheetContent>
		</Sheet>,
	);
}

beforeEach(() => {
	vi.spyOn(Date, "now").mockReturnValue(NOW);
	state.account = {
		view: view(),
		account: { _id: "a1", grantOverride: undefined },
		lots: [
			{
				_id: "lot1",
				credits: 50,
				remaining: 50,
				expiresAt: NOW + 300 * DAY,
			},
		],
	};
	state.ledger = { results: [], status: "Exhausted", loadMore: vi.fn() };
	state.adjust = vi.fn(async () => ({ plan: 130, purchased: 50 }));
	state.grant = vi.fn(async () => ({ plan: 800, periodGrant: 1000 }));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("CreditLedgerBody — balances", () => {
	it("shows a skeleton while the account loads", () => {
		state.account = undefined;
		renderBody();
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
	});

	it("reads the balance, the month's grant and the open lots", () => {
		renderBody();
		expect(screen.getByText("130 left")).toBeTruthy();
		expect(screen.getByText(/Plan 80 · bought 50/)).toBeTruthy();
		expect(screen.getByText(/Oct 2026 · 200 granted/)).toBeTruthy();
		expect(screen.getByText("50 of 50")).toBeTruthy();
	});

	it("an owing store reads its debt and since when", () => {
		state.account = {
			view: view({
				plan: -15,
				purchased: 0,
				total: -15,
				exhaustedAt: NOW - 3 * DAY,
			}),
			account: { _id: "a1" },
			lots: [],
		};
		renderBody();
		expect(screen.getByText("15 owed")).toBeTruthy();
		expect(screen.getByText(/out since/)).toBeTruthy();
	});

	it("a store with no account yet is told what it's looking at", () => {
		state.account = { view: view(), account: null, lots: [] };
		renderBody();
		expect(screen.getByText(/No credit account yet/)).toBeTruthy();
	});
});

describe("CreditLedgerBody — adjust by hand", () => {
	it("says the note is admin-only and never shown to the seller", () => {
		renderBody();
		expect(
			screen.getByText(
				/Admin-only: kept on the store's ledger, never shown to the seller/,
			),
		).toBeTruthy();
	});

	it("is disabled with its reason until the amount and the note are valid", () => {
		renderBody();
		const amount = screen.getByLabelText("Credits");
		fireEvent.change(amount, { target: { value: "2.5" } });
		expect(screen.getByText(/whole numbers/)).toBeTruthy();
		fireEvent.change(amount, { target: { value: "50" } });
		expect(screen.getByText("Add a note saying why.")).toBeTruthy();
		const button = screen.getByRole("button", { name: "Add 50 plan credits" });
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it("never offers to take away more bought credits than the store holds", () => {
		renderBody();
		fireEvent.click(screen.getByRole("button", { name: "Bought credits" }));
		fireEvent.change(screen.getByLabelText("Credits"), {
			target: { value: "-80" },
		});
		expect(screen.getByText(/holds 50 bought credits/)).toBeTruthy();
	});

	it("sends bucket, whole amount and note — and names the action by its consequence", async () => {
		renderBody();
		fireEvent.click(screen.getByRole("button", { name: "Bought credits" }));
		fireEvent.change(screen.getByLabelText("Credits"), {
			target: { value: "50" },
		});
		fireEvent.change(screen.getByLabelText("Note"), {
			target: { value: "Goodwill for the outage" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Add 50 bought credits" }),
		);
		expect(state.adjust).toHaveBeenCalledWith({
			retailerId: "r_lekor",
			bucket: "purchased",
			amount: 50,
			note: "Goodwill for the outage",
		});
	});
});

describe("CreditLedgerBody — custom monthly grant", () => {
	it("sets a whole-number grant, and says what a clear does", async () => {
		renderBody();
		fireEvent.change(screen.getByLabelText("Credits a month"), {
			target: { value: "1000" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set 1000 a month" }));
		expect(state.grant).toHaveBeenCalledWith({
			retailerId: "r_lekor",
			grant: 1000,
		});
	});

	it("a store with a custom grant can clear it back to the plan's", () => {
		state.account = {
			view: view({ customGrant: true }),
			account: { _id: "a1", grantOverride: 1000 },
			lots: [],
		};
		renderBody();
		expect(screen.getByText("1000 a month")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Clear — use the plan's grant" }),
		);
		expect(state.grant).toHaveBeenCalledWith({
			retailerId: "r_lekor",
			grant: null,
		});
	});
});

describe("CreditLedgerBody — the ledger", () => {
	it("an empty ledger says so", () => {
		renderBody();
		expect(screen.getByText(/No credit movements yet/)).toBeTruthy();
	});

	it("lists movements with their admin notes, and loads older ones on demand", () => {
		state.ledger = {
			status: "CanLoadMore",
			loadMore: vi.fn(),
			results: [
				{
					_id: "l1",
					type: "adjust",
					bucket: "purchased",
					amount: 50,
					reason: "adjust",
					note: "Goodwill for the outage",
					periodKey: "2026-10",
					createdBy: "admin",
					planAfter: 80,
					purchasedAfter: 50,
					createdAt: NOW - DAY,
				},
				{
					_id: "l2",
					type: "debit",
					bucket: "plan",
					amount: -1,
					reason: "order",
					refLabel: "ORD-7Q2K",
					periodKey: "2026-10",
					createdBy: "system",
					planAfter: 80,
					purchasedAfter: 0,
					createdAt: NOW - 2 * DAY,
				},
			],
		};
		renderBody();
		expect(screen.getByText("Goodwill for the outage")).toBeTruthy();
		expect(screen.getByText("ORD-7Q2K")).toBeTruthy();
		expect(screen.getByText("+50")).toBeTruthy();
		expect(screen.getByText("−1")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Show older movements" }),
		);
		expect(state.ledger.loadMore).toHaveBeenCalledWith(20);
	});

	it("names each kind of movement in the admin's terms", () => {
		const row = (fields: Record<string, unknown>) =>
			({ refLabel: undefined, cause: undefined, ...fields }) as Parameters<
				typeof ledgerRowLabel
			>[0];
		expect(ledgerRowLabel(row({ type: "grant", reason: "trial" }))).toBe(
			"Trial allowance",
		);
		expect(
			ledgerRowLabel(
				row({
					type: "refund",
					reason: "order",
					refLabel: "ORD-1",
					cause: "system",
				}),
			),
		).toBe("ORD-1 · lapsed on its own");
		expect(
			ledgerRowLabel(row({ type: "expire", bucket: "plan", reason: "expiry" })),
		).toBe("Unused monthly credits");
	});
});
