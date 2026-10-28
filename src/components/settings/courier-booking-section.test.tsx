// @vitest-environment jsdom
// Courier booking toggles (86eyjpv6z IA rework) — independent switches per
// provider, never a radio: a seller may arm riders AND couriers and pick per
// order. Each unconnected provider is disabled-with-reason + a link to
// Integrations, and Lalamove live-quote pricing locks the rider toggle on.
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
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { CourierBookingSection } from "./courier-booking-section";

const state = vi.hoisted(() => ({
	delyva: undefined as unknown,
	easyparcel: undefined as unknown,
	updateSettings: undefined as ReturnType<typeof vi.fn> | undefined,
	updateDelyva: undefined as ReturnType<typeof vi.fn> | undefined,
	updateEasyparcel: undefined as ReturnType<typeof vi.fn> | undefined,
}));

// Routed by function name: each provider's switch must read and write its
// OWN provider — a shared mock would let a crossed wire pass.
vi.mock("convex/react", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useMutation: (fn: never) =>
			name(fn) === "easyparcel:updateSettings"
				? (state.updateEasyparcel ?? vi.fn())
				: (state.updateDelyva ?? vi.fn()),
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useQuery: (opts: { fn: never }) =>
			name(opts.fn) === "easyparcel:getSettings"
				? { data: state.easyparcel }
				: { data: state.delyva },
	};
});
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

/** A connected, switched-on EasyParcel. The suite DEFAULT (beforeEach) is
 * the MY store's view instead — not offered here, nothing connected. */
