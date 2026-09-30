// @vitest-environment jsdom
// The admin Enterprise contract form (Credits T6, z8r3fdkp8h): it labels the
// fee in the currency the server will freeze, says every refusal
// `enterprise.setContract` would throw before the tap, and sends what was
// typed in minor units. The server re-checks everything (enterprise.test.ts).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSellerRow } from "../../../convex/admin";

const state = vi.hoisted(() => ({
	setContract: (async () => ({ created: true })) as (
		args: unknown,
	) => Promise<unknown>,
}));

vi.mock("convex/react", () => ({
	useMutation: () => state.setContract,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The page renders the Sheet's header parts, which need their Radix dialog
// context — render it inside an open Sheet like the real drawer does.
import { Sheet, SheetContent } from "../ui/sheet";
import { EnterpriseContractPage } from "./enterprise-contract-page";

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_hsl" as AdminSellerRow["_id"],
		storeName: "Mama's Delights",
		slug: "mamas-delights",
		ownerUserId: "u_hsl",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		foundingIntent: false,
		subscriptionStatus: "active",
		plan: "pro",
		billingCycle: "monthly",
		comped: false,
		createdAt: 0,
		purging: false,
		country: "MY",
		currency: "MYR",
		billingCurrency: "MYR",
		...overrides,
	};
}

function renderPage(row: AdminSellerRow) {
	return render(
		<Sheet open>
			<SheetContent>
				<EnterpriseContractPage seller={row} onBack={() => {}} />
			</SheetContent>
		</Sheet>,
	);
}

/** Fill the four numbers and the contact with HSL's deal. */
function fillHsl() {
	fireEvent.change(screen.getByLabelText(/Monthly fee/), {
		target: { value: "888" },
	});
	fireEvent.change(screen.getByLabelText("Credits included a month"), {
		target: { value: "1500" },
	});
	fireEvent.change(screen.getByLabelText(/Overage per credit/), {
		target: { value: "0.60" },
	});
	fireEvent.change(screen.getByLabelText("Contact"), {
		target: { value: "HSL Food GM" },
	});
}

const saveButton = () =>
	screen.getByRole("button", {
		name: /Put on Enterprise|Save contract/,
	}) as HTMLButtonElement;

beforeEach(() => {
	state.setContract = vi.fn(async () => ({ created: true }));
});
afterEach(cleanup);

describe("EnterpriseContractPage — the currency", () => {
	it("labels a new contract's fee in the store's BILLING currency — the one the server freezes", () => {
		// An SG store that has only ever paid in ringgit: the country says S$,
		// the next bill (and so the contract) is RM.
		renderPage(
			seller({ country: "SG", currency: "SGD", billingCurrency: "MYR" }),
		);
		expect(screen.getByLabelText("Monthly fee (RM)")).toBeTruthy();
		expect(screen.getByLabelText("Overage per credit (RM)")).toBeTruthy();
	});

	it("keeps an existing contract's currency, whatever the store now bills in", () => {
		renderPage(
			seller({
				plan: "enterprise",
				billingCurrency: "MYR",
				enterprise: {
					baseFeeMinor: 30000,
					currency: "SGD",
					includedCredits: 1500,
					overageRateMinor: 25,
					blockSize: 5000,
					contactName: "SG buyer",
					setAt: 0,
				},
			}),
		);
		expect(screen.getByLabelText("Monthly fee (S$)")).toBeTruthy();
		expect(screen.getByText("The contract's currency is fixed.")).toBeTruthy();
	});
});

describe("EnterpriseContractPage — every refusal said before the tap", () => {
	it("a store onboarded with a founding promise is refused like a member", () => {
		renderPage(seller({ foundingIntent: true }));
		fillHsl();
		expect(saveButton().disabled).toBe(true);
		expect(
			screen.getByText(
				/a founding store can't be put on an Enterprise contract/,
			),
		).toBeTruthy();
	});

	it("an open bill at another tier must be settled or voided first", () => {
		renderPage(
			seller({
				pendingInvoice: {
					invoiceNumber: "INV-2610-PRO1",
					dueDate: 0,
					total: 14900,
					currency: "MYR",
					hasPayNowLink: false,
					plan: "pro",
					billingCycle: "monthly",
					kind: "plan",
				},
			}),
		);
		fillHsl();
		expect(saveButton().disabled).toBe(true);
		expect(
			screen.getByText(
				"Settle or void INV-2610-PRO1 first — it bills Pro, not the contract.",
			),
		).toBeTruthy();
	});

	it("an open contract bill blocks a TERM change — never a fee change", () => {
		renderPage(
			seller({
				plan: "enterprise",
				enterprise: {
					baseFeeMinor: 88800,
					currency: "MYR",
					includedCredits: 1500,
					overageRateMinor: 60,
					blockSize: 5000,
					contactName: "HSL Food GM",
					setAt: 0,
				},
				pendingInvoice: {
					invoiceNumber: "INV-2611-ENT1",
					dueDate: 0,
					total: 88800,
					currency: "MYR",
					hasPayNowLink: true,
					plan: "enterprise",
					billingCycle: "monthly",
					kind: "plan",
				},
			}),
		);
		// A fee edit on the same term saves.
		fireEvent.change(screen.getByLabelText("Monthly fee (RM)"), {
			target: { value: "999" },
		});
		expect(saveButton().disabled).toBe(false);
		// Switching to yearly would be undone by paying the open monthly bill.
		fireEvent.click(screen.getByRole("button", { name: /Yearly/ }));
		expect(saveButton().disabled).toBe(true);
		expect(
			screen.getByText(
				/INV-2611-ENT1 first — it bills the contract's monthly term/,
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
		expect(saveButton().disabled).toBe(false);
	});
});

describe("EnterpriseContractPage — saving", () => {
	it("sends HSL's deal in minor units and previews what it bills", async () => {
		renderPage(seller());
		fillHsl();
		expect(
			screen.getByText(
				/Bills RM\s*888\.00 a month · 1,500 credits a month · blocks of 5,000 at RM\s*0\.60 = RM\s*3,000\.00/,
			),
		).toBeTruthy();
		fireEvent.click(saveButton());
		await Promise.resolve();
		expect(state.setContract).toHaveBeenCalledWith(
			expect.objectContaining({
				retailerId: "r_hsl",
				baseFeeMinor: 88800,
				includedCredits: 1500,
				overageRateMinor: 60,
				blockSize: 5000,
				billingCycle: "monthly",
				contactName: "HSL Food GM",
			}),
		);
	});
});
