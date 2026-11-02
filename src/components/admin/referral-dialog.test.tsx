// @vitest-environment jsdom
// Admin "Referred by" fix-up (z8r3fdetf5): set, change and remove a referral
// the link didn't capture — what the mutations are called with, the server's
// refusal shown where the admin typed, and removal behind its own confirm.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";

const mutationSpies = new Map<string, ReturnType<typeof vi.fn>>();
vi.mock("convex/react", () => ({
	useMutation: (ref: FunctionReference<"mutation">) => {
		const name = getFunctionName(ref);
		if (!mutationSpies.has(name)) {
			mutationSpies.set(name, vi.fn().mockResolvedValue(null));
		}
		return mutationSpies.get(name);
	},
}));

import { ReferralDialog } from "./referral-dialog";

const clearSpy = () =>
	mutationSpies.get(getFunctionName(api.referrals.adminClearReferral));

beforeEach(() => {
	mutationSpies.clear();
});
afterEach(cleanup);

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_new" as AdminSellerRow["_id"],
		storeName: "New Kedai",
		slug: "new-kedai",
		ownerUserId: "u_owner",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		foundingIntent: false,
		subscriptionStatus: "trialing",
		plan: "pro",
		comped: false,
		createdAt: 0,
		unclaimed: false,
		referralEditable: true,
		hasPaidInvoice: false,
		acquisition: { suggested: null },
		purging: false,
		marketplace: { internal: false },
		country: "MY",
		currency: "MYR",
		billingCurrency: "MYR",
		availability: { state: "open" },
		...overrides,
	};
}

function primeSet(): ReturnType<typeof vi.fn> {
	const name = getFunctionName(api.referrals.adminSetReferrer);
	const spy = vi.fn().mockResolvedValue(null);
	mutationSpies.set(name, spy);
	return spy;
}

describe("ReferralDialog", () => {
	it("states what a referral does, and sets one from the referrer's link", async () => {
		const spy = primeSet();
		const onClose = vi.fn();
		render(<ReferralDialog seller={seller()} onClose={onClose} />);
		expect(
			screen.getByText(/60 bonus credits on Pro \(30 on Starter\)/),
		).toBeTruthy();
		const field = screen.getByLabelText(/Referrer's store link/);
		const submit = screen.getByRole("button", { name: "Set referrer" });
		// Nothing to send yet — disabled, not wrong-but-enabled.
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(field, { target: { value: "  Siti-Kitchen " } });
		fireEvent.click(submit);
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		expect(spy).toHaveBeenCalledWith({
			refereeId: "r_new",
			referrerSlug: "siti-kitchen",
		});
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		// No remove control on a store with no referral.
		expect(
			screen.queryByRole("button", { name: "Remove referral" }),
		).toBeNull();
	});

	it("shows the server's refusal under the field and keeps the dialog open", async () => {
		const name = getFunctionName(api.referrals.adminSetReferrer);
		const { ConvexError } = await import("convex/values");
		mutationSpies.set(
			name,
			vi
				.fn()
				.mockRejectedValue(
					new ConvexError(
						"Siti's Kitchen can't refer right now: it is still on its free trial — a store refers once its plan is paid.",
					),
				),
		);
		const onClose = vi.fn();
		render(<ReferralDialog seller={seller()} onClose={onClose} />);
		fireEvent.change(screen.getByLabelText(/Referrer's store link/), {
			target: { value: "siti-kitchen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set referrer" }));
		expect(await screen.findByText(/still on its free trial/)).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("changes an existing referral, and removal goes through its own confirm", async () => {
		const withReferral = seller({
			referral: {
				referrer: { slug: "siti-kitchen", storeName: "Siti's Kitchen" },
				via: "link",
				at: 0,
			},
		});
		const onClose = vi.fn();
		render(<ReferralDialog seller={withReferral} onClose={onClose} />);
		const field = screen.getByLabelText(
			/Referrer's store link/,
		) as HTMLInputElement;
		expect(field.value).toBe("siti-kitchen");
		// Unchanged value — nothing to change.
		expect(
			(
				screen.getByRole("button", {
					name: "Change referrer",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Remove referral" }));
		expect(
			await screen.findByText(
				/Nobody will get referral bonus credits when New Kedai pays its first invoice/,
			),
		).toBeTruthy();
		const confirms = screen.getAllByRole("button", { name: "Remove referral" });
		fireEvent.click(confirms[confirms.length - 1] as HTMLElement);
		await vi.waitFor(() => expect(clearSpy()).toHaveBeenCalledTimes(1));
		expect(clearSpy()).toHaveBeenCalledWith({ refereeId: "r_new" });
	});
});
