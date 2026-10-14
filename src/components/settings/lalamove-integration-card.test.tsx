// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Lalamove account card's setup checklist (86eye9xd4, 5A): three steps
 * with live state, the webhook registered in one tap and the manual paste
 * kept as the fallback.
 */

const registerWebhook = vi.fn();
vi.mock("convex/react", () => ({ useAction: () => registerWebhook }));
const wallet = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: wallet.current }),
}));
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search: _search,
		...props
	}: Record<string, unknown> & { to?: string; search?: unknown }) => (
		<a href={to} {...props} />
	),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

import { LalamoveIntegrationCard } from "./lalamove-integration-card";

type Props = Parameters<typeof LalamoveIntegrationCard>[0];
type Booking = NonNullable<Props["deliveryBooking"]>;

const KEYED: Booking = {
	enabled: false,
	vehicleType: "MOTORCYCLE",
	hasCredentials: true,
	promptBookOnPacked: false,
	deliveryDirection: "standard",
	apiKeyHint: "a4f2",
	env: "production",
};
const HQ = { label: "Kompleks Niaga 3B, Shah Alam" };

function renderCard(overrides: Partial<Props> = {}) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	render(
		<LalamoveIntegrationCard
			retailerId={"r1" as never}
			deliveryBooking={KEYED}
			businessAddress={HQ}
			onSave={onSave}
			{...overrides}
		/>,
	);
	return onSave;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	wallet.current = null;
});

describe("LalamoveIntegrationCard — setup checklist", () => {
	it("counts what's done and asks for the webhook in place", () => {
		renderCard();
		expect(screen.getByText("Setup 2 of 3")).toBeTruthy();
		expect(screen.getByText(HQ.label, { exact: false })).toBeTruthy();
		expect(screen.getByText("…a4f2")).toBeTruthy();
		expect(screen.getByText("(action needed)")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Register automatically" }),
		).toBeTruthy();
	});

	it("a fully set-up account reads as quiet rows and one Connected chip", () => {
		renderCard({ deliveryBooking: { ...KEYED, webhookRegisteredAt: 1 } });
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(screen.queryByText("(action needed)")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Register automatically" }),
		).toBeNull();
	});

	it("registers the webhook in one tap", async () => {
		registerWebhook.mockResolvedValue({ ok: true });
		renderCard();
		fireEvent.click(
			screen.getByRole("button", { name: "Register automatically" }),
		);
		await waitFor(() => expect(registerWebhook).toHaveBeenCalledWith({}));
	});

	it("a refused registration opens the manual paste with the reason", async () => {
		registerWebhook.mockResolvedValue({
			ok: false,
			message: "Lalamove didn't accept the registration",
		});
		renderCard();
		expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Register automatically" }),
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy(),
		);
		expect(toastError).toHaveBeenCalledWith(
			"Lalamove didn't accept the registration",
		);
	});

	it("no address yet: step 1 needs action and links to where it's set", () => {
		renderCard({ businessAddress: undefined });
		expect(screen.getByText("Setup 1 of 3")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Set it under Fulfilment" }),
		).toBeTruthy();
	});

	it("no keys: the key form is the step, and the webhook waits for it", async () => {
		const onSave = renderCard({ deliveryBooking: undefined });
		expect(screen.getByText("Not connected")).toBeTruthy();
		expect(screen.getByText("After your API key.")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Lalamove API key"), {
			target: { value: "pk_prod_x" },
		});
		fireEvent.change(screen.getByLabelText("Lalamove API secret"), {
			target: { value: "sk_prod_x" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save keys" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				deliveryBooking: {
					enabled: false,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk_prod_x",
					apiSecret: "sk_prod_x",
				},
			}),
		);
	});

	it("shows the reported wallet beside the key, amber when low (6A)", () => {
		wallet.current = { balance: 1240, currency: "MYR", at: 1, low: true };
		renderCard();
		expect(screen.getByText("RM 12.40").className).toContain("amber");
	});

	it("sandbox keys say what they cost on the key step", () => {
		renderCard({ deliveryBooking: { ...KEYED, env: "sandbox" } });
		expect(screen.getByText(/No real rider will be dispatched/)).toBeTruthy();
	});
});
