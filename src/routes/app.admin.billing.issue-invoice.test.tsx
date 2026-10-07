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
			: state.retailers,
	}),
}));
vi.mock("convex/react", () => ({ useMutation: () => state.issue }));
// The sheet is the shared contract form in its own chrome, covered by its own
// tests; here only "did the form open it" matters.
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
	hasPending: false,
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
