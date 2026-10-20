// @vitest-environment jsdom
// Admin → Billing → "Issue an invoice": what the form actually bills, and the
// Enterprise door it now carries (ClickUp z8r3fdpm2p).
//
// Enterprise bills a negotiated contract, so a store without one used to find
// the tier button dead and a line telling it to go to another tab. The tier is
// now always pickable and the contract is written from here — and a Founding
// Member on a contract can finally be billed that contract instead of a Pro
// bill that would end it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	retailers: [] as Array<Record<string, unknown>>,
	spots: 5 as number | undefined,
	issue: vi.fn(),
	sheetOpen: false,
	capped: false,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => opts,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query"> }) => ({
		data: getFunctionName(opts.__fn).startsWith("foundingMembers:")
			? state.spots
			: { stores: state.retailers, capped: state.capped },
	}),
}));
vi.mock("convex/react", () => ({ useMutation: () => state.issue }));
// The sheet is the shared contract form in its own chrome, covered by its own
// tests; here only "did the form open it" matters.
vi.mock("../components/ui/confirm-dialog", () => ({
	// The real one is Radix; here only "what did it say, and did confirming
	// run the issue" matters.
	ConfirmDialog: ({
		open,
		title,
		description,
		onConfirm,
	}: {
		open: boolean;
		title: React.ReactNode;
		description?: React.ReactNode;
		onConfirm: () => void;
	}) =>
		open ? (
			<div data-testid="confirm">
				<p>{title}</p>
				<p>{description}</p>
				<button type="button" onClick={onConfirm}>
					Replace it
				</button>
			</div>
		) : null,
}));
vi.mock("../components/admin/enterprise-contract-sheet", () => ({
	EnterpriseContractSheet: ({ open }: { open: boolean }) => {
		state.sheetOpen = open;
		return open ? <div data-testid="contract-sheet" /> : null;
	},
}));

const { IssueInvoiceForm } = await import("./app.admin.billing");

afterEach(() => {
	cleanup();
	state.retailers = [];
	state.spots = 5;
	state.issue = vi.fn();
	state.sheetOpen = false;
	state.capped = false;
});

const CONTRACT = {
	baseFeeMinor: 88800,
	currency: "MYR" as const,
	billingCycle: "monthly" as const,
	includedCredits: 1500,
	overageRateMinor: 60,
	blockSize: 5000,
	contactName: "Pat Lim",
	setAt: 1_760_000_000_000,
};

const store = (overrides: Record<string, unknown> = {}) => ({
	_id: "r1",
	storeName: "Hermoolah",
	slug: "hermoolah",
	status: "active",
	plan: "pro",
	isFoundingMember: false,
	foundingIntent: false,
	foundingBenefitsRevoked: false,
	autoChargeIdle: false,
	comped: false,
	unclaimed: false,
	...overrides,
});

/** Pick the one store in the picker — every test bills somebody. */
function pickStore() {
	fireEvent.change(screen.getByRole("combobox"), { target: { value: "r1" } });
}

const planButton = (name: "starter" | "pro" | "enterprise") =>
	screen.getByRole("button", { name: new RegExp(`^${name}$`, "i") });

