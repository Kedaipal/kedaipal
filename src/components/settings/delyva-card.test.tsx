// @vitest-environment jsdom
// Delyva connection card (86eyjpv6z) — Settings → Integrations. Covers the
// single-key connect, the demo-account warning, the Pro gate (which never
// traps a downgraded seller), and the country-aware pickup-address rules.
// The on/off toggle lives in Fulfilment → Courier booking, not here.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DelyvaCard } from "./delyva-card";

const state = vi.hoisted(() => ({
	settings: undefined as unknown,
	actions: new Map<string, ReturnType<typeof vi.fn>>(),
	mutation: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("convex/react", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useAction: (ref: unknown) =>
			state.actions.get(name(ref as never)) ??
			vi.fn().mockResolvedValue(undefined),
		useMutation: () => state.mutation ?? vi.fn(),
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.settings }),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
}));
// The real one talks to Google through Convex actions; the card only cares
// that a pick lands in the structured fields, which `onSelect` drives.
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: ({
		onSelect,
		disabled,
	}: {
		onSelect: (p: unknown) => void;
		disabled?: boolean;
	}) => (
		<button
			type="button"
			aria-label="address search"
			disabled={disabled}
			onClick={() =>
				onSelect({
					formattedAddress: "12 Jalan Ampang, 50450 Kuala Lumpur",
					placeId: "p1",
					latitude: 3.1,
					longitude: 101.7,
					addressComponents: [],
				})
			}
		/>
	),
}));
// parseGoogleAddress is pure but component-agnostic — stub the shape it
// returns so the test asserts the card's own wiring, not Google's parser.
vi.mock("../../lib/google-address", () => ({
	parseGoogleAddress: () => ({
		line1: "12 Jalan Ampang",
		city: "Kuala Lumpur",
		state: "WP Kuala Lumpur",
		postcode: "50450",
	}),
}));

const NAME = {
	connect: getFunctionName(api.delyva.connect),
	disconnect: getFunctionName(api.delyva.disconnect),
	resubscribe: getFunctionName(api.delyva.resubscribeWebhooks),
	refreshEnvironment: getFunctionName(api.delyva.refreshEnvironment),
};

const RETAILER = "r1" as Id<"retailers">;

function card(props: { canUse?: boolean; country?: "MY" | "SG" } = {}) {
	return (
		<DelyvaCard
			retailerId={RETAILER}
			canUse={props.canUse ?? true}
			country={props.country ?? "MY"}
		/>
	);
}

function settings(overrides: Record<string, unknown> = {}) {
	return {
		connected: true,
		enabled: true,
		apiKeyHint: "42dd",
		accountName: "Wagyu Walid Trading",
		isDemo: false,
		companyCode: "wwt",
		defaultItemType: "CHILLED",
		pickupAddress: {
			address1: "12 Jalan Ampang",
			city: "Kuala Lumpur",
			state: "WP Kuala Lumpur",
			postcode: "50450",
		},
		connectedAt: Date.now(),
		webhooksSubscribed: true,
		countryAllowed: true,
		...overrides,
	};
}

const disconnected = () =>
	settings({
		connected: false,
		enabled: false,
		apiKeyHint: undefined,
		accountName: undefined,
		isDemo: undefined,
		companyCode: undefined,
		pickupAddress: undefined,
		connectedAt: undefined,
		webhooksSubscribed: false,
	});

