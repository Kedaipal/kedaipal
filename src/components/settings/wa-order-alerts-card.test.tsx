// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaOrderAlertsCard } from "./wa-order-alerts-card";

/**
 * Seller WhatsApp order alerts card (86eyhw9zy). The card is presentational
 * (config in, onSave patch out) — these tests pin the patch payloads (the
 * client normalizes to the inbound "60…" form before saving), the
 * disabled-with-reason Starter state, and the STOP-opt-out warning.
 */

function renderCard(
	overrides: Partial<Parameters<typeof WaOrderAlertsCard>[0]> = {},
) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	render(
		<WaOrderAlertsCard
			enabled={false}
			currentPhone=""
			fallbackPhone=""
			optedOut={false}
			canUse={true}
			onSave={onSave}
			{...overrides}
		/>,
	);
	return onSave;
}

describe("WaOrderAlertsCard", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("turning on saves the normalized number + the toggle in one patch", async () => {
		const onSave = renderCard();
		fireEvent.change(screen.getByPlaceholderText("e.g. 012-345 6789"), {
			target: { value: "019-876 5432" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /turn on whatsapp alerts/i }),
		);
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				notifyWaPhone: "60198765432",
				orderWaAlerts: true,
			}),
		);
	});

	it("rejects a non-mobile number inline without calling onSave", async () => {
		const onSave = renderCard();
		fireEvent.change(screen.getByPlaceholderText("e.g. 012-345 6789"), {
			target: { value: "03-8888 1234" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /turn on whatsapp alerts/i }),
		);
		expect(
			await screen.findByText(/Malaysian mobile number/i),
		).toBeDefined();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("prefills from the store's WhatsApp contact so most sellers just tap once", () => {
		renderCard({ fallbackPhone: "60123456789" });
		expect(
			(screen.getByPlaceholderText("e.g. 012-345 6789") as HTMLInputElement)
				.value,
		).toBe("60123456789");
	});

	it("Starter sees disabled-with-reason + the Pro chip, never a dead click", () => {
		const onSave = renderCard({
			canUse: false,
			fallbackPhone: "60123456789",
		});
		expect(screen.getByText("Pro")).toBeDefined();
		const button = screen.getByRole("button", {
			name: /turn on whatsapp alerts/i,
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByText(/Pro feature/i)).toBeDefined();
		fireEvent.click(button);
		expect(onSave).not.toHaveBeenCalled();
	});

	it("enabled state shows the formatted number; Turn off saves only the toggle", async () => {
		const onSave = renderCard({
			enabled: true,
			currentPhone: "60198765432",
		});
		expect(screen.getByText("+60 19-876 5432")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: /turn off/i }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ orderWaAlerts: false }),
		);
	});

	it("a STOP'd number surfaces the suppression warning with the START fix", () => {
		renderCard({
			enabled: true,
			currentPhone: "60198765432",
			optedOut: true,
		});
		expect(screen.getByText(/STOP/)).toBeDefined();
		expect(screen.getByText(/START/)).toBeDefined();
	});
});