describe("Issue an invoice — the Enterprise door", () => {
	it("lets a store with no contract be picked for Enterprise, and says what's missing", () => {
		state.retailers = [store()];
		render(<IssueInvoiceForm />);
		pickStore();

		// The whole complaint: this used to be disabled, which told the admin
		// the TIER was unavailable when only the contract was.
		expect((planButton("enterprise") as HTMLButtonElement).disabled).toBe(
			false,
		);
		fireEvent.click(planButton("enterprise"));

		expect(screen.getByText("No contract yet")).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: /issue invoice/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("opens the contract form from the billing card — no second tab", () => {
		state.retailers = [store()];
		render(<IssueInvoiceForm />);
		pickStore();
		fireEvent.click(planButton("enterprise"));

		expect(screen.queryByTestId("contract-sheet")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /set up contract/i }));
		expect(screen.getByTestId("contract-sheet")).toBeTruthy();
	});

	it("offers the live contract for editing instead of a dead end", () => {
		state.retailers = [store({ plan: "enterprise", enterprise: CONTRACT })];
		render(<IssueInvoiceForm />);
		pickStore();

		// A contract store ARMS its contract — Enterprise is already the plan.
		expect(screen.getByText("Billing their contract")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /edit contract/i }));
		expect(screen.getByTestId("contract-sheet")).toBeTruthy();
	});

	it("bills a Founding Member's CONTRACT, not a Pro bill that would end it", async () => {
		// The pre-fix bug: founding forced Pro for every tier, so a founding
		// store on a contract drafted a founding Pro invoice — and paying a
		// non-Enterprise bill is exactly what takes a store OFF its contract.
		state.retailers = [
			store({
				plan: "enterprise",
				isFoundingMember: true,
				enterprise: CONTRACT,
			}),
		];
		render(<IssueInvoiceForm />);
		pickStore();

		fireEvent.click(screen.getByRole("button", { name: /issue invoice/i }));
		await vi.waitFor(() => expect(state.issue).toHaveBeenCalled());
		expect(state.issue).toHaveBeenCalledWith(
			expect.objectContaining({ plan: "enterprise", founding: false }),
		);
	});

	it("still prices a founding store's PRO bill at the founding rate", async () => {
		state.retailers = [store({ isFoundingMember: true })];
		render(<IssueInvoiceForm />);
		pickStore();

		fireEvent.click(screen.getByRole("button", { name: /issue invoice/i }));
		await vi.waitFor(() => expect(state.issue).toHaveBeenCalled());
		expect(state.issue).toHaveBeenCalledWith(
			expect.objectContaining({ plan: "pro", founding: true }),
		);
	});

	it("keeps the Enterprise explainer out of an ordinary Pro bill", () => {
		state.retailers = [store()];
		render(<IssueInvoiceForm />);
		pickStore();

		// Pro is the default for a store with no contract, and an admin billing
		// Pro must not be lectured about a tier they didn't pick — the old hint
		// fired for EVERY selected store without a contract. The contract strip
		// speaks only while Enterprise is the chosen plan.
		expect(screen.queryByText("No contract yet")).toBeNull();
		fireEvent.click(planButton("enterprise"));
		expect(screen.getByText("No contract yet")).toBeTruthy();
	});
});