beforeEach(() => {
	state.settings = disconnected();
	state.actions.clear();
	state.mutation = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("account card", () => {
	it("offers the connect form straight away when nothing is connected", () => {
		render(card());
		expect(screen.getByLabelText(/delyva api key/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /connect delyva/i }),
		).toBeTruthy();
	});

	it("shows the account settings once connected, plus the cross-tab pointer", () => {
		state.settings = settings();
		const { container } = render(card());
		expect(screen.getByText(/Wagyu Walid Trading/)).toBeTruthy();
		expect(screen.getByText(/Default parcel type/i)).toBeTruthy();
		// The on/off switch lives in Fulfilment — the card says where.
		expect(container.textContent).toContain("Courier booking");
		expect(container.textContent).toContain("Booking is on");
	});

	it("says so when booking is off, without hiding the account settings", () => {
		state.settings = settings({ enabled: false });
		const { container } = render(card());
		expect(container.textContent).toContain("Booking is currently off");
		// Unlike the old option card, being off never hides the account config.
		expect(screen.getByText(/Default parcel type/i)).toBeTruthy();
	});
});

describe("connect", () => {
	beforeEach(() => {
		state.settings = disconnected();
	});

	it("asks for ONE key and says so", () => {
		render(card());
		expect(screen.getByText(/One key is all we need/i)).toBeTruthy();
	});

	it("keeps Connect disabled until a key is typed", () => {
		render(card());
		const connect = screen.getByRole("button", { name: /connect delyva/i });
		expect(connect.hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx123" },
		});
		expect(connect.hasAttribute("disabled")).toBe(false);
	});

	it("connects with the trimmed key", async () => {
		const connect = vi.fn().mockResolvedValue({
			ok: true,
			accountName: "Kedai Beku",
			webhooksSubscribed: true,
			isDemo: false,
		});
		state.actions.set(NAME.connect, connect);
		render(card());

		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "  dx-abc  " },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() => expect(connect).toHaveBeenCalled());
		expect(connect).toHaveBeenCalledWith({
			retailerId: undefined,
			apiKey: "dx-abc",
		});
	});

	it("surfaces a rejected key as a message, not a crash", async () => {
		const { toast } = await import("sonner");
		state.actions.set(
			NAME.connect,
			vi.fn().mockResolvedValue({
				ok: false,
				message: "Delyva didn't recognise this API key.",
			}),
		);
		render(card());
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "bad" },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Delyva didn't recognise this API key.",
			),
		);
	});

	it("warns immediately when the connected key turns out to be a demo one", async () => {
		const { toast } = await import("sonner");
		state.actions.set(
			NAME.connect,
			vi.fn().mockResolvedValue({
				ok: true,
				accountName: "Demo",
				webhooksSubscribed: true,
				isDemo: true,
			}),
		);
		render(card());
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx1" },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() =>
			expect(vi.mocked(toast.warning).mock.calls.flat().join(" ")).toMatch(
				/DEMO account/i,
			),
		);
	});

	it("warns when the key worked but the webhook didn't register", async () => {
		const { toast } = await import("sonner");
		state.actions.set(
			NAME.connect,
			vi.fn().mockResolvedValue({
				ok: true,
				webhooksSubscribed: false,
				isDemo: false,
			}),
		);
		render(card());
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx1" },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() =>
			expect(vi.mocked(toast.warning).mock.calls.flat().join(" ")).toMatch(
				/webhook/i,
			),
		);
	});
});

describe("demo vs live account", () => {
	it("badges a demo account and spells out that no courier will come", () => {
		state.settings = settings({ isDemo: true, companyCode: "demo" });
		const { container } = render(card());
		expect(screen.getByText(/Demo account/i)).toBeTruthy();
		expect(container.textContent).toContain("no courier will come");
		expect(container.textContent).toContain("play money");
	});

	it("badges a real account Live, with no scary copy", () => {
		state.settings = settings({ isDemo: false });
		const { container } = render(card());
		expect(screen.getByText(/^Live$/i)).toBeTruthy();
		expect(container.textContent).not.toContain("no courier will come");
	});

	it("says nothing at all when the environment is unknown — never a false all-clear", () => {
		state.settings = settings({ isDemo: undefined });
		const { container } = render(card());
		expect(screen.queryByText(/^Live$/i)).toBeNull();
		expect(screen.queryByText(/Demo account/i)).toBeNull();
		expect(container.textContent).not.toContain("no courier will come");
	});

	it("heals an unknown environment once on mount — pre-detection connections get their badge", async () => {
		const refresh = vi.fn().mockResolvedValue({ ok: true });
		state.actions.set(NAME.refreshEnvironment, refresh);
		state.settings = settings({ isDemo: undefined });
		render(card());
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	});

	it("never fires the heal when the environment is already stamped", async () => {
		const refresh = vi.fn().mockResolvedValue({ ok: true });
		state.actions.set(NAME.refreshEnvironment, refresh);
		state.settings = settings({ isDemo: true });
		render(card());
		await new Promise((r) => setTimeout(r, 20));
		expect(refresh).not.toHaveBeenCalled();
	});
});

describe("plan gate", () => {
	it("marks the card Pro and blocks connecting for a Starter seller", () => {
		state.settings = disconnected();
		const { container } = render(card({ canUse: false }));
		expect(container.textContent).toContain("Pro");
		expect(
			screen
				.getByRole("button", { name: /connect delyva/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Disconnecting is never locked/i)).toBeTruthy();
	});

	it("never traps a downgraded seller who is already connected", () => {
		state.settings = settings();
		render(card({ canUse: false }));
		expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /^replace$/i })).toBeTruthy();
	});
});

