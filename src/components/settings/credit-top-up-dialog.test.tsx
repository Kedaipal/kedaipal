// @vitest-environment jsdom
// Credits T2 (z8r3fdf8ht): the credit-pack picker — every state it can be in
// (loading, can buy, refused with the way out, view-only, unavailable,
// opening HitPay) and every state on the way back (confirming, paid, not
// received yet, expired, flagged), plus the URL contract that opens it.
import { useQuery } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CreditTopUpDialog } from "./credit-top-up-dialog";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (convexQuery passes the ref + args through; useQuery answers by name).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

const mocks = vi.hoisted(() => ({
	createTopUp: vi.fn(),
	verify: vi.fn(),
	receipt: vi.fn(),
	trackEvent: vi.fn(),
	leavePageTo: vi.fn(),
	toastError: vi.fn(),
	role: "owner" as "owner" | "member" | "admin",
	credits: "write" as "read" | "write" | undefined,
}));
vi.mock("convex/react", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		useAction: (ref: FunctionReference<"action">) => {
			const name = getFunctionName(ref);
			if (name.includes("verifyCreditPurchase")) return mocks.verify;
			if (name.includes("getOrCreateReceiptPdfUrl")) return mocks.receipt;
			return mocks.createTopUp;
		},
	};
});
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => mocks.role,
	usePermission: () => ({
		canRead: mocks.role !== "member" || mocks.credits !== undefined,
		canWrite: mocks.role !== "member" || mocks.credits === "write",
		role: mocks.role,
	}),
}));
vi.mock("../../lib/ga-events", () => ({ trackEvent: mocks.trackEvent }));
vi.mock("../../lib/leave-page", () => ({ leavePageTo: mocks.leavePageTo }));
vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: vi.fn() },
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.role = "owner";
	mocks.credits = "write";
});

const RETAILER = {
	_id: "r_kedai" as Id<"retailers">,
	slug: "kedai",
};

type Options = {
	available: boolean;
	currency: "MYR" | "SGD";
	packs: Array<{
		id: string;
		credits: number;
		priceMinor: number;
		currency: "MYR" | "SGD";
	}>;
	refusal:
		| null
		| "trialing"
		| "past_due"
		| "on_hold"
		| "cancelled"
		| "admin_store"
		| "sponsored";
	refusalMessage: string | null;
	viewOnly: null | "acting_as_admin" | "no_write";
	pendingInvoice: { invoiceNumber: string; payNowUrl: string | null } | null;
	upgradeHint: { planLabel: string; monthlyCredits: number } | null;
	buyerIsMember: boolean;
};

const MYR_PACKS: Options["packs"] = [
	{ id: "p50", credits: 50, priceMinor: 4500, currency: "MYR" },
	{ id: "p200", credits: 200, priceMinor: 16000, currency: "MYR" },
];

const OPTIONS: Options = {
	available: true,
	currency: "MYR",
	packs: MYR_PACKS,
	refusal: null,
	refusalMessage: null,
	viewOnly: null,
	pendingInvoice: null,
	upgradeHint: null,
	buyerIsMember: false,
};

const BALANCE = {
	plan: 12,
	purchased: 25,
	total: 37,
	periodKey: "2026-10",
	periodGrant: 200,
	regime: "monthly",
	nextGrant: 200,
	refreshesAt: null,
	nextExpiry: null,
	exhaustedAt: null,
	sellerRefundsLeft: 10,
	customGrant: false,
	lockExempt: null as null | "admin_store" | "sponsored",
};

type Latest = {
	_id: string;
	purchaseNumber: string;
	packId: string;
	credits: number;
	amountMinor: number;
	currency: "MYR" | "SGD";
	status: "pending" | "paid" | "failed" | "expired";
	createdAt: number;
	paidAt: number | null;
	issue: null | "amount_mismatch" | "late_payment";
	paymentMethodLabel: string | null;
	boughtBy: string | null;
	expiresAt: number | null;
};

const LATEST_PENDING: Latest = {
	_id: "cp_1",
	purchaseNumber: "CRD-202610-AB12",
	packId: "p50",
	credits: 50,
	amountMinor: 4500,
	currency: "MYR",
	status: "pending",
	createdAt: Date.now(),
	paidAt: null,
	issue: null,
	paymentMethodLabel: null,
	boughtBy: null,
	expiresAt: null,
};

