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
const DELYVA_SETTINGS = getFunctionName(api.delyva.getSettings);

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
	| {
			count: number;
			choiceCount: number;
			named: { productId: string; name: string }[];
	  }
	| undefined;
let delyvaSettings: { connected: boolean; enabled: boolean } | undefined;
/** Every args value the readiness query was asked with — `"skip"` included,
 * so a test can prove the fetch never happened, not just that nothing
 * rendered. */
let missingWeightsArgs: unknown[];

beforeEach(() => {
	updateSettings = vi.fn().mockResolvedValue({ ok: true });
	missingWeights = undefined;
	delyvaSettings = undefined;
	missingWeightsArgs = [];
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
		args?: unknown;
	}) => {
		const name = getFunctionName(opts.__fn);
		if (name === MISSING_WEIGHTS) missingWeightsArgs.push(opts.args);
		return {
			data:
				name === MISSING_WEIGHTS
					? missingWeights
					: name === DELYVA_SETTINGS
						? delyvaSettings
						: undefined,
			isPending: false,
		};
	}) as never);
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
			choiceCount: 9,
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
		missingWeights = { count: 0, choiceCount: 0, named: [] };
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

	// Mandos (prod, 23 Oct): every tee stored at 0 g, Delyva declined to bid,
	// checkout refused — and the seller had no way to see why, because the
	// readiness list only showed for the weight-zone mode.
	describe("unweighed products on a live store (Mandos, 23 Oct)", () => {
		it("names them on the live card when Delyva is armed, with the one-kilo rule", () => {
			delyvaSettings = { connected: true, enabled: true };
			missingWeights = {
				count: 3,
				choiceCount: 4,
				named: [{ productId: "p1", name: "Oversized Tee" }],
			};
			const { container } = renderLive({
				config: { mode: "live", onUnquotable: "block" },
			});
			expect(container.textContent).toContain(
				"3 products have no parcel weight",
			);
			expect(container.textContent).toContain(
				"quote those orders as a 1 kg parcel",
			);
			expect(screen.getByRole("link", { name: "Oversized Tee" })).toBeTruthy();
			// And the rule is stated where the mode is explained, not only
			// once something is already wrong.
			expect(container.textContent).toContain("quoted as a 1 kg parcel");
		});

		it("never fetches, never shows, when no courier prices by weight", () => {
			delyvaSettings = { connected: true, enabled: false };
			missingWeights = { count: 3, choiceCount: 3, named: [] };
			const { container } = renderLive({
				config: { mode: "live", onUnquotable: "block" },
			});
			expect(container.textContent).not.toMatch(/no parcel weight/);
			expect(container.textContent).not.toContain("1 kg parcel");
			expect(missingWeightsArgs.length).toBeGreaterThan(0);
			expect(missingWeightsArgs.every((a) => a === "skip")).toBe(true);
		});
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

describe("arming weight pricing waits for the catalogue (23 Oct 2026)", () => {
	const weight = {
		mode: "weight" as const,
		zones: [],
		onUnzoned: "arrange" as const,
	};
	const unweighed = {
		count: 2,
		choiceCount: 5,
		named: [{ productId: "p1", name: "Brownies" }],
	};

	it("the readiness notice links the bulk fill with the choice count", () => {
		missingWeights = unweighed;
		renderPricing({ config: weight as never });
		const fix = screen.getByRole("link", { name: /set parcel weights/i });
		expect(fix.getAttribute("href")).toBe("/app/products/weights");
		expect(fix.textContent).toContain("5 choices");
	});

	it("moving onto the rate card is disabled-with-reason while products are unweighed", () => {
		missingWeights = unweighed;
		const { container } = renderPricing({ config: { mode: "flat", fee: 500 } });
		fireEvent.click(mode(/By weight & zone/));
		const save = screen.getByRole("button", { name: /save delivery pricing/i });
		expect(save.hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain(
			"Saving is off until every product has a parcel weight — 2 still need one.",
		);
	});

	it("a store already on the rate card keeps saving — only the switch is gated", () => {
		missingWeights = unweighed;
		renderPricing({ config: weight as never });
		expect(
			screen
				.getByRole("button", { name: /save delivery pricing/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("moving onto live pricing with Delyva armed is gated the same way; riders alone are not", () => {
		delyvaSettings = { connected: true, enabled: true };
		missingWeights = unweighed;
		renderPricing({
			config: { mode: "flat", fee: 500 },
			businessAddress: HQ,
			deliveryBooking: booking(),
		});
		fireEvent.click(mode(/live courier price/i));
		expect(
			screen
				.getByRole("button", { name: /save live pricing/i })
				.hasAttribute("disabled"),
		).toBe(true);
		cleanup();
		delyvaSettings = { connected: true, enabled: false };
		renderPricing({
			config: { mode: "flat", fee: 500 },
			businessAddress: HQ,
			deliveryBooking: booking(),
		});
		fireEvent.click(mode(/live courier price/i));
		expect(
			screen
				.getByRole("button", { name: /save live pricing/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("the overseas price is said here too (z8r3fdr5yy)", () => {
	// Found on the /test-code pass: a Free store read "no delivery charge"
	// while Malaysia orders paid S$12, and the live-pricing warning named
	// Delyva to an SG store that was never offered it.
	const LANE = {
		country: "SG" as const,
		pricing: { kind: "flat" as const, fee: 2500 },
	};

	it("a store with a lane sees the overseas price and the way to change it", () => {
		// No config = Free.
		renderPricing({ crossBorderLanes: [LANE] });
		expect(
			screen.getByText(/Orders to Singapore have their own price/),
		).toBeTruthy();
		expect(screen.getByText(/RM\s?25\.00 per order/)).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Change overseas price" })
				.getAttribute("href"),
		).toBe("/app/settings/overseas-delivery");
		expect(
			screen.getByText(/Orders to Singapore still pay your overseas price/),
		).toBeTruthy();
	});

	it("a store without a lane reads exactly as before", () => {
		renderPricing();
		expect(screen.queryByText(/have their own price/)).toBeNull();
		expect(
			screen.getByText("Buyers pay nothing extra for delivery — it's on you."),
		).toBeTruthy();
	});

	it("choosing live warns by Save — naming only the couriers the store's country offers", () => {
		renderPricing({
			country: "SG",
			businessAddress: HQ,
			deliveryBooking: booking(),
			crossBorderLanes: [{ ...LANE, country: "MY" }],
		});
		fireEvent.click(mode(/live courier price/i));
		const warning = screen.getByText(/pauses while you use live courier/);
		expect(warning.textContent).toMatch(
			/Lalamove delivers within Singapore only/,
		);
		expect(warning.textContent).not.toMatch(/Delyva/);
		// Not saved yet, so the lane is still live and the note says so.
		expect(
			screen.getByText(/Orders to Malaysia have their own price/),
		).toBeTruthy();
	});

	it("saved live: the note says the lane is paused, never that its price applies", () => {
		// Found on the second /test-code pass: "Orders to Malaysia have their
		// own price" sat above a lane that buyers couldn't choose.
		renderPricing({
			country: "SG",
			config: { mode: "live", onUnquotable: "block" },
			businessAddress: HQ,
			deliveryBooking: booking(),
			crossBorderLanes: [{ ...LANE, country: "MY" }],
		});
		expect(screen.getByText("Delivery to Malaysia is paused.")).toBeTruthy();
		const reason = screen.getByText(
			/Lalamove delivers within Singapore only/,
		).textContent;
		expect(reason).toMatch(/price — S\$\s?25\.00 per order — is kept/);
		expect(reason).not.toMatch(/Delyva/);
		expect(screen.queryByText(/have their own price/)).toBeNull();
		// The note already says it — no second warning by the save button.
		expect(screen.queryByText(/pauses while you use live courier/)).toBeNull();
		expect(
			screen
				.getByRole("link", { name: "Overseas delivery" })
				.getAttribute("href"),
		).toBe("/app/settings/overseas-delivery");
	});

	it("paused by plan or delivery off reads paused too", () => {
		renderPricing({
			crossBorderLanes: [LANE],
			subscription: { features: { crossBorder: false } } as never,
		});
		expect(screen.getByText("Delivery to Singapore is paused.")).toBeTruthy();
		cleanup();
		renderPricing({ crossBorderLanes: [LANE], offerDelivery: false });
		expect(screen.getByText("Delivery to Singapore is paused.")).toBeTruthy();
	});
});