describe("Issue an invoice — correcting an open bill (z8r3fdpm2p)", () => {
	const RENEWAL = {
		_id: "inv1",
		invoiceNumber: "INV-202610-AAAA",
		total: 14_900,
		currency: "MYR",
		plan: "pro" as const,
		kind: "plan" as const,
		origin: "auto_renewal" as const,
	};

	it("offers to replace the open bill instead of dead-ending", () => {
		// The old copy sent the admin to another card to void it by hand.
		state.retailers = [store({ pending: RENEWAL, autoChargeIdle: true })];
		render(<IssueInvoiceForm />);
		pickStore();

		const btn = screen.getByRole("button", { name: /replace open bill/i });
		expect((btn as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByText(/settle it first/i)).toBeNull();
		expect(screen.getByText(/INV-202610-AAAA is open for/)).toBeTruthy();
	});

	it("promises the card charge only on a correction that costs no more", () => {
		state.retailers = [store({ pending: RENEWAL, autoChargeIdle: true })];
		render(<IssueInvoiceForm />);
		pickStore();

		// Default Pro (RM149) replacing a RM149 renewal — inside the mandate.
		expect(screen.getByText(/will be charged/)).toBeTruthy();

		// Starter is cheaper still — also inside it.
		fireEvent.click(planButton("starter"));
		expect(screen.getByText(/will be charged/)).toBeTruthy();
	});

	it("refuses to replace while a card charge is unresolved", () => {
		// `chargeInFlight` is its own fact now: `autoChargeIdle === false` is
		// ALSO true for a detached method and a stranded charge, and refusing
		// those said "hasn't reported back yet" about a replace the server
		// would have allowed (review, 7 Oct).
		state.retailers = [
			store({ pending: RENEWAL, autoChargeIdle: false, chargeInFlight: true }),
		];
		render(<IssueInvoiceForm />);
		pickStore();

		expect(
			(
				screen.getByRole("button", {
					name: /replace open bill/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByText(/hasn't reported back yet/)).toBeTruthy();
	});

	it("allows the replace when the card is merely detached or stranded", () => {
		// `autoChargeIdle` is false for THREE different reasons; only one of
		// them is "a charge is in flight". A stranded charge or a detached
		// method used to produce a disabled button reading "hasn't reported
		// back yet" about a replace the server would have allowed.
		state.retailers = [
			store({ pending: RENEWAL, autoChargeIdle: false, chargeInFlight: false }),
		];
		render(<IssueInvoiceForm />);
		pickStore();

		expect(
			(
				screen.getByRole("button", {
					name: /replace open bill/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		expect(screen.queryByText(/hasn't reported back yet/)).toBeNull();
		// …and it is honest that no card will follow this one.
		expect(screen.getByText(/won't charge this automatically/)).toBeTruthy();
	});

	it("names the bill it will void before replacing it", async () => {
		state.retailers = [store({ pending: RENEWAL, autoChargeIdle: true })];
		render(<IssueInvoiceForm />);
		pickStore();

		fireEvent.click(screen.getByRole("button", { name: /replace open bill/i }));
		expect(screen.getByTestId("confirm")).toBeTruthy();
		expect(screen.getByText(/Replace INV-202610-AAAA\?/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Replace it" }));
		await vi.waitFor(() => expect(state.issue).toHaveBeenCalled());
		expect(state.issue).toHaveBeenCalledWith(
			expect.objectContaining({ replacePendingId: "inv1" }),
		);
	});
});

describe("Issue an invoice — what paying does to the tier (z8r3fdpm2p)", () => {
	it("warns that an admin DOWNGRADE lands immediately, unlike a seller's own", () => {
		// The surprising half: `settleInvoicePaid` flips the plan at once, while
		// a seller's own downgrade is scheduled to the period end.
		state.retailers = [store({ plan: "pro" })];
		render(<IssueInvoiceForm />);
		pickStore();
		fireEvent.click(planButton("starter"));

		expect(screen.getByText(/down to Starter straight away/)).toBeTruthy();
		expect(screen.getByText(/unlike a seller's own downgrade/)).toBeTruthy();
	});

	it("says an upgrade lands on payment, never before", () => {
		state.retailers = [store({ plan: "starter" })];
		render(<IssueInvoiceForm />);
		pickStore();
		fireEvent.click(planButton("pro"));

		expect(screen.getByText(/from Starter to Pro — not before/)).toBeTruthy();
	});

	it("says nothing when the bill isn't a tier change at all", () => {
		state.retailers = [store({ plan: "pro" })];
		render(<IssueInvoiceForm />);
		pickStore();
		expect(screen.queryByText(/straight away|not before/)).toBeNull();
	});
});

describe("Issue an invoice — the picker's cap (z8r3fdpm2p)", () => {
	it("says so when the book runs past the list, and names the way out", () => {
		// The picker is newest-first, so a truncated list is missing the OLDEST
		// stores — and silently, which is the constraint-enforced-silently
		// CLAUDE.md forbids. It bites sooner than the number suggests: batch
		// pre-building (PR #346) adds placeholder stores at the NEWEST end, so
		// a batch pushes exactly that many real customers off.
		state.retailers = [store()];
		state.capped = true;
		render(<IssueInvoiceForm />);

		expect(screen.getByText(/Showing the newest 500 stores/)).toBeTruthy();
		// The way out, not just the bad news.
		expect(screen.getByText(/Admin · Sellers/)).toBeTruthy();
	});

	it("stays quiet when the whole book fits", () => {
		state.retailers = [store()];
		state.capped = false;
		render(<IssueInvoiceForm />);
		expect(screen.queryByText(/Showing the newest/)).toBeNull();
	});
});
