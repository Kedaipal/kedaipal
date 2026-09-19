// @vitest-environment jsdom
// Comp upgrade toggle dialog (z8r3fdeub2): off → turn on, on → edit or turn
// off, no end date anywhere, and what the mutations are called with.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";
import { formatShortDate } from "../lib/format";

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

describe("CompDialog — comp upgrade OFF", () => {
	it("states it's off, has no end date to set, and turning it on sends the trimmed details", async () => {
		const onClose = vi.fn();
		render(<CompDialog seller={seller()} onClose={onClose} />);
		expect(screen.getByText("Comp upgrade — Mak Kuih")).toBeTruthy();
		expect(screen.getByText("Off")).toBeTruthy();
		// A comp is a toggle with no expiry — nothing to pick.
		expect(screen.queryByLabelText(/Ends on/)).toBeNull();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.getByText(/no end date/i)).toBeTruthy();
		// No "turn off" on a store that isn't comped.
		expect(screen.queryByRole("button", { name: "Turn off…" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Partner" }));
		fireEvent.change(screen.getByLabelText(/Label/), {
			target: { value: "  Sponsored by Maybank SME  " },
		});
		fireEvent.change(screen.getByLabelText(/Note/), {
			target: { value: "  Signed 14 Sep  " },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Turn on comp upgrade" }),
		);
		await vi.waitFor(() => expect(setCompSpy()).toHaveBeenCalledTimes(1));
		expect(setCompSpy()).toHaveBeenCalledWith({
			retailerId: "r_comp",
			kind: "partner",
			label: "Sponsored by Maybank SME",
			note: "Signed 14 Sep",
		});
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
	});
});

describe("CompDialog — comp upgrade ON", () => {
	const grantedAt = new Date(2026, 8, 14).getTime();
	const compedSeller = () =>
		seller({
			comped: true,
			subscriptionStatus: "active",
			comp: {
				kind: "sponsor",
				label: "Sponsored by Bearcamp",
				note: "deal terms",
				grantedAt,
			},
		});

	it("states it's on and since when, prefills the details, and saves edits without turning anything off", async () => {
		render(<CompDialog seller={compedSeller()} onClose={vi.fn()} />);
		expect(
			screen.getByText(`On · since ${formatShortDate(grantedAt)}`),
		).toBeTruthy();
		expect((screen.getByLabelText(/Label/) as HTMLInputElement).value).toBe(
			"Sponsored by Bearcamp",
		);
		expect((screen.getByLabelText(/Note/) as HTMLTextAreaElement).value).toBe(
			"deal terms",
		);
		expect(screen.getByRole("button", { name: "Turn off…" })).toBeTruthy();
		fireEvent.change(screen.getByLabelText(/Label/), {
			target: { value: "Sponsored by Bearcamp Outdoors" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() => expect(setCompSpy()).toHaveBeenCalledTimes(1));
		expect(setCompSpy()).toHaveBeenCalledWith({
			retailerId: "r_comp",
			kind: "sponsor",
			label: "Sponsored by Bearcamp Outdoors",
			note: "deal terms",
		});
		expect(revokeCompSpy()).not.toHaveBeenCalled();
	});

	it("Turn off goes through its own confirm naming the consequence, then calls revokeComp and closes", async () => {
		const onClose = vi.fn();
		render(<CompDialog seller={compedSeller()} onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: "Turn off…" }));
		// The confirm says what the store becomes before anything happens — and
		// says the WHOLE consequence: the dashboard goes view-only (z8r3fdeub2),
		// not just "can't edit products". This is the screen where an admin cuts
		// a partner off, so understating it here is the expensive kind of wrong.
		expect(screen.getByText(/straight\s+away/)).toBeTruthy();
		expect(screen.getByText(/buyers can still order/)).toBeTruthy();
		expect(screen.getByText(/view-only/)).toBeTruthy();
		expect(screen.getByText(/work\s+their orders/)).toBeTruthy();
		expect(revokeCompSpy()).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Turn off comp upgrade" }),
		);
		await vi.waitFor(() => expect(revokeCompSpy()).toHaveBeenCalledTimes(1));
		expect(revokeCompSpy()).toHaveBeenCalledWith({ retailerId: "r_comp" });
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
	});
});
