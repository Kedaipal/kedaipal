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
					closedDates={undefined}
					hasBookingListings={false}
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
					closedDates={undefined}
					hasBookingListings={false}
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
			| Array<{
					open: number;
					close: number;
					closed?: boolean;
					open2?: number;
					close2?: number;
			  }>
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
					closedDates={undefined}
					hasBookingListings={false}
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

	// ---------------------------------------------------------------------
	// Split days — two windows (z8r3fdff8r)
	// ---------------------------------------------------------------------

	/** Huff & Puff: breakfast 7:30–10:00, then the cafe window 12:00–18:00. */
	const SPLIT = { open: 450, close: 600, open2: 720, close2: 1080 };

	it("same-every-day: ONE 'Add a second window' splits the whole week", async () => {
		renderWithHours(
			Array.from({ length: 7 }, () => ({ open: 450, close: 600 })),
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		// The bulk affordance: seven days, one click — not seven.
		fireEvent.click(
			screen.getByRole("button", { name: /Add a second window/ }),
		);
		// Suggested break: two hours after close, six hours long. The range is its
		// own unbreakable span, so match on the whole line's text.
		expect(
			screen.getByText(
				(_, el) =>
					el?.tagName === "P" &&
					/^Closed 10:00 AM – 12:00 PM/.test(el.textContent ?? ""),
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: Array.from({ length: 7 }, () => ({ ...SPLIT })),
				retailerId: undefined,
			}),
		);
	});

	it("a week that shares one SPLIT schedule still opens in 'Same every day'", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		expect(
			screen
				.getByRole("button", { name: /Same every day/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("Second window")).toBeTruthy();
	});

	it("removing the second window saves a plain day, byte-identical to before", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Remove second window" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: Array.from({ length: 7 }, () => ({
					open: 450,
					close: 600,
				})),
				retailerId: undefined,
			}),
		);
	});

	it("a second window starting before the first closes blocks Save, in the server's own words", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Second window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
		expect(
			screen.getByText(/second window must start after 10:00 AM/i),
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Save hours" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("an all-day first window disables the add control WITH ITS REASON", () => {
		renderWithHours(undefined); // unset = 00:00–23:59 every day
		fireEvent.click(screen.getByRole("button", { name: "Set opening hours" }));
		const add = screen.getByRole("button", { name: /Add a second window/ });
		expect(add.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText(/already open 24 hours — narrow the first window/i),
		).toBeTruthy();
	});

	it("per-day: splitting ONE row leaves the other six alone", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ open: 450, close: 600 }, // Monday
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		// Six open rows carry an add control each; Monday's is the first in
		// render order (Monday-first), so target it by its own row.
		const adds = screen.getAllByRole("button", {
			name: /Add a second window/,
		});
		fireEvent.click(adds[0]);
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: [
					{ open: 540, close: 1080, closed: true },
					{ ...SPLIT },
					...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
				],
				retailerId: undefined,
			}),
		);
	});

	it("the read-only summary stacks both windows, one per line", () => {
		renderWithHours([
			{ open: 540, close: 900 }, // Sunday, unsplit
			...Array.from({ length: 6 }, () => ({ ...SPLIT })),
		]);
		// Each window is its own line, the storefront dialog's reading, so a
		// split day never wraps mid-range on a phone.
		expect(screen.getAllByText("7:30 AM – 10:00 AM").length).toBe(6);
		expect(screen.getAllByText("12:00 PM – 6:00 PM").length).toBe(6);
		expect(screen.getByText("9:00 AM – 3:00 PM")).toBeTruthy();
	});

	// --- test-round fixes (z8r3fdff8r, 17 Sep) ------------------------------

	it("only the OFFENDING window turns red, and its sentence sits under it", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Second window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
		const invalid = (name: string) =>
			screen.getByRole("button", { name }).getAttribute("aria-invalid");
		expect(invalid("Second window opening time")).toBe("true");
		expect(invalid("Second window closing time")).toBe("true");
		// The first window is fine and must not be painted as wrong.
		expect(invalid("First window opening time")).toBeNull();
		expect(invalid("First window closing time")).toBeNull();
		// The sentence comes BEFORE the day chips, right under the pickers, not at
		// the foot of the card.
		const sentence = screen.getByText(
			"The second window must start after 10:00 AM.",
		);
		const chips = screen.getByText("Open on");
		expect(
			sentence.compareDocumentPosition(chips) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("an all-day first window paints the SECOND window, since removing it is the fix", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "First window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "12:00 AM" }));
		fireEvent.click(
			screen.getByRole("button", { name: "First window closing time" }),
		);
		const lists = await screen.findAllByRole("button", { name: "11:59 PM" });
		fireEvent.click(lists[lists.length - 1]);
		expect(
			screen.getByText(
				"The first window already covers the whole day — remove the second window.",
			),
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "First window opening time" })
				.getAttribute("aria-invalid"),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Second window opening time" })
				.getAttribute("aria-invalid"),
		).toBe("true");
	});

	it("per-day: the error sits on its row, and a disabled Save names the rows to fix", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ ...SPLIT }, // Monday
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Monday second window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
		expect(
			screen.getByText("The second window must start after 10:00 AM."),
		).toBeTruthy();
		expect(screen.getByText("Fix the hours for Monday to save.")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Save hours" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("per-day: the remove control sits UNDER a day's windows, never beside its pickers", () => {
		const { container } = renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday, closed → no row
			{ ...SPLIT }, // Monday, split
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		// A 44px button beside the pickers cost each picker 25px: on a 360px phone
		// every time read "6:30 …" and the AM/PM a split schedule turns on was
		// gone. A picker row now holds its two pickers and nothing else.
		const remove = screen.getByRole("button", {
			name: "Remove second window on Monday",
		});
		const pickerRow = screen.getByRole("button", {
			name: "Monday second window opening time",
		}).parentElement as HTMLElement;
		expect(pickerRow.contains(remove)).toBe(false);
		// …and no empty column is reserved to line rows up any more.
		expect(
			container.querySelectorAll('span.size-11[aria-hidden="true"]').length,
		).toBe(0);
	});

	it("per-day: a FIRST-window error sits between the windows and names its window", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ ...SPLIT }, // Monday: 7:30–10:00 AM, then 12:00–6:00 PM
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Monday first window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "11:00 AM" }));
		const sentence = screen.getByText(
			"The first window's opening time must be before its closing time.",
		);
		// Printed after BOTH rows, it read as a complaint about the second window,
		// which is fine. It must come before the second window's pickers.
		const secondPicker = screen.getByRole("button", {
			name: "Monday second window opening time",
		});
		expect(
			sentence.compareDocumentPosition(secondPicker) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("same-every-day: a first-window error sits under the FIRST window", async () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(
			screen.getByRole("button", { name: "First window opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "11:00 AM" }));
		const sentence = screen.getByText(
			"The first window's opening time must be before its closing time.",
		);
		expect(
			sentence.compareDocumentPosition(screen.getByText("Second window")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("switching to 'Same every day' SAYS it replaced different per-day hours — and switching back restores them", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ ...SPLIT }, // Monday
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: /Same every day/ }));
		expect(
			screen.getByText(
				"Every day now uses Monday's hours. Switch back to Different per day to restore each day's own hours.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Different per day/ }));
		expect(screen.queryByText(/Every day now uses/)).toBeNull();
		expect(
			screen.getByRole("button", { name: "Tuesday opening time" }).textContent,
		).toContain("10:00 AM");
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: [
					{ open: 540, close: 1080, closed: true },
					{ ...SPLIT },
					...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
				],
				retailerId: undefined,
			}),
		);
	});

	it("per-day hours typed in THIS session survive a trip through 'Same every day'", async () => {
		// The live-test case: the SAVED week is uniform, so Cancel — all the old
		// note offered — could only ever restore that, and the per-day hours
		// typed since were lost while the note promised to keep them.
		renderWithHours(
			Array.from({ length: 7 }, () => ({ open: 600, close: 1200 })),
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: /Different per day/ }));
		fireEvent.click(
			screen.getByRole("button", { name: "Monday opening time" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "8:00 AM" }));
		fireEvent.click(screen.getByRole("button", { name: /Same every day/ }));
		expect(
			screen.getByText(/Switch back to Different per day to restore/),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Different per day/ }));
		expect(
			screen.getByRole("button", { name: "Monday opening time" }).textContent,
		).toContain("8:00 AM");
		expect(
			screen.getByRole("button", { name: "Tuesday opening time" }).textContent,
		).toContain("10:00 AM");
	});

	it("re-tapping the active mode keeps the note and the hours it promises back", () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			{ ...SPLIT }, // Monday
			...Array.from({ length: 5 }, () => ({ open: 600, close: 1200 })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: /Same every day/ }));
		fireEvent.click(screen.getByRole("button", { name: /Same every day/ }));
		expect(screen.getByText(/Every day now uses Monday's hours/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Different per day/ }));
		expect(
			screen.getByRole("button", { name: "Tuesday opening time" }).textContent,
		).toContain("10:00 AM");
	});

	it("an identical week switches modes without a note: nothing was replaced", () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: /Different per day/ }));
		fireEvent.click(screen.getByRole("button", { name: /Same every day/ }));
		expect(screen.queryByText(/Every day now uses/)).toBeNull();
	});

	it("add and remove are full 44px targets, pulled back to text height", () => {
		renderWithHours(Array.from({ length: 7 }, () => ({ ...SPLIT })));
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		const remove = screen.getByRole("button", { name: "Remove second window" });
		expect(remove.className).toContain("min-h-11");
		// Negative vertical margins keep the column's rhythm at text height.
		expect(remove.className).toContain("-my-2.5");
		fireEvent.click(remove);
		const add = screen.getByRole("button", { name: /Add a second window/ });
		expect(add.className).toContain("min-h-11");
	});

	it("a configured store shows the weekly summary; Reset fills the editor instead of saving on the spot", async () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			...Array.from({ length: 6 }, () => ({ open: 540, close: 1080 })),
		]);
		// Summary view: window text + the closed day, no editor yet.
		expect(screen.getAllByText("9:00 AM – 6:00 PM").length).toBe(6);
		expect(screen.getByText("Closed")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: "Reset to open 24/7" }));
		// Nothing is saved: a slip beside Cancel no longer wipes the week.
		expect(updateSettings).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Opening time" }).textContent,
		).toContain("12:00 AM");
		expect(
			screen.getByRole("button", { name: "Closing time" }).textContent,
		).toContain("11:59 PM");
		// The draft IS open 24/7 now, so the control stops offering itself.
		expect(
			screen.queryByRole("button", { name: "Reset to open 24/7" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
		// An all-day week — the server stores it as unset, which is exactly what
		// the old instant clear wrote.
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith({
				openingHours: Array.from({ length: 7 }, () => ({
					open: 0,
					close: 1439,
				})),
				retailerId: undefined,
			}),
		);
	});

	it("Cancel after Reset keeps the saved week untouched", () => {
		renderWithHours([
			{ open: 540, close: 1080, closed: true }, // Sunday
			...Array.from({ length: 6 }, () => ({ ...SPLIT })),
		]);
		fireEvent.click(screen.getByRole("button", { name: "Edit hours" }));
		fireEvent.click(screen.getByRole("button", { name: "Reset to open 24/7" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(updateSettings).not.toHaveBeenCalled();
		expect(screen.getAllByText("7:30 AM – 10:00 AM").length).toBe(6);
		expect(screen.getByText("Closed")).toBeTruthy();
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
					closedDates={undefined}
					hasBookingListings={false}
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
					target={{
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
					closedDates={undefined}
					hasBookingListings={false}
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
					closedDates={undefined}
					hasBookingListings={false}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("saves the provider-aware mode, not the Lalamove one", async () => {
		renderLive();
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
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
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		expect(container.querySelector('img[alt="Delyva"]')).toBeTruthy();
		expect(container.querySelector('img[alt="Lalamove"]')).toBeTruthy();
	});

	it("says what will be quoted, and refuses when nothing is connected", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		expect(container.textContent).toContain("Nothing can quote yet");
		expect(container.textContent).toContain("Integrations");
	});

	it("shows a status chip per provider, not a Lalamove-only section", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		// Both providers get a row and a chip even when unarmed — connection
		// state was previously a Lalamove-only section a screen away.
		expect(container.textContent).toContain("Riders");
		expect(container.textContent).toContain("Couriers");
		expect(screen.getAllByText("Not connected").length).toBe(2);
	});

	it("never shows the test-mode note for a store with NO Lalamove keys (Zaki's bug)", () => {
		// The old banner keyed off env === "sandbox" alone, so a keyless row
		// with a stale env stamp warned about Lalamove test keys on a store
		// that only had Delyva.
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		expect(container.textContent).not.toContain("Test mode");
	});

	it("hides the rider-only controls when no rider bids", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		// The vehicle picker is a Lalamove setting — meaningless for a
		// parcel-only store, and it used to render regardless.
		expect(container.textContent).not.toContain("Default vehicle");
	});

	it("keeps the rider controls when Lalamove is connected", () => {
		const { container } = renderLive();
		fireEvent.click(
			screen.getByRole("button", { name: /live courier price/i }),
		);
		expect(container.textContent).toContain("Default vehicle");
	});
});

describe("live-mode saves respect the toggles (Zaki, 6 Sep)", () => {
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

	function renderArmed(bookingEnabled: boolean) {
		return render(
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country="MY"
					currency="MYR"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={{ mode: "live", onUnquotable: "block" }}
					businessAddress={{ label: "HQ", latitude: 3.1, longitude: 101.6 }}
					deliveryBooking={{
						enabled: bookingEnabled,
						vehicleType: "MOTORCYCLE",
						hasCredentials: true,
						promptBookOnPacked: false,
						deliveryDirection: "standard",
						apiKeyHint: "abcd",
					}}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					closedDates={undefined}
					hasBookingListings={false}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("saving live pricing never force-re-arms rider booking", async () => {
		renderArmed(true);
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		// The toggles own the bidders — a save must not overwrite them.
		expect(updateSettings.mock.calls[0][0].deliveryBooking).toBeUndefined();
	});

	it("refuses the save when nothing is ARMED — keys alone don't bid", async () => {
		const { container } = renderArmed(false);
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
		await new Promise((r) => setTimeout(r, 10));
		expect(updateSettings).not.toHaveBeenCalled();
		expect(container.textContent).toContain(
			"Turn on at least one service under Courier booking",
		);
	});
});

describe("Business address — unit / floor line (z8r3fdff8r test round)", () => {
	let updateSettings: ReturnType<typeof vi.fn>;

	beforeEach(() => {
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

	function tab(
		businessAddress:
			| { label: string; latitude: number; longitude: number; unit?: string }
			| undefined,
	) {
		return (
			<ActAsProvider>
				<FulfilmentTab
					retailerId={SELLER_ID as never}
					country="MY"
					currency="MYR"
					offerSelfCollect={false}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={businessAddress}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					closedDates={undefined}
					hasBookingListings={false}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>
		);
	}

	const unitInput = () =>
		screen.getByLabelText(/Unit \/ floor \/ building/) as HTMLInputElement;
	const saveAddress = () =>
		screen.getByRole("button", { name: "Save address" });

	it("with no address yet, the unit waits and SAYS why, instead of silently refusing to save", () => {
		render(tab(undefined));
		expect(unitInput().disabled).toBe(true);
		expect(
			screen.getByText(
				"Pick your address first — the unit rides in front of it.",
			),
		).toBeTruthy();
	});

	it("with an address, the unit is editable and its cap is stated up front", () => {
		render(tab({ label: "12 Jln Tun Razak", latitude: 3.1, longitude: 101.6 }));
		expect(unitInput().disabled).toBe(false);
		expect(screen.getByText(/Up to 80 characters\./)).toBeTruthy();
		expect(saveAddress().hasAttribute("disabled")).toBe(true);
	});

	it("saving stores the SERVER's spelling, shows it back, and Save goes quiet", async () => {
		const stored = {
			label: "12 Jln Tun Razak",
			latitude: 3.1,
			longitude: 101.6,
		};
		const { rerender } = render(tab(stored));
		fireEvent.change(unitInput(), {
			target: { value: "  Unit 3-1,    Block B  " },
		});
		expect(saveAddress().hasAttribute("disabled")).toBe(false);
		fireEvent.click(saveAddress());
		await waitFor(() =>
			expect(updateSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					businessAddress: expect.objectContaining({
						label: "12 Jln Tun Razak",
						unit: "Unit 3-1, Block B",
					}),
				}),
			),
		);
		// The field shows what was stored, not the padded text that was typed.
		await waitFor(() => expect(unitInput().value).toBe("Unit 3-1, Block B"));
		// Convex pushes the saved row back. Nothing is left to save.
		rerender(tab({ ...stored, unit: "Unit 3-1, Block B" }));
		expect(saveAddress().hasAttribute("disabled")).toBe(true);
	});

	it("whitespace-only is a real change back to 'no unit', not a phantom edit", () => {
		render(
			tab({
				label: "12 Jln Tun Razak",
				latitude: 3.1,
				longitude: 101.6,
				unit: "Unit 3-1, Block B",
			}),
		);
		fireEvent.change(unitInput(), { target: { value: "   " } });
		expect(saveAddress().hasAttribute("disabled")).toBe(false);
		// Re-typing the stored spelling with extra spaces is NOT a change.
		fireEvent.change(unitInput(), {
			target: { value: " Unit 3-1,  Block B " },
		});
		expect(saveAddress().hasAttribute("disabled")).toBe(true);
	});
});

describe("event-venue badge on pickup points (z8r3fdff9u round 5)", () => {
	// A hidden point can still be an event's venue — the row must SAY so, or
	// "hide" reads as "gone everywhere" and the seller wonders why guests are
	// still being sent to a point she thought she removed.
	const VENUE_USAGE = getFunctionName(api.products.eventVenueUsage);

	const LOCATIONS = [
		{
			_id: "loc_active",
			label: "The Studio",
			address: "12 Jln Tun Razak, 50400 KL",
			isActive: true,
			sortOrder: 0,
		},
		{
			_id: "loc_hidden",
			label: "The Hall",
			address: "5 Jalan Acara, 50480 KL",
			isActive: false,
			sortOrder: 1,
		},
	];

	beforeEach(() => {
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => {
			const name = getFunctionName(opts.__fn);
			if (name === NAME.listLocations)
				return { data: LOCATIONS, isPending: false };
			if (name === VENUE_USAGE)
				return {
					data: [
						{ venueId: "loc_hidden", name: "Card Check Camp" },
						{ venueId: "loc_hidden", name: "Sunrise Yoga" },
						{ venueId: "loc_hidden", name: "BNI Breakfast" },
					],
					isPending: false,
				};
			return { data: undefined, isPending: false };
		}) as never);
		vi.mocked(useMutation).mockImplementation((() =>
			vi.fn().mockResolvedValue(undefined)) as never);
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
					offerSelfCollect={true}
					offerDelivery={true}
					deliveryConfig={undefined}
					businessAddress={undefined}
					deliveryBooking={undefined}
					minFulfilmentNoticeDays={undefined}
					openingHours={undefined}
					closedDates={undefined}
					hasBookingListings={false}
					minOrderValue={undefined}
					awbConfig={undefined}
					subscription={undefined}
				/>
			</ActAsProvider>,
		);
	}

	it("names the events a HIDDEN point hosts, with the guests-still-sent-here note and a +N overflow", () => {
		renderTab();
		fireEvent.click(screen.getByRole("button", { name: /Show inactive/ }));
		const badge = screen.getByText(
			/Event venue: Card Check Camp, Sunrise Yoga \+1 more/,
		);
		expect(badge.textContent).toMatch(/guests are still sent here/i);
	});

	it("a point hosting nothing carries no badge", () => {
		renderTab();
		expect(screen.queryByText(/Event venue:/)).toBeNull();
	});
});
