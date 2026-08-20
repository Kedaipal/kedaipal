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
// The collection toggle's stage-editor tip renders a router Link — inert
// anchor stub, same as book-delivery-card.test.tsx.
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
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
					country="MY"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
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
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => ({
			data: getFunctionName(opts.__fn) === NAME.listLocations ? [] : undefined,
			isPending: false,
		})) as never);
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
					country="MY"
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
					openingHours={undefined}
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

describe("OpeningHoursCard (86eyp5rav)", () => {
	let updateSettings: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// The themed TimePicker's popover rides radix popper, whose floating-ui
		// positioning needs ResizeObserver — absent in jsdom. Inert polyfill.
		globalThis.ResizeObserver ??= class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as never;
		updateSettings = vi.fn().mockResolvedValue({ ok: true });
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => ({
			data: getFunctionName(opts.__fn) === NAME.listLocations ? [] : undefined,
			isPending: false,
		})) as never);
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

	function renderWithHours(
		openingHours:
			| Array<{ open: number; close: number; closed?: boolean }>
			| undefined,
	) {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country="MY"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={openingHours}
					minOrderValue={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("defaults to 'Open 24 hours, every day'; closing one day saves a 7-row schedule", async () => {
		renderWithHours(undefined);
		expect(
			screen.getByText(/Open 24 hours, every day/),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Set opening hours" }),
		);
		// The editor opens in "Same every day" seeded at the current truth
		// (00:00–23:59 = all day). Tap Sunday's chip off, save.
		fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: [
					{ open: 0, close: 1439, closed: true },
					...Array.from({ length: 6 }, () => ({ open: 0, close: 1439 })),
				],
				retailerId: undefined,
			}),
		);
	});

	it("same-every-day: one range set through the themed picker writes the whole week", async () => {
		renderWithHours(undefined);
		fireEvent.click(
			screen.getByRole("button", { name: "Set opening hours" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Opening time" }));
		fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
		fireEvent.click(screen.getByRole("button", { name: "Closing time" }));
		fireEvent.click(await screen.findByRole("button", { name: "6:00 PM" }));
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: Array.from({ length: 7 }, () => ({
					open: 540,
					close: 1080,
				})),
				retailerId: undefined,
			}),
		);
	});

	it("closing every day disables Save with the reason on screen", () => {
		renderWithHours(undefined);
		fireEvent.click(
			screen.getByRole("button", { name: "Set opening hours" }),
		);
		for (const day of [
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
			"Sunday",
		]) {
			fireEvent.click(screen.getByRole("button", { name: day }));
		}
		const save = screen.getByRole("button", {
			name: "Save hours",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect(screen.getByText(/Keep at least one day open/)).toBeTruthy();
		expect(updateSettings).not.toHaveBeenCalled();
	});

	it("an uneven week opens in 'Different per day'; one row edits alone", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ open: 540, close: 1080 }, // Monday
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		// Open days hold two different ranges -> per-day mode pre-selected.
		const perDay = screen.getByRole("button", {
			name: /Different per day/,
		});
		expect(perDay.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(
			screen.getByRole("button", { name: "Monday opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "8:00 AM" }));
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: [
					{ open: 540, close: 1080, closed: true },
					{ open: 480, close: 1080 },
					...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
				],
				retailerId: undefined,
			}),
		);
	});

	it("a configured store shows the weekly summary; Reset sends the null clear", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			...Array.from({ length: 6 }, () => ({ open: 540, close: 1080 })),
		]);
		// Summary view: window text + the closed day, no editor yet.
		expect(screen.getAllByText("9:00 AM – 6:00 PM").length).toBe(6);
		expect(screen.getByText("Closed")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Reset to open 24/7" }),
		);
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: null,
				retailerId: undefined,
			}),
		);
	});
});