/** Answer the three reads by function name. `null` passes through (no
 * access / nothing recent); `undefined` means still loading. A "skip" read
 * resolves to undefined, like the real adapter. */
function mockReads({
	options = OPTIONS,
	balance = BALANCE,
	latest = "loading",
}: {
	options?: Options | null | "loading";
	balance?: typeof BALANCE | null | "loading";
	latest?: Latest | null | "loading";
}) {
	const NAME = {
		options: getFunctionName(api.creditPurchases.topUpOptions),
		balance: getFunctionName(api.credits.getBalance),
		latest: getFunctionName(api.creditPurchases.latestPurchase),
	};
	const reads = vi.fn();
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
		args: unknown;
	}) => {
		const name = getFunctionName(opts.__fn);
		reads(name, opts.args);
		if (opts.args === "skip") return { data: undefined };
		const pick = <T,>(v: T | "loading") => (v === "loading" ? undefined : v);
		if (name === NAME.options) return { data: pick(options) };
		if (name === NAME.balance) return { data: pick(balance) };
		if (name === NAME.latest) return { data: pick(latest) };
		return { data: undefined };
	}) as unknown as typeof useQuery);
	return reads;
}

function renderDialog(
	request: 1 | "return" = 1,
	retailer: typeof RETAILER & { actingAsAdmin?: boolean } = RETAILER,
) {
	const onRequestHandled = vi.fn();
	const view = render(
		<CreditTopUpDialog
			retailer={retailer}
			request={request}
			onRequestHandled={onRequestHandled}
		/>,
	);
	return { ...view, onRequestHandled };
}

const buyButton = () => screen.getByRole("button", { name: /^Buy / });
/** A pack is a radio (arrow keys move the choice); its card is the label. */
const packRadio = (credits: number) =>
	screen.getByRole("radio", {
		name: new RegExp(`^${credits} credits`),
	}) as HTMLInputElement;
const packCard = (credits: number) =>
	packRadio(credits).closest("label")?.textContent ?? "";

// ---------------------------------------------------------------------------

describe("the URL contract", () => {
	it("?topup=1 opens the picker once and strips the param", () => {
		const reads = mockReads({});
		const { onRequestHandled } = renderDialog(1);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByText("Top up credits")).toBeTruthy();
		expect(onRequestHandled).toHaveBeenCalledTimes(1);
		// Only the picker's reads run — no return reconcile.
		expect(mocks.verify).not.toHaveBeenCalled();
		expect(
			reads.mock.calls.some(
				([name, args]) =>
					name === getFunctionName(api.creditPurchases.latestPurchase) &&
					args !== "skip",
			),
		).toBe(false);
	});

	it("no request: nothing opens and nothing is read", () => {
		const reads = mockReads({});
		render(
			<CreditTopUpDialog
				retailer={RETAILER}
				request={undefined}
				onRequestHandled={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(reads.mock.calls.every(([, args]) => args === "skip")).toBe(true);
	});

	it("?topup=return reopens on 'Confirming your payment…' and reconciles once", async () => {
		mocks.verify.mockReturnValue(new Promise(() => {}));
		mockReads({ latest: LATEST_PENDING });
		const { onRequestHandled } = renderDialog("return");
		expect(screen.getByText("Confirming your payment…")).toBeTruthy();
		expect(onRequestHandled).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(1));
		expect(mocks.verify).toHaveBeenCalledWith({});
	});
});

