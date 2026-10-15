// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useMutation } from "convex/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { COUNTRY_CURRENCY } from "../../../convex/lib/country";
import { ActAsProvider } from "../../hooks/useActAs";
import { DeliveryPricing } from "./delivery-pricing";

/**
 * Settings → Fulfilment → Delivery pricing (86eye9xd4, 3A). These cases moved
 * here with the code from fulfilment-tab.test.tsx when pricing became its own
 * page — the mode chooser is now a radio group, so "pressed" became "checked".
 */
vi.mock("convex/react");
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("../../hooks/useActAsViewer", () => ({
	useActAsViewer: () => ({ session: null, isAdmin: false }),
}));
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: () => <input aria-label="address" />,
}));
vi.mock("@tanstack/react-router", () => ({
	// An href makes the stub a real link to the accessibility tree.
	Link: ({
		to,
		search: _search,
		...props
	}: Record<string, unknown> & { to?: string; search?: unknown }) => (
		<a href={to} {...props} />
	),
	useNavigate: () => vi.fn(),
}));

vi.setConfig({ testTimeout: 20_000 });

const UPDATE_SETTINGS = getFunctionName(api.retailers.updateSettings);
const MISSING_WEIGHTS = getFunctionName(api.products.missingParcelWeights);

type Props = Parameters<typeof DeliveryPricing>[0];
type Booking = NonNullable<Props["deliveryBooking"]>;

const HQ = { label: "Wash Bay HQ", latitude: 3.1, longitude: 101.6 };

function booking(over: Partial<Booking> = {}): Booking {
	return {
		enabled: true,
		vehicleType: "MOTORCYCLE",
		hasCredentials: true,
		promptBookOnPacked: false,
		deliveryDirection: "standard",
		apiKeyHint: "abcd",
		...over,
	};
}

let updateSettings: ReturnType<typeof vi.fn>;
let missingWeights:
	| { count: number; named: { productId: string; name: string }[] }
	| undefined;

beforeEach(() => {
	updateSettings = vi.fn().mockResolvedValue({ ok: true });
	missingWeights = undefined;
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
	}) => ({
		data:
			getFunctionName(opts.__fn) === MISSING_WEIGHTS
				? missingWeights
				: undefined,
		isPending: false,
	})) as never);
	vi.mocked(useMutation).mockImplementation(((
		ref: FunctionReference<"mutation">,
	) =>
		getFunctionName(ref) === UPDATE_SETTINGS
			? updateSettings
			: vi.fn().mockResolvedValue(undefined)) as never);
});

afterEach(() => {
	cleanup();
});

function renderPricing(over: Partial<Props> = {}) {
	const country = over.country ?? "MY";
	return render(
		<ActAsProvider>
			<DeliveryPricing
				retailerId={"rt_seller_1" as never}
				country={country}
				currency={COUNTRY_CURRENCY[country]}
				config={undefined}
				businessAddress={undefined}
				deliveryBooking={undefined}
				subscription={undefined}
				{...over}
			/>
		</ActAsProvider>,
	);
}

const mode = (name: RegExp) =>
	screen.getByRole("radio", { name }) as HTMLInputElement;