describe("Singapore (z8r3fdbqmc)", () => {
	// SG stores have no Lalamove at all, so this IS their courier automation.
	it("is offered to a Singapore store like any other", () => {
		state.settings = disconnected();
		render(card({ country: "SG" }));
		expect(
			screen.getByRole("button", { name: /connect delyva/i }),
		).toBeTruthy();
		expect(
			screen.queryByText(/isn't available in your store's country/i),
		).toBeNull();
	});

	it("asks for a 6-digit postal code, not a 5-digit postcode", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card({ country: "SG" }));
		const field = screen.getByLabelText(/postal code/i) as HTMLInputElement;
		expect(field.maxLength).toBe(6);
		expect(screen.queryByLabelText(/^postcode$/i)).toBeNull();
	});

	it("drops the state and city fields — the island is both", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card({ country: "SG" }));
		expect(screen.queryByLabelText(/^state$/i)).toBeNull();
		expect(screen.queryByLabelText(/^city$/i)).toBeNull();
	});

	it("saves with Singapore implied on both fields", async () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card({ country: "SG" }));
		fireEvent.change(screen.getByLabelText(/street address/i), {
			target: { value: "10 Bayfront Ave" },
		});
		fireEvent.change(screen.getByLabelText(/postal code/i), {
			target: { value: "018956" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /save pickup address/i }),
		);
		await waitFor(() => expect(state.mutation).toHaveBeenCalled());
		expect(state.mutation).toHaveBeenCalledWith({
			retailerId: undefined,
			pickupAddress: {
				address1: "10 Bayfront Ave",
				address2: undefined,
				city: "Singapore",
				state: "Singapore",
				postcode: "018956",
			},
		});
	});

	it("refuses a 5-digit code on an SG store — the MY rule must not leak across", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card({ country: "SG" }));
		fireEvent.change(screen.getByLabelText(/street address/i), {
			target: { value: "10 Bayfront Ave" },
		});
		fireEvent.change(screen.getByLabelText(/postal code/i), {
			target: { value: "01895" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /save pickup address/i }),
		);
		expect(screen.getByText(/6-digit postal code/i)).toBeTruthy();
		expect(state.mutation).not.toHaveBeenCalled();
	});

	it("a store in a country we don't serve yet still gets a way out", () => {
		state.settings = settings({ countryAllowed: false });
		render(card({ country: "SG" }));
		expect(
			screen.getByText(/isn't available in your store's country yet/i),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
	});

	it("…and vanishes entirely when there is nothing connected to unwind", () => {
		state.settings = settings({ connected: false, countryAllowed: false });
		const { container } = render(card({ country: "SG" }));
		expect(container.textContent).toBe("");
	});
});

describe("connected settings", () => {
	beforeEach(() => {
		state.settings = settings();
	});

	it("switches the store default parcel type", async () => {
		render(card());
		fireEvent.click(screen.getByRole("button", { name: /frozen/i }));
		await waitFor(() => expect(state.mutation).toHaveBeenCalled());
		expect(state.mutation).toHaveBeenCalledWith({
			retailerId: undefined,
			defaultItemType: "FROZEN",
		});
	});

	it("surfaces the cold-chain activation step for a chilled store", () => {
		const { container } = render(card());
		expect(container.textContent).toContain("one-time activation");
		expect(screen.getByText("support@delyva.com")).toBeTruthy();
	});

	it("keeps that note off an ambient-only store", () => {
		state.settings = settings({ defaultItemType: "PARCEL" });
		const { container } = render(card());
		expect(container.textContent).not.toContain("one-time activation");
	});

	it("warns — and offers a retry — when the tracking webhook isn't registered", async () => {
		state.settings = settings({ webhooksSubscribed: false });
		const resubscribe = vi.fn().mockResolvedValue({ ok: true });
		state.actions.set(NAME.resubscribe, resubscribe);
		const { container } = render(card());

		expect(container.textContent).toContain("won't move to Shipped");
		fireEvent.click(screen.getByRole("button", { name: /register again/i }));
		await waitFor(() => expect(resubscribe).toHaveBeenCalled());
	});

	it("flags a missing pickup address before the first booking fails", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card());
		// The checklist's pickup step needs action, and the header counts it.
		expect(screen.getByText("Setup 2 of 3")).toBeTruthy();
		expect(screen.getAllByText("(action needed)")).toHaveLength(1);
	});

	it("a fully set-up account reads as ticked steps and one chip (86eye9xd4)", () => {
		state.settings = settings({ isDemo: false });
		render(card());
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(screen.queryByText("(action needed)")).toBeNull();
		expect(screen.getAllByText("(done)")).toHaveLength(3);
	});
});