describe("the picker", () => {
	it("shows the balance being topped up, both packs in the store's currency, and the rules", () => {
		mockReads({});
		renderDialog();
		expect(screen.getByText("37 orders left")).toBeTruthy();
		// Always both balances, in the meter's words.
		expect(screen.getByText(/12 monthly · 25 bought/)).toBeTruthy();
		// Priced like the /pricing cards: whole amounts, what a credit costs,
		// and what the bigger pack saves — in money, never a percentage.
		expect(packCard(50)).toMatch(/RM\s45(?!\.)/);
		expect(packCard(50)).toMatch(/RM\s0\.90 per credit/);
		expect(packCard(200)).toMatch(/RM\s160(?!\.)/);
		expect(packCard(200)).toMatch(/RM\s0\.80 per credit/);
		expect(packCard(200)).toMatch(/Save RM\s20 vs 4 × 50/);
		expect(packCard(50)).not.toMatch(/Save/);
		expect(screen.getAllByText("Lasts 12 months")).toHaveLength(2);
		// The cheaper-per-credit pack is labelled; never with a percentage.
		expect(packCard(200)).toMatch(/Best value/);
		expect(packCard(50)).not.toMatch(/Best value/);
		// The default pick, and the result of the tap before the tap.
		expect(packRadio(50).checked).toBe(true);
		expect(screen.getByText("After this top-up: 87 orders left.")).toBeTruthy();
		expect(document.body.textContent).not.toMatch(
			/%|wallet|commission|\bfee\b/i,
		);
		expect(
			screen.getByText(/non-refundable and not redeemable for cash/),
		).toBeTruthy();
		const terms = screen.getByRole("link", { name: "Credits terms" });
		expect(terms.getAttribute("href")).toBe("/terms#credits");
		expect(terms.getAttribute("target")).toBe("_blank");
	});

	it("a debt reads as orders owed — never a money balance", () => {
		mockReads({ balance: { ...BALANCE, plan: -15, purchased: 0, total: -15 } });
		renderDialog();
		expect(screen.getByText("15 orders owed")).toBeTruthy();
		expect(screen.getByText(/15 owed on monthly · 0 bought/)).toBeTruthy();
		// A pack pays the debt first — said before the tap — and the lock
		// lifts the moment it's paid (T3).
		expect(
			screen.getByText(
				"Covers the 15 owed and leaves 35 orders. Your store unlocks as soon as it's paid.",
			),
		).toBeTruthy();
	});

	it("an SGD store's packs are priced in S$", () => {
		mockReads({
			options: {
				...OPTIONS,
				currency: "SGD",
				packs: [
					{ id: "p50sg", credits: 50, priceMinor: 2200, currency: "SGD" },
					{ id: "p200sg", credits: 200, priceMinor: 7500, currency: "SGD" },
				],
			},
		});
		renderDialog();
		expect(packCard(50)).toMatch(/S\$\s22(?!\.)/);
		expect(packCard(50)).toMatch(/S\$\s0\.44 per credit/);
		// S$ 75 / 200 = 37.5 cents — rounded for the card, not for the saving.
		expect(packCard(200)).toMatch(/S\$\s0\.38 per credit/);
		expect(packCard(200)).toMatch(/Save S\$\s13 vs 4 × 50/);
		expect(document.body.textContent).not.toMatch(/RM/);
	});

	it("loading: skeletons, and Buy isn't offered yet", () => {
		mockReads({ options: "loading", balance: "loading" });
		renderDialog();
		expect(screen.getByText("Top up credits")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Buy / })).toBeNull();
		expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
	});

	it("submitting: fires credits_topup_started, opens the checkout, and sends the page to HitPay", async () => {
		mocks.createTopUp.mockResolvedValue({
			url: "https://pay.example/req_1",
			purchaseId: "cp_1",
		});
		mockReads({});
		renderDialog();
		// Default pick is the smallest pack; pick the bigger one.
		fireEvent.click(packRadio(200));
		expect(packRadio(200).checked).toBe(true);
		expect(
			screen.getByText("After this top-up: 237 orders left."),
		).toBeTruthy();
		expect(buyButton().textContent).toMatch(/Buy 200 credits · RM\s160\.00/);
		fireEvent.click(buyButton());
		expect(mocks.trackEvent).toHaveBeenCalledWith("credits_topup_started", {
			pack_id: "p200",
			value: 160,
			currency: "MYR",
		});
		expect(
			screen.getByText(/Opening HitPay's secure payment page/),
		).toBeTruthy();
		await waitFor(() =>
			expect(mocks.leavePageTo).toHaveBeenCalledWith(
				"https://pay.example/req_1",
			),
		);
		expect(mocks.createTopUp).toHaveBeenCalledWith({ packId: "p200" });
	});

	it("a failed checkout says why and re-arms Buy", async () => {
		mocks.createTopUp.mockRejectedValue(new Error("boom"));
		mockReads({});
		renderDialog();
		fireEvent.click(buyButton());
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		await waitFor(() =>
			expect((buyButton() as HTMLButtonElement).disabled).toBe(false),
		);
		expect(mocks.leavePageTo).not.toHaveBeenCalled();
	});

	it.each([
		["trialing", "Choose a plan"],
		["on_hold", "Resume your plan"],
		["cancelled", "Choose a plan"],
		["past_due", "View the invoice"],
	] as const)("%s: Buy is disabled WITH the server's reason and the way out", (refusal, wayOut) => {
		const message = `Refused because ${refusal}.`;
		mockReads({ options: { ...OPTIONS, refusal, refusalMessage: message } });
		renderDialog();
		expect(screen.getByText(message)).toBeTruthy();
		expect((buyButton() as HTMLButtonElement).disabled).toBe(true);
		// The packs stay visible — what's sold is never hidden — but inert,
		// with no "after" promise for a purchase that can't happen.
		expect(packRadio(50).disabled).toBe(true);
		expect(packRadio(200).disabled).toBe(true);
		expect(screen.queryByText(/After this top-up/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: wayOut }));
		// The way out is the billing tab under the dialog: closing IS it.
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it.each([
		"sponsored",
		"admin_store",
	] as const)("%s: nothing to top up — the reason, and no way-out button (nothing is wrong)", (refusal) => {
		const message = `Refused because ${refusal}.`;
		mockReads({ options: { ...OPTIONS, refusal, refusalMessage: message } });
		renderDialog();
		expect(screen.getByText(message)).toBeTruthy();
		expect((buyButton() as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.queryByRole("button", { name: /Choose a plan|Resume|invoice/ }),
		).toBeNull();
	});

	it("past due with a Pay-now link: the way out IS paying that invoice", () => {
		mockReads({
			options: {
				...OPTIONS,
				refusal: "past_due",
				refusalMessage: "Your invoice INV-1 is overdue. Pay it first.",
				pendingInvoice: {
					invoiceNumber: "INV-1",
					payNowUrl: "https://pay.example/inv",
				},
			},
		});
		renderDialog();
		expect(
			screen.getByRole("link", { name: "Pay INV-1" }).getAttribute("href"),
		).toBe("https://pay.example/inv");
	});

	it("a teammate gets the reason but no owner-only way out", () => {
		mocks.role = "member";
		mockReads({
			options: {
				...OPTIONS,
				refusal: "trialing",
				refusalMessage: "Ask the store owner to choose a plan first.",
			},
		});
		renderDialog();
		expect(
			screen.getByText("Ask the store owner to choose a plan first."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Choose a plan" })).toBeNull();
	});

	it("a teammate with credits READ sees the packs, disabled, told what access they need", () => {
		mocks.role = "member";
		mocks.credits = "read";
		mockReads({
			options: { ...OPTIONS, viewOnly: "no_write", buyerIsMember: true },
		});
		renderDialog();
		expect(
			screen.getByText(/You can view credits but not change it/i),
		).toBeTruthy();
		expect((buyButton() as HTMLButtonElement).disabled).toBe(true);
	});

	it("a teammate with credits WRITE buys, and is told they pay with their own method", () => {
		mocks.role = "member";
		mockReads({ options: { ...OPTIONS, buyerIsMember: true } });
		renderDialog();
		expect(
			screen.getByText(
				/with your own card or e-wallet — the store owner is emailed a receipt/,
			),
		).toBeTruthy();
		expect((buyButton() as HTMLButtonElement).disabled).toBe(false);
	});

	it("a teammate without credits access at all gets the access note, not a broken picker", () => {
		mocks.role = "member";
		mocks.credits = undefined;
		mockReads({ options: null, balance: null });
		renderDialog();
		expect(screen.getByText(/You don't have access to credits/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Buy / })).toBeNull();
	});

	it("admin act-as is view-only — and reads the SELLER's store", () => {
		mocks.role = "admin";
		const reads = mockReads({
			options: { ...OPTIONS, viewOnly: "acting_as_admin" },
		});
		renderDialog(1, { ...RETAILER, actingAsAdmin: true });
		expect(
			screen.getByText(/View-only while you're acting as this store/),
		).toBeTruthy();
		expect((buyButton() as HTMLButtonElement).disabled).toBe(true);
		expect(
			reads.mock.calls.find(
				([name, args]) =>
					name === getFunctionName(api.creditPurchases.topUpOptions) &&
					args !== "skip",
			)?.[1],
		).toEqual({ retailerId: "r_kedai" });
	});

	it("online top-ups unavailable: no packs, and a way to reach us instead", () => {
		mockReads({ options: { ...OPTIONS, available: false } });
		renderDialog();
		expect(
			screen.getByText(/Buying credits online isn't available right now/),
		).toBeTruthy();
		expect(screen.queryByText("50 credits")).toBeNull();
		expect(screen.queryByRole("button", { name: /^Buy / })).toBeNull();
		const link = screen.getByRole("link", { name: /Message us on WhatsApp/ });
		expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\//);
	});

	it("a Starter store is told a plan with more orders is cheaper for steady volume", () => {
		mockReads({
			options: {
				...OPTIONS,
				upgradeHint: { planLabel: "Pro", monthlyCredits: 200 },
			},
		});
		renderDialog();
		expect(
			screen.getByText(
				/Pro includes 200 orders a month, which works out cheaper/,
			),
		).toBeTruthy();
	});
});

describe("back from HitPay", () => {
	it("paid: the credits, the new balance, the receipt — and live, with no polling", async () => {
		mocks.verify.mockResolvedValue({ settled: true });
		mockReads({
			latest: {
				...LATEST_PENDING,
				status: "paid",
				paidAt: Date.now(),
				paymentMethodLabel: "Touch 'n Go",
				expiresAt: Date.parse("2027-10-10T12:00:00+08:00"),
			},
			balance: { ...BALANCE, purchased: 75, total: 87 },
		});
		renderDialog("return");
		expect(screen.getByText("50 credits added")).toBeTruthy();
		expect(screen.getByText("You now have 87 orders left.")).toBeTruthy();
		expect(screen.getByText("Touch 'n Go")).toBeTruthy();
		expect(screen.getByText("CRD-202610-AB12")).toBeTruthy();
		expect(
			screen.getByText(/receipt is on its way to your billing email/),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Download receipt" }));
		await waitFor(() =>
			expect(mocks.receipt).toHaveBeenCalledWith({ purchaseId: "cp_1" }),
		);
	});

	it("verified, still pending: says so honestly — paid-but-slow and backed-out both covered", async () => {
		mocks.verify.mockResolvedValue({ settled: false });
		mockReads({ latest: LATEST_PENDING });
		renderDialog("return");
		expect(
			await screen.findByText("We haven't received this payment yet"),
		).toBeTruthy();
		expect(
			screen.getByText(/If you backed out, nothing was charged/),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start a new top-up" }));
		expect(screen.getByText("Top up credits")).toBeTruthy();
	});

	it("a verify that errors still lands somewhere — never an endless spinner", async () => {
		mocks.verify.mockRejectedValue(new Error("rate limited"));
		mockReads({ latest: LATEST_PENDING });
		renderDialog("return");
		expect(
			await screen.findByText("We haven't received this payment yet"),
		).toBeTruthy();
	});

	it("expired: nothing was charged, start again", async () => {
		mocks.verify.mockResolvedValue({ settled: false });
		mockReads({ latest: { ...LATEST_PENDING, status: "expired" } });
		renderDialog("return");
		expect(screen.getByText("This checkout expired")).toBeTruthy();
		expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
	});

	it("flagged (a late payment): the credits didn't land, we'll sort it — and how to reach us", async () => {
		mocks.verify.mockResolvedValue({ settled: false });
		mockReads({
			latest: { ...LATEST_PENDING, status: "expired", issue: "late_payment" },
		});
		renderDialog("return");
		expect(screen.getByText("We've flagged this payment")).toBeTruthy();
		expect(screen.getByText(/after this checkout had closed/)).toBeTruthy();
		const link = screen.getByRole("link", { name: /Message us/ });
		expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(
			"CRD-202610-AB12",
		);
	});

	it("nothing recent to confirm (an old bookmark): falls through to the picker", async () => {
		mocks.verify.mockResolvedValue({ settled: false });
		mockReads({ latest: null });
		renderDialog("return");
		expect(screen.getByText("Top up credits")).toBeTruthy();
		await act(async () => {});
	});
});
