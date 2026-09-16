// @vitest-environment jsdom
// Comp dialog states (z8r3fdeub2): create vs edit, free-for-life vs dated,
// disabled-with-reason validation, and what the mutations are called with.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";

// The route module pulls in the router + data layer at import time — stub all
// of it; the dialog under test only needs `useMutation`.
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: unknown) => opts,
	useNavigate: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(() => ({})) }));
vi.mock("../hooks/useActAs", () => ({
	useActAs: () => ({ setActAs: vi.fn() }),
}));

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

import { CompDialog } from "./app.admin.sellers";

const setCompSpy = () =>
	mutationSpies.get(getFunctionName(api.subscriptions.setComp));
const revokeCompSpy = () =>
	mutationSpies.get(getFunctionName(api.subscriptions.revokeComp));

beforeEach(() => mutationSpies.clear());
afterEach(cleanup);

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
		createdAt: 0,
		purging: false,
		...overrides,
	};
}

describe("CompDialog — create", () => {
	it("defaults to free for life (no date field), sponsor kind selectable, and saves without an expiry", async () => {
		render(<CompDialog seller={seller()} onClose={vi.fn()} />);
		expect(screen.getByText("Comp Mak Kuih")).toBeTruthy();
		// Free for life is ON → no date input on screen.
		expect(screen.queryByLabelText("Ends on")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Partner" }));
		fireEvent.change(screen.getByLabelText(/Label/), {
			target: { value: "  Sponsored by Maybank SME  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Comp this store" }));
		await vi.waitFor(() => expect(setCompSpy()).toHaveBeenCalledTimes(1));
		expect(setCompSpy()).toHaveBeenCalledWith({
			retailerId: "r_comp",
			kind: "partner",
			label: "Sponsored by Maybank SME",
			note: undefined,
			expiresAt: undefined,
		});
	});

	it("turning free-for-life OFF requires a date: save is disabled with the reason VISIBLE, and a past date is refused", () => {
		render(<CompDialog seller={seller()} onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("switch", { name: "Free for life" }));
		const save = screen.getByRole("button", {
			name: "Comp this store",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect(
			screen.getByText(/Pick an end date, or switch back to free for life/),
		).toBeTruthy();
		// A past date flips the reason (the input's `min` blocks the picker UI;
		// typed/stale values still get caught).
		fireEvent.change(screen.getByLabelText("Ends on"), {
			target: { value: "2020-01-01" },
		});
		expect(save.disabled).toBe(true);
		expect(screen.getByText(/end date must be in the future/)).toBeTruthy();
		expect(setCompSpy()).not.toHaveBeenCalled();
	});

	it("a dated comp sends expiresAt at the END of the picked day (local time)", async () => {
		render(<CompDialog seller={seller()} onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("switch", { name: "Free for life" }));
		const nextYear = new Date().getFullYear() + 1;
		fireEvent.change(screen.getByLabelText("Ends on"), {
			target: { value: `${nextYear}-03-05` },
		});
		fireEvent.click(screen.getByRole("button", { name: "Comp this store" }));
		await vi.waitFor(() => expect(setCompSpy()).toHaveBeenCalledTimes(1));
		const sent = setCompSpy()?.mock.calls[0][0] as { expiresAt: number };
		expect(sent.expiresAt).toBe(
			new Date(nextYear, 2, 5, 23, 59, 59, 999).getTime(),
		);
	});
});

describe("CompDialog — edit", () => {
	const compedSeller = () =>
		seller({
			comped: true,
			subscriptionStatus: "active",
			comp: {
				kind: "sponsor",
				label: "Sponsored by Bearcamp",
				note: "deal terms",
				grantedAt: 1,
				expiresAt: new Date(
					new Date().getFullYear() + 1,
					5,
					1,
					23,
					59,
					59,
					999,
				).getTime(),
			},
		});

	it("prefills the current comp and offers Revoke", () => {
		render(<CompDialog seller={compedSeller()} onClose={vi.fn()} />);
		expect(screen.getByText("Edit comp — Mak Kuih")).toBeTruthy();
		expect((screen.getByLabelText(/Label/) as HTMLInputElement).value).toBe(
			"Sponsored by Bearcamp",
		);
		// Dated comp → the toggle is off and the date is prefilled.
		expect(
			(screen.getByLabelText("Ends on") as HTMLInputElement).value,
		).toMatch(/-06-01$/);
		expect(screen.getByRole("button", { name: "Revoke…" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
	});

	it("Revoke goes through its own confirm naming the consequence, then calls revokeComp and closes", async () => {
		const onClose = vi.fn();
		render(<CompDialog seller={compedSeller()} onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: "Revoke…" }));
		// The confirm says what the store becomes before anything happens.
		expect(screen.getByText(/straight\s+away/)).toBeTruthy();
		expect(screen.getByText(/buyers can still order/)).toBeTruthy();
		expect(revokeCompSpy()).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
		await vi.waitFor(() => expect(revokeCompSpy()).toHaveBeenCalledTimes(1));
		expect(revokeCompSpy()).toHaveBeenCalledWith({ retailerId: "r_comp" });
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
	});
});
