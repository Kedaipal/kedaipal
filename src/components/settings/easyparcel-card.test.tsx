// @vitest-environment jsdom
// EasyParcel connection card (z8r3fdcje2, Open API) — Settings → Integrations.
// Covers the OAuth connect hand-off (Kedaipal never sees a key), the states a
// seller comes BACK to (declined / expired / dead grant), the demo-account
// banner, the prepaid wallet row, the Pro gate (which never traps a
// downgraded seller), and the country rule. The on/off switch lives in
// Fulfilment → Courier booking, not here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EasyparcelCard } from "./easyparcel-card";

const state = vi.hoisted(() => ({
	settings: undefined as unknown,
	mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useAction: () => vi.fn().mockResolvedValue({ ok: true }),
		useMutation: (ref: unknown) =>
			state.mutations.get(name(ref as never)) ?? vi.fn(),
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
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: () => (
		<button type="button" aria-label="address search" />
	),
}));

const START = getFunctionName(api.easyparcel.startConnect);
const RETAILER = "r1" as Id<"retailers">;

function card(props: { canUse?: boolean; country?: "MY" | "SG" } = {}) {
	return (
		<EasyparcelCard
			shellId="settings-easyparcel"
			highlight={undefined}
			retailerId={RETAILER}
			canUse={props.canUse ?? true}
			country={props.country ?? "SG"}
		/>
	);
}

function settings(overrides: Record<string, unknown> = {}) {
	return {
		available: true,
		connected: true,
		needsReconnect: false,
		enabled: true,
		accountName: "Kedai SG Pte Ltd",
		accountType: "Business",
		environment: undefined,
		balanceMinor: 25050,
		balanceCurrency: "SGD",
		balanceCheckedAt: Date.now(),
		pickupAddress: {
			unit: "#05-11",
			address1: "10 Anson Road",
			city: "Singapore",
			postcode: "079903",
		},
		connectedAt: Date.now() - 60_000,
		country: "SG",
		lastAttempt: undefined,
		...overrides,
	};
}

const NOT_CONNECTED = {
	connected: false,
	enabled: false,
	accountName: undefined,
	pickupAddress: undefined,
	balanceMinor: undefined,
	connectedAt: undefined,
};

beforeEach(() => {
	state.settings = undefined;
	state.mutations = new Map();
});
afterEach(() => cleanup());

