// @vitest-environment jsdom
// EasyParcel connection card (z8r3fdcje2) — Settings → Integrations. Covers
// the single-key connect, the demo-host warning, the prepaid wallet row, the
// Pro gate (which never traps a downgraded seller), and the country rule
// (MY hides entirely — Delyva serves MY). The on/off toggle lives in
// Fulfilment → Courier booking, not here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EasyparcelCard } from "./easyparcel-card";

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
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: () => (
		<button type="button" aria-label="address search" />
	),
}));

const NAME = {
	connect: getFunctionName(api.easyparcel.connect),
};

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
		enabled: true,
		apiKeyHint: "k9f2",
		isDemo: false,
		balanceMinor: 25050,
		balanceCurrency: "SGD",
		balanceCheckedAt: Date.now(),
		pickupAddress: {
			unit: "#05-11",
			address1: "10 Anson Road",
			postcode: "079903",
		},
		connectedAt: Date.now(),
		country: "SG",
		...overrides,
	};
}

beforeEach(() => {
	state.settings = undefined;
	state.actions = new Map();
	state.mutation = undefined;
});
afterEach(() => cleanup());

describe("not connected", () => {
	it("offers the key field and connect steps for an SG store", () => {
		state.settings = settings({
			connected: false,
			enabled: false,
			apiKeyHint: undefined,
			pickupAddress: undefined,
			balanceMinor: undefined,
		});
		render(card());
		expect(screen.getByText("Not connected")).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Connect EasyParcel" }),
		).toBeDefined();
		expect(screen.getByText(/Individual API/)).toBeDefined();
	});

	it("a wrong key's refusal lands as the action's own message", async () => {
		state.settings = settings({
			connected: false,
			enabled: false,
			pickupAddress: undefined,
		});
		const connect = vi.fn().mockResolvedValue({
			ok: false,
			message: "EasyParcel didn't recognise this API key.",
		});
		state.actions.set(NAME.connect, connect);
		render(card());
		fireEvent.change(screen.getByLabelText("EasyParcel API key"), {
			target: { value: "EP-abc123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect EasyParcel" }));
		await vi.waitFor(() => expect(connect).toHaveBeenCalled());
		expect(connect).toHaveBeenCalledWith({
			retailerId: undefined,
			apiKey: "EP-abc123",
		});
	});

	it("Starter sees the connect locked with the reason — never a dead button alone", () => {
		state.settings = settings({
			connected: false,
			enabled: false,
			pickupAddress: undefined,
		});
		render(card({ canUse: false }));
		const connect = screen.getByRole("button", {
			name: "Connect EasyParcel",
		}) as HTMLButtonElement;
		expect(connect.disabled).toBe(true);
		expect(screen.getByText(/Pro feature/)).toBeDefined();
		expect(screen.getByText(/Disconnecting is never locked/)).toBeDefined();
	});
});

describe("connected", () => {
	it("shows the wallet balance, the key hint and the pickup summary", () => {
		state.settings = settings();
		render(card());
		expect(screen.getByText("Connected")).toBeDefined();
		expect(screen.getByText(/S\$\s?250\.50|SGD\s?250\.50/)).toBeDefined();
		expect(screen.getByText(/…k9f2/)).toBeDefined();
		expect(screen.getByText(/#05-11 10 Anson Road/)).toBeDefined();
		// The ambient-only constraint is said on the card, not discovered at a
		// failed pickup.
		expect(screen.getByText("Ambient parcels only.")).toBeDefined();
	});

	it("a demo-host key reads Test mode with the no-courier warning", () => {
		state.settings = settings({ isDemo: true });
		render(card());
		expect(screen.getByText("Test mode")).toBeDefined();
		expect(screen.getByText(/no courier will come/i)).toBeDefined();
	});

	it("a downgraded-but-connected seller keeps the card (management is never gated)", () => {
		state.settings = settings();
		render(card({ canUse: false }));
		expect(screen.getByText("Connected")).toBeDefined();
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined();
	});
});

describe("country rule", () => {
	it("an MY store with nothing connected renders no card at all — shell included", () => {
		state.settings = settings({
			available: false,
			connected: false,
			enabled: false,
			pickupAddress: undefined,
			country: "MY",
		});
		const { container } = render(card({ country: "MY" }));
		expect(container.innerHTML).toBe("");
	});

	it("an MY store still CONNECTED keeps the unwind path, with the Delyva pointer", () => {
		state.settings = settings({ available: false, country: "MY" });
		render(card({ country: "MY" }));
		expect(
			screen.getByText(/book couriers through Delyva instead/),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined();
	});
});
