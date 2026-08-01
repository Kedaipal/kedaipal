// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useMutation } from "convex/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { ActAsProvider } from "../../hooks/useActAs";
import { FulfilmentTab } from "./fulfilment-tab";

// Act-as wiring regression (production bug): every settings write in this tab
// used a raw useMutation(api.retailers.updateSettings) with no retailerId, so
// under admin act-as the server resolved the target by identity and silently
// wrote to the ADMIN's own store — the acted-as store reverted on refresh.
// These tests render the real tab and assert the mutation args carry the
// acted-as id (and that the checklist stamp skips under act-as).
vi.mock("convex/react");
// The tab reads via `useQuery(convexQuery(...)).data` — mock the adapter pair
// (convexQuery passes the ref through; useQuery answers by function name).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
// The address autocomplete loads the Google Places script on mount — inert
// stub; nothing here exercises it (default charge mode is "free").
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: () => <input aria-label="address" />,
}));

const NAME = {
	updateSettings: getFunctionName(api.retailers.updateSettings),
	markSeen: getFunctionName(api.retailers.markPickupSetupSeen),
	listLocations: getFunctionName(api.pickupLocations.listForRetailer),
};

const SELLER_ID = "rt_seller_1";

describe("FulfilmentTab act-as wiring", () => {
	let updateSettings: ReturnType<typeof vi.fn>;
	let markSeen: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		updateSettings = vi.fn().mockResolvedValue({ ok: true });
		markSeen = vi.fn().mockResolvedValue({ updated: true });
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => ({
			data: getFunctionName(opts.__fn) === NAME.listLocations ? [] : undefined,
			isPending: false,
		})) as never);
		vi.mocked(useMutation).mockImplementation(((
			ref: FunctionReference<"mutation">,
		) => {
			const name = getFunctionName(ref);
			if (name === NAME.updateSettings) return updateSettings;
			if (name === NAME.markSeen) return markSeen;
			return vi.fn().mockResolvedValue(undefined);
		}) as never);
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
	});

	function renderTab() {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					minOrderValue={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	/** Change the min-notice input and click the Save button in ITS card (the
	 * tab has several Save buttons). */
	function saveMinNotice() {
		const input = screen.getByLabelText("Minimum days' notice");
		fireEvent.change(input, { target: { value: "3" } });
		const card = input.closest("section");
		if (!card) throw new Error("min-notice card not found");
		fireEvent.click(within(card).getByRole("button", { name: "Save" }));
	}

	it("saves settings with the acted-as retailerId in admin act-as", async () => {
		// Prime the act-as session before mount — the provider reads it from
		// sessionStorage, same as a refreshed act-as dashboard. Key mirrors
		// STORAGE_KEY in useActAs.tsx.
		window.sessionStorage.setItem("kp:actAsRetailerId", SELLER_ID);
		renderTab();
		saveMinNotice();
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				minFulfilmentNoticeDays: 3,
				retailerId: SELLER_ID,
			}),
		);
	});

	it("saves settings without a retailerId on the owner's own store", async () => {
		renderTab();
		saveMinNotice();
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				minFulfilmentNoticeDays: 3,
				retailerId: undefined,
			}),
		);
	});

	it("stamps pickupSetupSeen on the owner's own store only", async () => {
		renderTab();
		await waitFor(() => expect(markSeen).toHaveBeenCalledTimes(1));
	});

	it("skips the pickupSetupSeen stamp under act-as (identity-resolved — it would mark the admin's own checklist)", () => {
		window.sessionStorage.setItem("kp:actAsRetailerId", SELLER_ID);
		renderTab();
		expect(markSeen).not.toHaveBeenCalled();
	});
});