describe("not connected — the OAuth hand-off", () => {
	it("explains the sign-in and offers one Connect button, no key field", () => {
		state.settings = settings(NOT_CONNECTED);
		render(card());
		expect(screen.getByText("Not connected")).toBeDefined();
		expect(
			screen.getByRole("button", { name: /Connect EasyParcel/ }),
		).toBeDefined();
		expect(screen.getByText(/never sees your EasyParcel/)).toBeDefined();
		expect(screen.queryByLabelText(/API key/i)).toBeNull();
	});

	it("Connect asks for the sign-in URL, returning to THIS card", async () => {
		state.settings = settings(NOT_CONNECTED);
		const start = vi.fn().mockResolvedValue({ ok: false, message: "nope" });
		state.mutations.set(START, start);
		render(card());
		fireEvent.click(screen.getByRole("button", { name: /Connect EasyParcel/ }));
		await vi.waitFor(() => expect(start).toHaveBeenCalled());
		const args = start.mock.calls[0][0] as { returnTo: string };
		expect(args.returnTo).toMatch(/#settings-easyparcel$/);
	});

	it("Starter sees the connect locked with the reason — never a dead button alone", () => {
		state.settings = settings(NOT_CONNECTED);
		render(card({ canUse: false }));
		const connect = screen.getByRole("button", {
			name: /Connect EasyParcel/,
		}) as HTMLButtonElement;
		expect(connect.disabled).toBe(true);
		expect(screen.getByText(/Pro feature/)).toBeDefined();
	});

	it("a declined attempt is stated when the seller comes back", () => {
		state.settings = settings({
			...NOT_CONNECTED,
			lastAttempt: {
				outcome: "denied",
				message:
					"EasyParcel didn't share access — nothing was connected. Tap Connect EasyParcel and choose Allow to finish.",
				at: Date.now(),
			},
		});
		render(card());
		expect(screen.getByText(/didn't share access/)).toBeDefined();
	});
});

describe("loading and half-set-up states (test-code F6, F15)", () => {
	it("loading never claims Not connected", () => {
		state.settings = undefined;
		const { container } = render(card());
		expect(screen.queryByText("Not connected")).toBeNull();
		expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
	});

	it("booking switched on but no pickup address yet says it starts after setup", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(card());
		expect(
			screen.getByText(/starts once the setup above is done/i),
		).toBeTruthy();
		expect(screen.queryByText(/^Booking is on/)).toBeNull();
	});
});

describe("connected", () => {
	it("shows who's connected, the wallet, the pickup address, the ambient rule", () => {
		state.settings = settings();
		render(card());
		expect(screen.getByText("Connected")).toBeDefined();
		expect(screen.getByText("Kedai SG Pte Ltd")).toBeDefined();
		expect(screen.getByText(/S\$\s?250\.50|SGD\s?250\.50/)).toBeDefined();
		expect(screen.getByText(/#05-11 10 Anson Road/)).toBeDefined();
		expect(screen.getByText("Ambient parcels only.")).toBeDefined();
	});

	it("Disconnect says the pickup address goes with it (test-code F28)", () => {
		state.settings = settings();
		render(card());
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(
			screen.getByText(
				/Your pickup address goes too, so reconnecting is one sign-in plus that address/,
			),
		).toBeTruthy();
	});

	it("a sandbox from the other country says why its prices are in RM", () => {
		state.settings = settings({
			environment: "sandbox",
			balanceCurrency: "MYR",
		});
		render(card({ country: "SG" }));
		expect(
			screen.getByText(
				/Malaysia test account, so its prices and wallet show in MYR/,
			),
		).toBeTruthy();
	});

	it("a demo account reads Test mode with the no-courier warning", () => {
		state.settings = settings({ environment: "sandbox" });
		render(card());
		expect(screen.getByText("Test mode")).toBeDefined();
		expect(screen.getByText(/no courier will come/i)).toBeDefined();
	});

	it("a dead grant reads Reconnect needed, with the way back", () => {
		state.settings = settings({ needsReconnect: true });
		render(card());
		expect(screen.getByText("Reconnect needed")).toBeDefined();
		expect(
			screen.getByRole("button", { name: /Reconnect EasyParcel/ }),
		).toBeDefined();
		expect(screen.getByText(/settings are kept/)).toBeDefined();
	});

	it("an old failed attempt doesn't haunt a later successful connect", () => {
		state.settings = settings({
			connectedAt: Date.now(),
			lastAttempt: {
				outcome: "failed",
				message: "STALE FAILURE",
				at: Date.now() - 600_000,
			},
		});
		render(card());
		expect(screen.queryByText("STALE FAILURE")).toBeNull();
	});

	it("a downgraded-but-connected seller keeps the card (management is never gated)", () => {
		state.settings = settings();
		render(card({ canUse: false }));
		expect(screen.getByText("Connected")).toBeDefined();
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined();
	});
});

describe("availability", () => {
	it("unavailable here with nothing connected renders nothing — shell included", () => {
		state.settings = settings({
			...NOT_CONNECTED,
			available: false,
			country: "MY",
		});
		const { container } = render(card({ country: "MY" }));
		expect(container.innerHTML).toBe("");
	});

	it("unavailable but still CONNECTED keeps the unwind path, with the Delyva pointer", () => {
		state.settings = settings({ available: false, country: "MY" });
		render(card({ country: "MY" }));
		expect(
			screen.getByText(/book couriers through Delyva instead/),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined();
	});
});
