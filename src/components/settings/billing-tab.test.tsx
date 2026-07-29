// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { BillingTab } from "./billing-tab";

// The tab now reads via `useQuery(convexQuery(api.x, args)).data`. We mock the
// adapter's `convexQuery` to pass the function ref straight through, then drive
// TanStack's `useQuery` by that ref's stable name — same name-keyed, synchronous
// shape as the old convex/react mock (no QueryClientProvider needed).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: FunctionReference<"query">, args: unknown) => ({
		__fn: fn,
		args,
	}),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

afterEach(cleanup);

type Retailer = Parameters<typeof BillingTab>[0]["retailer"];

/** Minimal retailer payload for the billing tab — a real (non-comped) Pro store
 * that's past due, matching the screenshot the fix targets. */
function retailer(overrides: Partial<Retailer> = {}): Retailer {
	return {
		slug: "openmarket",
		isFoundingMember: false,
		ordersThisMonth: 0,
		subscription: {
			plan: "pro",
			status: "past_due",
			comped: false,
			caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
			features: { crm: true, orderInbox: true, chargeablePickup: true },
			active: false,
			frozen: true,
		},
		...overrides,
	} as unknown as Retailer;
}

/** Wire the three reads the tab makes, keyed by function name (the generated
 * `api` proxy hands back a fresh reference per access, so `===` on the reference
 * itself is unreliable — match on the stable name instead). The mocked
 * `convexQuery` handed `useQuery` a `{ __fn }` wrapper we read the name off. */
function mockQueries({ isAdmin }: { isAdmin: boolean }) {
	const NAME = {
		amIAdmin: getFunctionName(api.billing.amIAdmin),
		invoices: getFunctionName(api.invoices.myInvoices),
		instructions: getFunctionName(api.billing.paymentInstructions),
	};
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
	}) => {
		const name = getFunctionName(opts.__fn);
		if (name === NAME.amIAdmin) return { data: isAdmin, isPending: false };
		if (name === NAME.invoices) return { data: [], isPending: false };
		if (name === NAME.instructions)
			return { data: { whatsappPhone: "+60123456789" }, isPending: false };
		return { data: undefined, isPending: true };
	}) as unknown as typeof useQuery);
}

describe("BillingTab admin plan suppression", () => {
	it("shows the tier + past-due status to a normal seller", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});

	it("hides the plan/tier card for an admin on their own store", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Admin account")).toBeTruthy();
		// No tier, status badge or renew nudge — admins aren't on a plan.
		expect(screen.queryByText("Current plan")).toBeNull();
		expect(screen.queryByText("Past due")).toBeNull();
		expect(screen.queryByText("Renew your subscription")).toBeNull();
	});

	it("keeps the seller's real plan visible while an admin acts-as", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer({ actingAsAdmin: true })} />);
		// White-glove support must see + manage the seller's actual billing.
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});
});
