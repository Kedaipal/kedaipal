// @vitest-environment jsdom
// Courier booking toggles (86eyjpv6z IA rework) — independent switches per
// provider, never a radio: a seller may arm riders AND couriers and pick per
// order. Each unconnected provider is disabled-with-reason + a link to
// Integrations, and Lalamove live-quote pricing locks the rider toggle on.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { CourierBookingSection } from "./courier-booking-section";

const state = vi.hoisted(() => ({
	delyva: undefined as unknown,
	updateSettings: undefined as ReturnType<typeof vi.fn> | undefined,
	updateDelyva: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("convex/react", () => ({
	useMutation: () => state.updateDelyva ?? vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.delyva }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));
vi.mock("../../hooks/useUpdateSettings", () => ({
	useUpdateSettings: () => state.updateSettings ?? vi.fn(),
}));

const lalamove = (
	overrides: Partial<DeliveryBookingSummary> = {},
): DeliveryBookingSummary => ({
	enabled: false,
	vehicleType: "MOTORCYCLE",
	hasCredentials: true,
	promptBookOnPacked: false,
	deliveryDirection: "standard",
	apiKeyHint: "b2c3",
	env: "production",
	...overrides,
});

const delyva = (overrides: Record<string, unknown> = {}) => ({
	connected: true,
	enabled: false,
	countryAllowed: true,
	isDemo: false,
	defaultItemType: "PARCEL",
	webhooksSubscribed: true,
	...overrides,
});

function section(
	props: Partial<Parameters<typeof CourierBookingSection>[0]> = {},
) {
	return (
		<CourierBookingSection
			deliveryBooking={lalamove()}
			chargeMode="weight"
			canUse
			riderBookingAvailable
			{...props}
		/>
	);
}

beforeEach(() => {
	state.delyva = delyva();
	state.updateSettings = vi.fn().mockResolvedValue({ ok: true });
	state.updateDelyva = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("independent toggles, not a radio", () => {
	it("both providers can be armed at once", async () => {
		state.delyva = delyva({ enabled: true });
		render(section({ deliveryBooking: lalamove({ enabled: true }) }));
		const rider = screen.getByRole("switch", { name: /lalamove rider/i });
		const courier = screen.getByRole("switch", { name: /delyva courier/i });
		expect(rider.getAttribute("aria-checked")).toBe("true");
		expect(courier.getAttribute("aria-checked")).toBe("true");
	});

	it("arming riders writes deliveryBooking, not delyva", async () => {
		render(section());
		fireEvent.click(screen.getByRole("switch", { name: /lalamove rider/i }));
		await waitFor(() => expect(state.updateSettings).toHaveBeenCalled());
		expect(state.updateSettings).toHaveBeenCalledWith({
			deliveryBooking: { enabled: true, vehicleType: "MOTORCYCLE" },
		});
		expect(state.updateDelyva).not.toHaveBeenCalled();
	});

	it("arming Delyva writes delyva, not deliveryBooking", async () => {
		render(section());
		fireEvent.click(screen.getByRole("switch", { name: /delyva courier/i }));
		await waitFor(() => expect(state.updateDelyva).toHaveBeenCalled());
		expect(state.updateDelyva).toHaveBeenCalledWith({
			retailerId: undefined,
			enabled: true,
		});
		expect(state.updateSettings).not.toHaveBeenCalled();
	});

	it("says the manual baseline is always available — it isn't an option", () => {
		const { container } = render(section());
		expect(container.textContent).toContain(
			"Arranging your own courier always works too",
		);
	});
});

describe("disabled-with-reason, never a dead switch", () => {
	it("an unconnected Lalamove points at Integrations", () => {
		render(
			section({
				deliveryBooking: lalamove({ hasCredentials: false, apiKeyHint: undefined }),
			}),
		);
		expect(
			screen.getByRole("switch", { name: /lalamove rider/i }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Connect Lalamove in Integrations/i)).toBeTruthy();
	});

	it("an unconnected Delyva points at Integrations", () => {
		state.delyva = delyva({ connected: false });
		render(section());
		expect(
			screen.getByRole("switch", { name: /delyva courier/i }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Connect Delyva in Integrations/i)).toBeTruthy();
	});

	it("a connected Delyva links to account management", () => {
		render(section());
		expect(screen.getByText(/Manage account/i)).toBeTruthy();
	});
});

describe("the one remaining coupling", () => {
	it("Lalamove live-quote pricing locks the rider toggle on, with the reason", () => {
		render(section({ chargeMode: "lalamove" }));
		const rider = screen.getByRole("switch", { name: /lalamove rider/i });
		expect(rider.getAttribute("aria-checked")).toBe("true");
		expect(rider.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText(/rider booking comes with it/i),
		).toBeTruthy();
	});

	it("…and Delyva stays independently toggleable beside it", async () => {
		render(section({ chargeMode: "lalamove" }));
		fireEvent.click(screen.getByRole("switch", { name: /delyva courier/i }));
		await waitFor(() => expect(state.updateDelyva).toHaveBeenCalled());
	});
});

describe("plan + country gates", () => {
	it("a Starter seller can switch OFF but not ON", () => {
		state.delyva = delyva({ enabled: true });
		render(
			section({
				canUse: false,
				deliveryBooking: lalamove({ enabled: false }),
			}),
		);
		// Off → on is gated…
		expect(
			screen.getByRole("switch", { name: /lalamove rider/i }).hasAttribute("disabled"),
		).toBe(true);
		// …on → off never is (downgrade never traps).
		expect(
			screen.getByRole("switch", { name: /delyva courier/i }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("SG stores see no rider row at all — not a dead toggle", () => {
		render(section({ riderBookingAvailable: false }));
		expect(screen.queryByRole("switch", { name: /lalamove rider/i })).toBeNull();
		expect(screen.getByRole("switch", { name: /delyva courier/i })).toBeTruthy();
	});

	it("badges a demo Delyva account on the row", () => {
		state.delyva = delyva({ isDemo: true });
		const { container } = render(section());
		expect(container.textContent).toContain("Demo");
	});
});
