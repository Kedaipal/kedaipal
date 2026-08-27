// @vitest-environment jsdom
// Delyva settings card (86eyjpv6z) — the single-key connect flow, the Pro gate
// (which never traps a downgraded seller), the pickup-address rule mirrored
// from the server, and the two states that would otherwise fail silently: a
// missing pickup address and an unregistered tracking webhook.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
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
			state.actions.get(name(ref as never)) ?? vi.fn(),
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

const NAME = {
	connect: getFunctionName(api.delyva.connect),
	disconnect: getFunctionName(api.delyva.disconnect),
	resubscribe: getFunctionName(api.delyva.resubscribeWebhooks),
};

function settings(overrides: Record<string, unknown> = {}) {
	return {
		connected: true,
		enabled: true,
		apiKeyHint: "42dd",
		accountName: "Wagyu Walid Trading",
		defaultItemType: "CHILLED",
		pickupAddress: {
			address1: "12 Jalan Ampang",
			city: "Kuala Lumpur",
			state: "Kuala Lumpur",
			postcode: "50450",
		},
		connectedAt: Date.now(),
		webhooksSubscribed: true,
		countryAllowed: true,
		...overrides,
	};
}

beforeEach(() => {
	state.settings = settings({ connected: false, enabled: false, apiKeyHint: undefined, accountName: undefined, pickupAddress: undefined, connectedAt: undefined, webhooksSubscribed: false });
	state.actions.clear();
	state.mutation = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("not connected", () => {
	it("asks for ONE key and says so", () => {
		const { container } = render(<DelyvaCard canUse country="MY" />);
		expect(screen.getByLabelText(/delyva api key/i)).toBeTruthy();
		expect(container.textContent).toContain("One key is all we need");
		// There is exactly one credential field — no secret, no salt.
		expect(container.querySelectorAll("input[type='text']")).toHaveLength(1);
	});

	it("keeps Connect disabled until a key is typed", () => {
		render(<DelyvaCard canUse country="MY" />);
		const connect = screen.getByRole("button", { name: /connect delyva/i });
		expect(connect.hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx123" },
		});
		expect(connect.hasAttribute("disabled")).toBe(false);
	});

	it("links the print-ready setup guide", () => {
		render(<DelyvaCard canUse country="MY" />);
		const link = screen
			.getAllByRole("link")
			.find((a) => a.getAttribute("href") === "/guides/delyva-setup.html");
		expect(link).toBeTruthy();
	});

	it("connects with the trimmed key", async () => {
		const connect = vi
			.fn()
			.mockResolvedValue({ ok: true, accountName: "Kedai Beku", webhooksSubscribed: true });
		state.actions.set(NAME.connect, connect);
		render(<DelyvaCard canUse country="MY" />);

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
		const connect = vi.fn().mockResolvedValue({
			ok: false,
			message: "Delyva didn't recognise this API key.",
		});
		state.actions.set(NAME.connect, connect);
		render(<DelyvaCard canUse country="MY" />);

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

	it("warns when the key worked but the webhook didn't register", async () => {
		const { toast } = await import("sonner");
		const connect = vi
			.fn()
			.mockResolvedValue({ ok: true, accountName: "X", webhooksSubscribed: false });
		state.actions.set(NAME.connect, connect);
		render(<DelyvaCard canUse country="MY" />);

		fireEvent.change(screen.getByLabelText(/delyva api key/i), {
			target: { value: "dx1" },
		});
		fireEvent.click(screen.getByRole("button", { name: /connect delyva/i }));
		await waitFor(() => expect(toast.warning).toHaveBeenCalled());
	});
});

describe("plan gate", () => {
	it("shows Pro and blocks connecting for a Starter seller", () => {
		const { container } = render(<DelyvaCard canUse={false} country="MY" />);
		expect(container.textContent).toContain("Pro");
		expect(
			screen.getByRole("button", { name: /connect delyva/i }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Disconnecting is never locked/i)).toBeTruthy();
	});

	it("never traps a downgraded seller who is already connected", () => {
		state.settings = settings();
		render(<DelyvaCard canUse={false} country="MY" />);
		// Pausing and disconnecting stay available…
		expect(
			screen.getByRole("button", { name: /^pause$/i }).hasAttribute("disabled"),
		).toBe(false);
		expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
	});

	it("blocks RESUMING on a downgrade, with the reason", () => {
		state.settings = settings({ enabled: false });
		render(<DelyvaCard canUse={false} country="MY" />);
		expect(
			screen.getByRole("button", { name: /^resume$/i }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/Resuming courier booking needs Pro/i)).toBeTruthy();
	});
});

describe("country gate", () => {
	it("stays out of a Singapore store's settings entirely — there's no action to offer", () => {
		state.settings = settings({ connected: false, countryAllowed: false });
		const { container } = render(<DelyvaCard canUse country="SG" />);
		expect(container.textContent).toBe("");
	});

	it("but a store that switched country WHILE connected sees the reason AND a way out", () => {
		state.settings = settings({ countryAllowed: false });
		render(<DelyvaCard canUse country="SG" />);
		expect(screen.getByText(/Malaysia-only for now/i)).toBeTruthy();
		// Telling a seller it's unavailable and stranding them would be the dead
		// end this card exists to avoid.
		expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
	});

	it("won't let a country-blocked store resume booking it can't use", () => {
		state.settings = settings({ countryAllowed: false, enabled: false });
		render(<DelyvaCard canUse country="SG" />);
		expect(
			screen.getByRole("button", { name: /^resume$/i }).hasAttribute("disabled"),
		).toBe(true);
	});
});

describe("connected", () => {
	beforeEach(() => {
		state.settings = settings();
	});

	it("proves which account the key belongs to", () => {
		const { container } = render(<DelyvaCard canUse country="MY" />);
		expect(container.textContent).toContain("Wagyu Walid Trading");
		expect(container.textContent).toContain("42dd");
	});

	it("switches the store default parcel type", async () => {
		render(<DelyvaCard canUse country="MY" />);
		fireEvent.click(screen.getByRole("button", { name: /frozen/i }));
		await waitFor(() => expect(state.mutation).toHaveBeenCalled());
		expect(state.mutation).toHaveBeenCalledWith({
			retailerId: undefined,
			defaultItemType: "FROZEN",
		});
	});

	it("surfaces the cold-chain activation step for a chilled store", () => {
		const { container } = render(<DelyvaCard canUse country="MY" />);
		expect(container.textContent).toContain("one-time activation");
		expect(screen.getByText("support@delyva.com")).toBeTruthy();
	});

	it("keeps that note off an ambient-only store", () => {
		state.settings = settings({ defaultItemType: "PARCEL" });
		const { container } = render(<DelyvaCard canUse country="MY" />);
		expect(container.textContent).not.toContain("one-time activation");
	});

	it("warns — and offers a retry — when the tracking webhook isn't registered", async () => {
		state.settings = settings({ webhooksSubscribed: false });
		const resubscribe = vi.fn().mockResolvedValue({ ok: true });
		state.actions.set(NAME.resubscribe, resubscribe);
		const { container } = render(<DelyvaCard canUse country="MY" />);

		expect(container.textContent).toContain("won't move to Shipped");
		fireEvent.click(screen.getByRole("button", { name: /retry now/i }));
		await waitFor(() => expect(resubscribe).toHaveBeenCalled());
	});

	it("flags a missing pickup address before the first booking fails", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(<DelyvaCard canUse country="MY" />);
		expect(screen.getByText(/Add this before your first booking/i)).toBeTruthy();
	});

	it("refuses a bad postcode client-side, mirroring the server rule", async () => {
		state.settings = settings({ pickupAddress: undefined });
		render(<DelyvaCard canUse country="MY" />);

		fireEvent.change(screen.getByLabelText(/street address/i), {
			target: { value: "12 Jalan Ampang" },
		});
		fireEvent.change(screen.getByLabelText(/city/i), {
			target: { value: "Kuala Lumpur" },
		});
		fireEvent.change(screen.getByLabelText(/^state$/i), {
			target: { value: "Selangor" },
		});
		fireEvent.change(screen.getByLabelText(/postcode/i), {
			target: { value: "504" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save pickup address/i }));

		expect(screen.getByText(/5-digit postcode/i)).toBeTruthy();
		expect(state.mutation).not.toHaveBeenCalled();
	});

	it("saves a complete pickup address", async () => {
		state.settings = settings({ pickupAddress: undefined });
		render(<DelyvaCard canUse country="MY" />);

		fireEvent.change(screen.getByLabelText(/street address/i), {
			target: { value: "12 Jalan Ampang" },
		});
		fireEvent.change(screen.getByLabelText(/city/i), {
			target: { value: "Kuala Lumpur" },
		});
		fireEvent.change(screen.getByLabelText(/^state$/i), {
			target: { value: "Selangor" },
		});
		fireEvent.change(screen.getByLabelText(/postcode/i), {
			target: { value: "50450" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save pickup address/i }));

		await waitFor(() => expect(state.mutation).toHaveBeenCalled());
		expect(state.mutation).toHaveBeenCalledWith({
			retailerId: undefined,
			pickupAddress: {
				address1: "12 Jalan Ampang",
				address2: undefined,
				city: "Kuala Lumpur",
				state: "Selangor",
				postcode: "50450",
			},
		});
	});

	it("strips non-digits from the postcode as it's typed", () => {
		state.settings = settings({ pickupAddress: undefined });
		render(<DelyvaCard canUse country="MY" />);
		const postcode = screen.getByLabelText(/postcode/i) as HTMLInputElement;
		fireEvent.change(postcode, { target: { value: "50-450x" } });
		expect(postcode.value).toBe("50450");
	});
});
