// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { ViewOnlyNote } from "./view-only-note";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (convexQuery passes the ref through; useQuery answers by function name).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
// The note links to Billing; a bare anchor is all the assertions need.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...rest }: { children: React.ReactNode }) => (
		<a href="/app/settings" {...rest}>
			{children}
		</a>
	),
}));
// `useActAs` reads a persisted session through a provider we don't mount.
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));

afterEach(cleanup);

type Sub = {
	status: string;
	comped?: boolean;
	compEnded?: { at: number };
};

/** Answer the two cached queries `useStoreLock` reads, by function name. */
function mockStore(opts: {
	subscription?: Sub;
	actingAsAdmin?: boolean;
	isAdmin?: boolean;
}) {
	vi.mocked(useQuery).mockImplementation(((arg: { __fn: unknown }) => {
		const name = getFunctionName(
			arg.__fn as Parameters<typeof getFunctionName>[0],
		);
		if (name === getFunctionName(api.billing.amIAdmin))
			return { data: opts.isAdmin === true };
		if (name === getFunctionName(api.retailers.getMyRetailer))
			return {
				data: {
					_id: "r_1",
					actingAsAdmin: opts.actingAsAdmin === true,
					subscription: opts.subscription,
				},
			};
		return { data: undefined };
	}) as unknown as typeof useQuery);
}

describe("ViewOnlyNote", () => {
	it("says the store is view-only and where to fix it when a bill is unpaid", () => {
		mockStore({ subscription: { status: "past_due" } });
		render(<ViewOnlyNote />);
		expect(screen.getByText(/view-only/i)).toBeTruthy();
		expect(screen.getByText(/invoice/i)).toBeTruthy();
		expect(screen.getByRole("link", { name: /billing/i })).toBeTruthy();
	});

	it("names the sponsorship — never an invoice — when a comp was turned off", () => {
		mockStore({
			subscription: { status: "past_due", compEnded: { at: 1_700_000_000 } },
		});
		render(<ViewOnlyNote />);
		expect(screen.getByText(/sponsored access has ended/i)).toBeTruthy();
		expect(screen.queryByText(/invoice/i)).toBeNull();
	});

	it("renders nothing at all for a store that can still act", () => {
		for (const subscription of [
			{ status: "active" },
			{ status: "trialing" },
			{ status: "past_due", comped: true },
		] as Sub[]) {
			mockStore({ subscription });
			const { container } = render(<ViewOnlyNote />);
			expect(container.firstChild).toBeNull();
			cleanup();
		}
	});

	it("stays out of an admin's way — act-as and own store both", () => {
		mockStore({ subscription: { status: "past_due" }, actingAsAdmin: true });
		const actAs = render(<ViewOnlyNote />);
		expect(actAs.container.firstChild).toBeNull();
		cleanup();

		mockStore({ subscription: { status: "past_due" }, isAdmin: true });
		const ownStore = render(<ViewOnlyNote />);
		expect(ownStore.container.firstChild).toBeNull();
	});

	it("renders nothing while the payload is still loading", () => {
		mockStore({});
		const { container } = render(<ViewOnlyNote />);
		expect(container.firstChild).toBeNull();
	});
});