describe("pickup address — a set address is one quiet row (86eye9xd4)", () => {
	it("folds to the address with change it, opens the editor, and Cancel folds it back", () => {
		state.settings = settings();
		render(card());
		expect(
			screen.getByText(/12 Jalan Ampang, 50450 Kuala Lumpur/),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "address search" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "change it" }));
		expect(screen.getByRole("button", { name: "address search" })).toBeTruthy();
		// Opened but untouched: nothing to save, and Cancel is the way out.
		expect(
			(
				screen.getByRole("button", {
					name: "Save pickup address",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("button", { name: "address search" })).toBeNull();
	});
});

describe("pickup address", () => {
	beforeEach(() => {
		state.settings = settings({ pickupAddress: undefined });
	});

	it("fills every structured field from an address search", () => {
		render(card());
		fireEvent.click(screen.getByLabelText(/address search/i));
		expect(
			(screen.getByLabelText(/street address/i) as HTMLInputElement).value,
		).toBe("12 Jalan Ampang");
		expect((screen.getByLabelText(/city/i) as HTMLInputElement).value).toBe(
			"Kuala Lumpur",
		);
		expect((screen.getByLabelText(/postcode/i) as HTMLInputElement).value).toBe(
			"50450",
		);
		expect((screen.getByLabelText(/^state$/i) as HTMLSelectElement).value).toBe(
			"WP Kuala Lumpur",
		);
	});

	it("leaves the searched fields editable — Google often omits a postcode", async () => {
		render(card());
		fireEvent.click(screen.getByLabelText(/address search/i));
		fireEvent.change(screen.getByLabelText(/postcode/i), {
			target: { value: "50480" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /save pickup address/i }),
		);
		await waitFor(() => expect(state.mutation).toHaveBeenCalled());
		expect(state.mutation?.mock.calls[0][0].pickupAddress.postcode).toBe(
			"50480",
		);
	});

	it("refuses a bad postcode client-side, mirroring the server rule", () => {
		render(card());
		fireEvent.click(screen.getByLabelText(/address search/i));
		fireEvent.change(screen.getByLabelText(/postcode/i), {
			target: { value: "504" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /save pickup address/i }),
		);
		expect(screen.getByText(/5-digit postcode/i)).toBeTruthy();
		expect(state.mutation).not.toHaveBeenCalled();
	});

	it("strips non-digits from the postcode as it's typed", () => {
		render(card());
		fireEvent.click(screen.getByLabelText(/address search/i));
		const postcode = screen.getByLabelText(/postcode/i) as HTMLInputElement;
		fireEvent.change(postcode, { target: { value: "50-450x" } });
		expect(postcode.value).toBe("50450");
	});
});

describe("booking held for parcel weights (23 Oct 2026)", () => {
	it("says booking is off until the products are weighed, and links the fix", () => {
		state.settings = settings({ enabled: false, bookingHeldForWeights: 2 });
		const { container } = render(card());
		expect(container.textContent).toContain(
			"Booking is off until 2 products have a parcel weight — couriers price by weight.",
		);
		// The router stub renders `to` as-is — assert the destination, not the role.
		expect(screen.getByText(/set parcel weights/i).getAttribute("to")).toBe(
			"/app/products/weights",
		);
		// The pointer to the switch still stands — it is where they go next.
		expect(container.textContent).toContain("Courier booking");
	});

	it("a connect that held booking warns straight away", async () => {
		const { toast } = await import("sonner");
		state.actions.set(
			NAME.connect,
			vi.fn().mockResolvedValue({
				ok: true,
				accountName: "Mandos",
				webhooksSubscribed: true,
				isDemo: false,
				bookingHeldForWeights: 4,
			}),
		);
		render(card());
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx-abc" },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() =>
			expect(toast.warning).toHaveBeenCalledWith(
				"Booking stays off until 4 products have a parcel weight — see the note on this card.",
			),
		);
	});
});