const easyparcel = (overrides: Record<string, unknown> = {}) => ({
	available: true,
	connected: true,
	enabled: true,
	needsReconnect: false,
	environment: "live",
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
	state.easyparcel = easyparcel({ available: false, connected: false });
	state.updateEasyparcel = vi.fn().mockResolvedValue({ ok: true });
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
				deliveryBooking: lalamove({
					hasCredentials: false,
					apiKeyHint: undefined,
				}),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Connect Lalamove in Integrations/i)).toBeTruthy();
	});

	it("an unconnected Delyva points at Integrations", () => {
		state.delyva = delyva({ connected: false });
		render(section());
		expect(
			screen
				.getByRole("switch", { name: /delyva courier/i })
				.hasAttribute("disabled"),
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
		expect(screen.getByText(/rider booking comes with it/i)).toBeTruthy();
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
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(true);
		// …on → off never is (downgrade never traps).
		expect(
			screen
				.getByRole("switch", { name: /delyva courier/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("SG stores see no rider row at all — not a dead toggle", () => {
		render(section({ riderBookingAvailable: false }));
		expect(
			screen.queryByRole("switch", { name: /lalamove rider/i }),
		).toBeNull();
		expect(
			screen.getByRole("switch", { name: /delyva courier/i }),
		).toBeTruthy();
	});

	it("badges a demo Delyva account on the row", () => {
		state.delyva = delyva({ isDemo: true });
		const { container } = render(section());
		expect(container.textContent).toContain("Demo");
	});
});

describe("live pricing: vendors choose providers, the last bidder is guarded", () => {
	// z8r3fdbvdy quotes exactly what these toggles say. So under charge mode
	// "live" both stay free to flip — except the only armed one, whose
	// switch-off would refuse every delivery checkout (Zaki, 6 Sep).
	it("both armed → both toggles stay enabled", () => {
		state.delyva = delyva({ enabled: true });
		render(
			section({
				chargeMode: "live",
				deliveryBooking: lalamove({ enabled: true }),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(
			screen
				.getByRole("switch", { name: /delyva courier/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("Lalamove as the only bidder is disabled WITH the reason", () => {
		state.delyva = delyva({ enabled: false });
		const { container } = render(
			section({
				chargeMode: "live",
				deliveryBooking: lalamove({ enabled: true }),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(container.textContent).toContain(
			"the only service pricing your live delivery charge",
		);
	});

	it("Delyva as the only bidder is guarded the same way", () => {
		state.delyva = delyva({ enabled: true });
		render(
			section({
				chargeMode: "live",
				deliveryBooking: lalamove({ enabled: false }),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: /delyva courier/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("legacy lalamove pricing keeps its hard lock — unchanged", () => {
		render(section({ chargeMode: "lalamove" }));
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(true);
	});
});

describe("arming Delyva waits for parcel weights on a live store (23 Oct 2026)", () => {
	it("the toggle is disabled with the count and the one page that fixes it", () => {
		state.delyva = delyva({ bookingHeldForWeights: 3 });
		const { container } = render(section({ chargeMode: "live" }));
		const courier = screen.getByRole("switch", { name: /delyva courier/i });
		expect(courier.hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain(
			"Couriers price by weight, and 3 of your products have no parcel weight",
		);
		// The router stub renders `to` as-is — assert the destination, not the role.
		expect(screen.getByText(/set parcel weights/i).getAttribute("to")).toBe(
			"/app/products/weights",
		);
	});

	it("without the hold the toggle arms as before", () => {
		state.delyva = delyva();
		render(section({ chargeMode: "live" }));
		expect(
			screen
				.getByRole("switch", { name: /delyva courier/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("EasyParcel couriers (z8r3fdcje2) — its own switch, so it can be paused", () => {
	const ep = () => screen.getByRole("switch", { name: /easyparcel courier/i });

	it("pins the routing: the mock names are the real function names", () => {
		expect(getFunctionName(api.easyparcel.getSettings)).toBe(
			"easyparcel:getSettings",
		);
		expect(getFunctionName(api.easyparcel.updateSettings)).toBe(
			"easyparcel:updateSettings",
		);
	});

	it("stays out where EasyParcel isn't offered and nothing is connected", () => {
		render(section());
		expect(
			screen.queryByRole("switch", { name: /easyparcel courier/i }),
		).toBeNull();
	});

	it("an unconnected EasyParcel is disabled and points at Integrations", () => {
		state.easyparcel = easyparcel({ connected: false, enabled: false });
		render(section());
		expect(ep().hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText(/Connect EasyParcel in Integrations/i),
		).toBeTruthy();
	});

	it("pausing writes easyparcel, never delyva or deliveryBooking", async () => {
		state.easyparcel = easyparcel();
		render(section());
		expect(ep().getAttribute("aria-checked")).toBe("true");
		fireEvent.click(ep());
		await waitFor(() => expect(state.updateEasyparcel).toHaveBeenCalled());
		expect(state.updateEasyparcel).toHaveBeenCalledWith({
			retailerId: undefined,
			enabled: false,
		});
		expect(state.updateDelyva).not.toHaveBeenCalled();
		expect(state.updateSettings).not.toHaveBeenCalled();
	});

	it("a refusal the server RETURNS is shown, never toasted as success", async () => {
		const { toast } = await import("sonner");
		state.easyparcel = easyparcel({ enabled: false });
		state.updateEasyparcel = vi
			.fn()
			.mockResolvedValue({ ok: false, message: "Connect EasyParcel first." });
		render(section());
		fireEvent.click(ep());
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Connect EasyParcel first."),
		);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("signed out at EasyParcel's end: reads paused and says how to fix it", () => {
		state.easyparcel = easyparcel({ needsReconnect: true });
		render(section());
		expect(ep().getAttribute("aria-checked")).toBe("false");
		expect(ep().hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(/reconnect in Integrations/i)).toBeTruthy();
	});

	it("a Starter seller can pause it but not switch it on", () => {
		state.easyparcel = easyparcel({ enabled: true });
		const { unmount } = render(section({ canUse: false }));
		expect(ep().hasAttribute("disabled")).toBe(false);
		unmount();
		state.easyparcel = easyparcel({ enabled: false });
		render(section({ canUse: false }));
		expect(ep().hasAttribute("disabled")).toBe(true);
	});

	it("doesn't count as a live-pricing bidder — Lalamove stays the last one", () => {
		state.delyva = delyva({ countryAllowed: false, connected: false });
		state.easyparcel = easyparcel();
		render(
			section({
				chargeMode: "live",
				deliveryBooking: lalamove({ enabled: true }),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: /lalamove rider/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen.getByText(/doesn't quote your buyers' live delivery charge/i),
		).toBeTruthy();
	});

	it("labels a sandbox connection as test mode", () => {
		state.easyparcel = easyparcel({ environment: "sandbox" });
		render(section());
		expect(screen.getByText("Test mode")).toBeTruthy();
	});
});
