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
import { COUNTRY_CURRENCY } from "../../../convex/lib/country";
import { ActAsProvider } from "../../hooks/useActAs";
import { SETTINGS_ANCHOR } from "../../lib/country-setup-copy";
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

// Every test here renders the ENTIRE FulfilmentTab (cards, hours editor, DnD
// list) in jsdom, and the OpeningHoursCard tests then drive radix-popper time
// pickers through multiple re-renders — measured right at vitest's 5s default
// when the whole suite runs in parallel workers (isolated: ~1s). Raise the
// file's budget so a loaded machine doesn't flake the gate.
vi.setConfig({ testTimeout: 20_000 });

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
					currency="MYR"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					minOrderValue={undefined}
					awbConfig={undefined}
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
					currency="MYR"
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
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	function saveLalamoveCard() {
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
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
					currency="MYR"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={openingHours}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("defaults to 'Open 24 hours, every day'; closing one day saves a 7-row schedule", async () => {
		renderWithHours(undefined);
		expect(screen.getByText(/Open 24 hours, every day/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Set opening hours" }));
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
		fireEvent.click(screen.getByRole("button", { name: "Set opening hours" }));
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
		fireEvent.click(screen.getByRole("button", { name: "Set opening hours" }));
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
		fireEvent.click(screen.getByRole("button", { name: "Reset to open 24/7" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: null,
				retailerId: undefined,
			}),
		);
	});
});

describe("SG delivery-charge modes (SG-lite, 86eynw29u)", () => {
	beforeEach(() => {
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => ({
			data: getFunctionName(opts.__fn) === NAME.listLocations ? [] : undefined,
			isPending: false,
		})) as never);
		vi.mocked(useMutation).mockImplementation((() =>
			vi.fn().mockResolvedValue({ ok: true })) as never);
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
	});

	function renderTab(
		country: "MY" | "SG",
		deliveryConfig?: Parameters<typeof FulfilmentTab>[0]["deliveryConfig"],
	) {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country={country}
					currency={COUNTRY_CURRENCY[country]}
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={deliveryConfig}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("an SG store sees Live + Free + Flat, with the MY-only pair explained", () => {
		// Live pricing arrived with Lalamove SG (z8r3fdch3r) — only the
		// geography-shaped modes stay Malaysian.
		renderTab("SG");
		expect(
			screen.getByRole("button", { name: /live courier price/i }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /Free/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Flat fee/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /By distance/ })).toBeNull();
		expect(
			screen.queryByRole("button", { name: /By weight & zone/ }),
		).toBeNull();
		// The missing cards are explained, never a mystery.
		expect(screen.getByText(/Malaysia-only for now/)).toBeTruthy();
	});

	it("an MY store keeps all five mode cards and no SG reason line", () => {
		renderTab("MY");
		expect(screen.getByRole("button", { name: /By distance/ })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /By weight & zone/ }),
		).toBeTruthy();
		expect(screen.queryByText(/Malaysia-only for now/)).toBeNull();
	});

	it("an SG store's money fields wear S$, never RM (86eyqgujv)", () => {
		// Zaki's report: a Singapore store's delivery + minimum-order fields
		// still quoted Malaysian ringgit. The symbol now comes from the store's
		// currency, so the flat-fee prefix and the min-order label follow it.
		renderTab("SG", { mode: "flat", fee: 500 });
		expect(screen.getAllByText("S$").length).toBeGreaterThan(0);
		expect(screen.queryByText("RM")).toBeNull();
		expect(screen.getByText(/Minimum subtotal \(S\$\)/)).toBeTruthy();
	});

	it("an MY store is untouched — the same fields still wear RM", () => {
		renderTab("MY", { mode: "flat", fee: 500 });
		expect(screen.getAllByText("RM").length).toBeGreaterThan(0);
		expect(screen.queryByText("S$")).toBeNull();
		expect(screen.getByText(/Minimum subtotal \(RM\)/)).toBeTruthy();
	});

	it("an SG store can reach the business address at all (86eyqgujv)", () => {
		// The field used to render ONLY inside the radius and Lalamove mode
		// panels, both Malaysia-only — so a Singapore store had no way to set a
		// business address, and therefore no return address on any despatch
		// label it printed. Its own always-visible card fixes that.
		renderTab("SG", { mode: "flat", fee: 500 });
		expect(screen.getByText("Business address")).toBeTruthy();
		expect(screen.getByText(/return address on despatch labels/i)).toBeTruthy();
	});

	it("MY keeps one editor too — the duplicated pickers are gone", () => {
		// It was duplicated once in radius mode and once in Lalamove mode. One
		// card, one save; the modes now reference it instead of owning a copy.
		renderTab("MY", {
			mode: "radius",
			bands: [{ maxKm: 5, fee: 500 }],
			outOfRange: "arrange",
		});
		expect(screen.getAllByText("Business address")).toHaveLength(1);
	});

	it("a mode that needs the address, without one, points at the card", () => {
		renderTab("MY", {
			mode: "radius",
			bands: [{ maxKm: 5, fee: 500 }],
			outOfRange: "arrange",
		});
		expect(screen.getByText(/Set your business address first/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /Go to Business address/ }),
		).toBeTruthy();
	});

	it("a deep link rings the exact card, and only that card (86eyqgujv)", () => {
		// The checklist links here; landing at the top of a long tab and making
		// the seller hunt is what this replaces.
		const { container } = render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country="SG"
					currency="SGD"
					fix={{
						anchor: SETTINGS_ANCHOR.business_address,
						highlight: "error",
					}}
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={{ mode: "flat", fee: 500 }}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
		const ringed = container.querySelectorAll("[data-fix-highlight]");
		expect(ringed).toHaveLength(1);
		expect(ringed[0]?.id).toBe(SETTINGS_ANCHOR.business_address);
		// Verifiable rows earn a real error ring — we KNOW the address is in the
		// wrong country. An unverifiable row would be amber instead, because a
		// red border on a bank account we can't check would be a false claim.
		expect(ringed[0]?.getAttribute("data-fix-highlight")).toBe("error");
	});

	it("no deep link means no ring anywhere — never a permanent red border", () => {
		const { container } = renderTab("SG", { mode: "flat", fee: 500 });
		expect(container.querySelectorAll("[data-fix-highlight]")).toHaveLength(0);
	});

	it("an SG store stuck on a stored MY-only mode gets the amber repair note", () => {
		renderTab("SG", {
			mode: "radius",
			bands: [{ maxKm: 5, fee: 500 }],
			outOfRange: "arrange",
		});
		expect(screen.getByText(/uses a Malaysia-only mode/)).toBeTruthy();
	});
});

