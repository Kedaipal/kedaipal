// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
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
		vi.mocked(useQuery).mockImplementation(((
			ref: FunctionReference<"query">,
		) =>
			getFunctionName(ref) === NAME.listLocations ? [] : undefined) as never);
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

describe("Collection service toggle (86eyg0n8e)", () => {
	let updateSettings: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		updateSettings = vi.fn().mockResolvedValue({ ok: true });
		vi.mocked(useQuery).mockImplementation(((
			ref: FunctionReference<"query">,
		) =>
			getFunctionName(ref) === NAME.listLocations ? [] : undefined) as never);
		vi.mocked(useMutation).mockImplementation(((
			ref: FunctionReference<"mutation">,
		) =>
			getFunctionName(ref) === NAME.updateSettings
				? updateSettings
				: vi.fn().mockResolvedValue(undefined)) as never);
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
	});

	function renderLalamoveTab(
		deliveryDirection: "standard" | "collection" = "standard",
	) {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={{ mode: "lalamove", onUnquotable: "block" }}
					businessAddress={{
						label: "Wash Bay HQ",
						latitude: 3.1,
						longitude: 101.6,
					}}
					deliveryBooking={{
						enabled: true,
						vehicleType: "MOTORCYCLE",
						hasCredentials: true,
						promptBookOnPacked: false,
						deliveryDirection,
						apiKeyHint: "abcd",
					}}
					minFulfilmentNoticeDays={undefined}
					minOrderValue={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	function saveLalamoveCard() {
		fireEvent.click(
			screen.getByRole("button", { name: "Save Lalamove delivery" }),
		);
	}

	it("turning the toggle ON saves deliveryDirection: 'collection'", async () => {
		renderLalamoveTab("standard");
		const toggle = screen.getByRole("switch", { name: "Collection service" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(toggle);
		saveLalamoveCard();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryBooking).toMatchObject({
			enabled: true,
			deliveryDirection: "collection",
		});
	});

	it("a stored collection store renders the toggle ON and an unchanged save keeps it", async () => {
		renderLalamoveTab("collection");
		const toggle = screen.getByRole("switch", { name: "Collection service" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		saveLalamoveCard();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(
			updateSettings.mock.calls[0][0].deliveryBooking.deliveryDirection,
		).toBe("collection");
	});

	it("turning it OFF saves an explicit 'standard' (really clears, not merge-keeps)", async () => {
		renderLalamoveTab("collection");
		fireEvent.click(screen.getByRole("switch", { name: "Collection service" }));
		saveLalamoveCard();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(
			updateSettings.mock.calls[0][0].deliveryBooking.deliveryDirection,
		).toBe("standard");
	});
});
