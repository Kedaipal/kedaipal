// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Lalamove account card's setup checklist (86eye9xd4, 5A): three steps
 * with live state, the webhook registered in one tap and the manual paste
 * kept as the fallback. Plus (z8r3fdy5ht) the key check before a save and
 * the Disconnect that is greyed out with its reason.
 */

const registerWebhook = vi.fn();
const verifyKeys = vi.fn();
// Routed by function name — the key check and the webhook are different
// actions, and a shared mock would let a crossed wire pass.
vi.mock("convex/react", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		useAction: (fn: never) =>
			getFunctionName(fn) === "lalamove:verifyKeys"
				? verifyKeys
				: registerWebhook,
	};
});
const wallet = vi.hoisted(() => ({ current: null as unknown }));
const block = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		useQuery: (opts: { fn: never; args: unknown }) =>
			opts.args === "skip"
				? { data: undefined }
				: getFunctionName(opts.fn) === "lalamove:getDisconnectState"
					? { data: block.current }
					: { data: wallet.current },
	};
});
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
	block.current = null;
});

function typeKeys(apiKey: string, apiSecret: string) {
	fireEvent.change(screen.getByLabelText("Lalamove API key"), {
		target: { value: apiKey },
	});
	fireEvent.change(screen.getByLabelText("Lalamove API secret"), {
		target: { value: apiSecret },
	});
}

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

	it("says the tap replaces the account's existing webhook BEFORE it's made", () => {
		// Lalamove keeps one webhook URL per account and we can't restore what
		// was there: an outward, irreversible effect is disclosed, never silent.
		renderCard();
		expect(
			screen.getByText(/Replaces any webhook address already set/),
		).toBeTruthy();
		renderCard({ deliveryBooking: { ...KEYED, webhookRegisteredAt: 1 } });
		expect(
			screen.getAllByText(/Replaces any webhook address already set/),
		).toHaveLength(1);
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
		verifyKeys.mockResolvedValue({ ok: true, env: "production" });
		const onSave = renderCard({ deliveryBooking: undefined });
		expect(screen.getByText("Not connected")).toBeTruthy();
		expect(screen.getByText("After your API key.")).toBeTruthy();
		typeKeys("pk_prod_x", "sk_prod_x");
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

describe("a pasted pair is checked before it is stored (z8r3fdy5ht)", () => {
	const saveButton = () => screen.getByRole("button", { name: /save keys/i });

	it("pins the routing: the mock names are the real function names", async () => {
		const { getFunctionName } = await import("convex/server");
		const { api } = await import("../../../convex/_generated/api");
		expect(getFunctionName(api.lalamove.verifyKeys)).toBe(
			"lalamove:verifyKeys",
		);
		expect(getFunctionName(api.lalamove.getDisconnectState)).toBe(
			"lalamove:getDisconnectState",
		);
	});

	it("another provider's client ID is named as the wrong thing, before the tap", () => {
		// The 28 Oct paste: an EasyParcel OAuth client ID + secret.
		renderCard({ deliveryBooking: undefined });
		typeKeys("1467ee4f-978c-45bb-9cf2-a3f73bd900e1", "d0a7408b9e0c");
		expect(screen.getByRole("alert").textContent).toMatch(
			/isn't a Lalamove API key/,
		);
		expect(saveButton().hasAttribute("disabled")).toBe(true);
		expect(verifyKeys).not.toHaveBeenCalled();
	});

	it("Lalamove's refusal stays under the fields and nothing is saved", async () => {
		verifyKeys.mockResolvedValue({
			ok: false,
			message: "Lalamove didn't accept this key and secret for Malaysia.",
		});
		const onSave = renderCard({ deliveryBooking: undefined });
		typeKeys("pk_prod_wrong", "sk_prod_wrong");
		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toMatch(
				/didn't accept this key/,
			),
		);
		expect(onSave).not.toHaveBeenCalled();
	});

	it("editing a field clears the old verdict", async () => {
		verifyKeys.mockResolvedValue({ ok: false, message: "Nope." });
		renderCard({ deliveryBooking: undefined });
		typeKeys("pk_prod_wrong", "sk_prod_wrong");
		fireEvent.click(saveButton());
		await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
		fireEvent.change(screen.getByLabelText("Lalamove API secret"), {
			target: { value: "sk_prod_right" },
		});
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("Disconnect (z8r3fdy5ht)", () => {
	const disconnectButton = () =>
		screen.getByRole("button", { name: "Disconnect" });
	// The modal hides the page behind it, so its confirm is found inside it.
	const confirmInDialog = () =>
		within(
			screen.queryByRole("alertdialog") ?? screen.getByRole("dialog"),
		).getByRole("button", { name: "Disconnect" });

	it("isn't offered until there are keys to remove", () => {
		renderCard({ deliveryBooking: undefined });
		expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
	});

	it("confirms first, then removes the keys with deliveryBooking: null", async () => {
		const onSave = renderCard();
		fireEvent.click(disconnectButton());
		expect(screen.getByText("Disconnect Lalamove?")).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.click(confirmInDialog());
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ deliveryBooking: null }),
		);
	});

	it("greys out with the pricing reason and the page that fixes it", () => {
		block.current = {
			reason: "pricing",
			message: "Lalamove is quoting your delivery charge — switch it first.",
		};
		renderCard();
		expect(disconnectButton().hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText(/Lalamove is quoting your delivery charge/),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Delivery pricing" })
				.getAttribute("href"),
		).toBe("/app/settings/delivery-pricing");
	});

	it("greys out while a rider is out, linking the order", () => {
		block.current = {
			reason: "rider_out",
			message: "A Lalamove rider is still out on ORD-AB12.",
			shortIds: ["ORD-AB12"],
		};
		renderCard();
		expect(disconnectButton().hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("link", { name: "Open ORD-AB12" })).toBeTruthy();
	});

	it("a refusal at confirm time is toasted and the dialog stays open", async () => {
		const onSave = vi.fn().mockRejectedValue(new Error("A rider just left."));
		renderCard({ onSave });
		fireEvent.click(disconnectButton());
		fireEvent.click(confirmInDialog());
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("A rider just left."),
		);
		expect(screen.getByText("Disconnect Lalamove?")).toBeTruthy();
	});
});