describe("live courier pricing (z8r3fdbvdy)", () => {
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

	// The mode used to be Lalamove's. It now prices across every armed
	// provider, so the tile, the copy and the saved value all had to stop
	// naming one of them.
	function renderLive(
		over: {
			config?: { mode: "live" | "lalamove"; onUnquotable: "block" } | undefined;
			hasKeys?: boolean;
		} = {},
	) {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country="MY"
					currency="MYR"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={over.config}
					businessAddress={{
						label: "HQ",
						latitude: 3.1,
						longitude: 101.6,
					}}
					deliveryBooking={
						over.hasKeys === false
							? undefined
							: {
									enabled: true,
									vehicleType: "MOTORCYCLE",
									hasCredentials: true,
									promptBookOnPacked: false,
									deliveryDirection: "standard",
									apiKeyHint: "abcd",
								}
					}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("saves the provider-aware mode, not the Lalamove one", async () => {
		renderLive();
		fireEvent.click(screen.getByRole("button", { name: /live courier price/i }));
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryConfig).toEqual({
			mode: "live",
			onUnquotable: "block",
		});
	});

	it("a store still on the pre-migration mode shows as selected", () => {
		renderLive({ config: { mode: "lalamove", onUnquotable: "block" } });
		expect(
			screen
				.getByRole("button", { name: /live courier price/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("offers exactly one live-pricing tile — the mode grid, nothing else", () => {
		renderLive();
		expect(
			screen.getAllByRole("button", { name: /live courier price/i }),
		).toHaveLength(1);
	});

	it("names both providers on the tile — not just the rider one", () => {
		const { container } = renderLive();
		fireEvent.click(screen.getByRole("button", { name: /live courier price/i }));
		expect(container.querySelector('img[alt="Delyva"]')).toBeTruthy();
		expect(container.querySelector('img[alt="Lalamove"]')).toBeTruthy();
	});

	it("says what will be quoted, and refuses when nothing is connected", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(screen.getByRole("button", { name: /live courier price/i }));
		expect(container.textContent).toContain("Nothing is connected yet");
		expect(container.textContent).toContain("Settings → Integrations");
	});

	it("hides the rider-only controls when no rider bids", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(screen.getByRole("button", { name: /live courier price/i }));
		// The vehicle picker is a Lalamove setting — meaningless for a
		// parcel-only store, and it used to render regardless.
		expect(container.textContent).not.toContain("Default vehicle");
	});

	it("keeps the rider controls when Lalamove is connected", () => {
		const { container } = renderLive();
		fireEvent.click(screen.getByRole("button", { name: /live courier price/i }));
		expect(container.textContent).toContain("Default vehicle");
	});
})