describe("the mode chooser", () => {
	it("is one radio group — built-in modes, then the partner one", () => {
		renderPricing();
		expect(
			screen.getByRole("group", { name: "How you charge for delivery" }),
		).toBeTruthy();
		expect(screen.getAllByRole("radio")).toHaveLength(5);
		expect(mode(/^Free/).checked).toBe(true);
	});

	it("picking a mode saves it", async () => {
		renderPricing();
		fireEvent.click(mode(/Flat fee/));
		fireEvent.change(screen.getByLabelText(/Delivery fee/i), {
			target: { value: "8" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Save delivery pricing" }),
		);
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryConfig).toEqual({
			mode: "flat",
			fee: 800,
		});
	});
});

describe("SG delivery-charge modes (SG-lite, 86eynw29u)", () => {
	it("an SG store sees Live + Free + Flat, with the MY-only pair explained", () => {
		// Live pricing arrived with Lalamove SG (z8r3fdch3r) — only the
		// geography-shaped modes stay Malaysian.
		renderPricing({ country: "SG" });
		expect(mode(/live courier price/i)).toBeTruthy();
		expect(mode(/^Free/)).toBeTruthy();
		expect(mode(/Flat fee/)).toBeTruthy();
		expect(screen.queryByRole("radio", { name: /By distance/ })).toBeNull();
		expect(
			screen.queryByRole("radio", { name: /By weight & zone/ }),
		).toBeNull();
		// The missing modes are explained, never a mystery.
		expect(screen.getByText(/Malaysia-only for now/)).toBeTruthy();
	});

	it("an MY store keeps all five modes and no SG reason line", () => {
		renderPricing();
		expect(mode(/By distance/)).toBeTruthy();
		expect(mode(/By weight & zone/)).toBeTruthy();
		expect(screen.queryByText(/Malaysia-only for now/)).toBeNull();
	});

	it("an SG store's money fields wear S$, never RM (86eyqgujv)", () => {
		renderPricing({ country: "SG", config: { mode: "flat", fee: 500 } });
		expect(screen.getAllByText("S$").length).toBeGreaterThan(0);
		expect(screen.queryByText("RM")).toBeNull();
	});

	it("an MY store is untouched — the same fields still wear RM", () => {
		renderPricing({ config: { mode: "flat", fee: 500 } });
		expect(screen.getAllByText("RM").length).toBeGreaterThan(0);
		expect(screen.queryByText("S$")).toBeNull();
	});

	it("an SG store stuck on a stored MY-only mode gets the amber repair note", () => {
		renderPricing({
			country: "SG",
			config: {
				mode: "radius",
				bands: [{ maxKm: 5, fee: 500 }],
				outOfRange: "arrange",
			},
		});
		expect(screen.getByText(/uses a Malaysia-only mode/)).toBeTruthy();
	});
});

describe("the business address is referenced, never edited here", () => {
	const radius = {
		mode: "radius" as const,
		bands: [{ maxKm: 5, fee: 500 }],
		outOfRange: "arrange" as const,
	};

	it("a mode that needs it, without one, links to the Fulfilment tab to set it", () => {
		renderPricing({ config: radius });
		expect(
			screen.getAllByText(/Set your business address first/i).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("link", { name: "Set your business address" }).length,
		).toBeGreaterThan(0);
		// No editor on this page — the address has one home.
		expect(screen.queryByLabelText("address")).toBeNull();
	});

	it("with one set, it names it and offers to change it", () => {
		renderPricing({ config: radius, businessAddress: HQ });
		expect(screen.getByText("Wash Bay HQ")).toBeTruthy();
		expect(screen.getByRole("link", { name: "change it" })).toBeTruthy();
	});
});

describe("weight & zone readiness (4A)", () => {
	const weight = {
		mode: "weight" as const,
		zones: [],
		onUnzoned: "arrange" as const,
	};

	it("names the products checkout would refuse, and how many more", () => {
		missingWeights = {
			count: 7,
			named: [
				{ productId: "p1", name: "Brownies" },
				{ productId: "p2", name: "Kuih lapis" },
			],
		};
		const { container } = renderPricing({ config: weight as never });
		expect(container.textContent).toContain("7 products have no parcel weight");
		expect(screen.getByRole("link", { name: "Brownies" })).toBeTruthy();
		expect(container.textContent).toContain("+5 more");
	});

	it("says nothing when every product is weighed", () => {
		missingWeights = { count: 0, named: [] };
		const { container } = renderPricing({ config: weight as never });
		expect(container.textContent).not.toMatch(/(has|have) no parcel weight/);
	});
});

describe("Collection service toggle (86eyg0n8e)", () => {
	function renderLalamove(deliveryDirection: "standard" | "collection") {
		return renderPricing({
			config: { mode: "lalamove", onUnquotable: "block" },
			businessAddress: HQ,
			deliveryBooking: booking({ deliveryDirection }),
		});
	}

	const save = () =>
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));

	it("turning the toggle ON saves deliveryDirection: 'collection'", async () => {
		renderLalamove("standard");
		const toggle = screen.getByRole("switch", { name: "Collection service" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(toggle);
		save();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryBooking).toMatchObject({
			deliveryDirection: "collection",
		});
	});

	it("a legacy-mode save never sends `enabled` — a fulfilment-only teammate can save it (PR #367 review)", async () => {
		// Live pricing only saves with a provider armed, so `enabled: true` was
		// always a re-send — and an `enabled` key reads as an Integrations write.
		renderLalamove("standard");
		save();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryBooking).not.toHaveProperty(
			"enabled",
		);
	});

	it("a stored collection store renders the toggle ON and an unchanged save keeps it", async () => {
		renderLalamove("collection");
		const toggle = screen.getByRole("switch", { name: "Collection service" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		save();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(
			updateSettings.mock.calls[0][0].deliveryBooking.deliveryDirection,
		).toBe("collection");
	});

	it("turning it OFF saves an explicit 'standard' (really clears, not merge-keeps)", async () => {
		renderLalamove("collection");
		fireEvent.click(screen.getByRole("switch", { name: "Collection service" }));
		save();
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(
			updateSettings.mock.calls[0][0].deliveryBooking.deliveryDirection,
		).toBe("standard");
	});
});

describe("live courier pricing (z8r3fdbvdy)", () => {
	// The mode used to be Lalamove's. It now prices across every armed
	// provider, so the row, the copy and the saved value all had to stop
	// naming one of them.
	function renderLive(
		over: {
			config?: { mode: "live" | "lalamove"; onUnquotable: "block" };
			hasKeys?: boolean;
		} = {},
	) {
		return renderPricing({
			config: over.config,
			businessAddress: { label: "HQ", latitude: 3.1, longitude: 101.6 },
			deliveryBooking: over.hasKeys === false ? undefined : booking(),
		});
	}

	it("saves the provider-aware mode, not the Lalamove one", async () => {
		renderLive();
		fireEvent.click(mode(/live courier price/i));
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		expect(updateSettings.mock.calls[0][0].deliveryConfig).toEqual({
			mode: "live",
			onUnquotable: "block",
		});
	});

	it("a store still on the pre-migration mode shows as selected", () => {
		renderLive({ config: { mode: "lalamove", onUnquotable: "block" } });
		expect(mode(/live courier price/i).checked).toBe(true);
	});

	it("offers exactly one live-pricing choice", () => {
		renderLive();
		expect(
			screen.getAllByRole("radio", { name: /live courier price/i }),
		).toHaveLength(1);
	});

	it("names both providers — not just the rider one", () => {
		const { container } = renderLive();
		fireEvent.click(mode(/live courier price/i));
		expect(container.querySelector('img[alt="Delyva"]')).toBeTruthy();
		expect(container.querySelector('img[alt="Lalamove"]')).toBeTruthy();
	});

	it("says what will be quoted, and refuses when nothing is connected", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(mode(/live courier price/i));
		expect(container.textContent).toContain("Nothing can quote yet");
		expect(container.textContent).toContain("Integrations");
	});

	it("shows a status chip per provider, not a Lalamove-only section", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(mode(/live courier price/i));
		expect(container.textContent).toContain("Riders");
		expect(container.textContent).toContain("Couriers");
		expect(screen.getAllByText("Not connected").length).toBe(2);
	});

	it("never shows the test-mode note for a store with NO Lalamove keys (Zaki's bug)", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(mode(/live courier price/i));
		expect(container.textContent).not.toContain("Test mode");
	});

	it("hides the rider-only controls when no rider bids", () => {
		const { container } = renderLive({ hasKeys: false });
		fireEvent.click(mode(/live courier price/i));
		expect(container.textContent).not.toContain("Default vehicle");
	});

	it("keeps the rider controls when Lalamove is connected", () => {
		const { container } = renderLive();
		fireEvent.click(mode(/live courier price/i));
		expect(container.textContent).toContain("Default vehicle");
	});
});

describe("live-mode saves respect the toggles (Zaki, 6 Sep)", () => {
	function renderArmed(enabled: boolean) {
		return renderPricing({
			config: { mode: "live", onUnquotable: "block" },
			businessAddress: { label: "HQ", latitude: 3.1, longitude: 101.6 },
			deliveryBooking: booking({ enabled }),
		});
	}

	it("saving live pricing saves the rider options but never re-arms booking", async () => {
		renderArmed(true);
		fireEvent.click(screen.getByRole("button", { name: "Save live pricing" }));
		await waitFor(() => expect(updateSettings).toHaveBeenCalled());
		const patch = updateSettings.mock.calls[0][0].deliveryBooking;
		// The Courier booking toggles own the bidders — the save leaves the
		// arm switch alone (the server keeps the stored value)…
		expect(patch).not.toHaveProperty("enabled");
		// …while the rider options it now carries (86eye9xd4) do save.
		expect(patch).toEqual({
			vehicleType: "MOTORCYCLE",
			promptBookOnPacked: false,
			deliveryDirection: "standard",
		});
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
