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
 * Payments → How buyers pay (86eye9xd4, 8A): one door, chosen here. The
 * choice is HitPay's `enabled` switch; every state that can't take the online
 * door says why, where the seller is clicking.
 */

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		success: (...a: unknown[]) => toastSuccess(...a),
		error: vi.fn(),
	},
}));

import { HitpayAccountCard, HowBuyersPayCard } from "./how-buyers-pay-card";

type Props = Parameters<typeof HowBuyersPayCard>[0];

const CONNECTED = { enabled: false, hasCredentials: true, apiKeyHint: "abcd" };

function renderCard(overrides: Partial<Props> = {}) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	const onOpenIntegrations = vi.fn();
	render(
		<HowBuyersPayCard
			hitpay={CONNECTED}
			canUse
			manualCount={2}
			onSave={onSave}
			onOpenIntegrations={onOpenIntegrations}
			{...overrides}
		/>,
	);
	return { onSave, onOpenIntegrations };
}

const row = (name: RegExp) =>
	screen.getByRole("radio", { name }) as HTMLInputElement;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("HowBuyersPayCard", () => {
	it("is one choice: manual is selected while HitPay isn't in use", () => {
		renderCard();
		expect(screen.getByRole("group", { name: "How buyers pay" })).toBeTruthy();
		expect(row(/Manual transfer/).checked).toBe(true);
		expect(row(/HitPay online/).checked).toBe(false);
		// The header glance states the choice too — two "Manual transfer"s.
		expect(screen.getAllByText("Manual transfer")).toHaveLength(2);
	});

	it("picking HitPay switches it on, says what that hides, and offers Undo", async () => {
		const { onSave } = renderCard();
		fireEvent.click(row(/HitPay online/));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ hitpay: { enabled: true } }),
		);
		const [message, options] = toastSuccess.mock.calls[0] as [
			string,
			{ action: { onClick: () => void } },
		];
		expect(message).toMatch(/bank and QR details are hidden/);
		options.action.onClick();
		expect(onSave).toHaveBeenLastCalledWith({ hitpay: { enabled: false } });
	});

	it("with HitPay in use, picking manual switches it off", async () => {
		const { onSave } = renderCard({ hitpay: { ...CONNECTED, enabled: true } });
		expect(row(/HitPay online/).checked).toBe(true);
		expect(screen.getByText(/switching back is instant/)).toBeTruthy();
		fireEvent.click(row(/Manual transfer/));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ hitpay: { enabled: false } }),
		);
	});

	it("no account yet: HitPay is disabled WITH its reason and a way there", () => {
		const { onSave, onOpenIntegrations } = renderCard({ hitpay: undefined });
		expect(row(/HitPay online/).disabled).toBe(true);
		expect(screen.getByText(/Connect your HitPay account/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open Integrations" }));
		expect(onOpenIntegrations).toHaveBeenCalled();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("Starter can't switch it on — Pro chip and the reason, never a dead click", () => {
		renderCard({ canUse: false });
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(row(/HitPay online/).disabled).toBe(true);
		expect(screen.getByText(/Pro feature/)).toBeTruthy();
	});

	it("a downgraded store already on HitPay can still switch it OFF", async () => {
		const { onSave } = renderCard({
			canUse: false,
			hitpay: { ...CONNECTED, enabled: true },
		});
		expect(row(/Manual transfer/).disabled).toBe(false);
		fireEvent.click(row(/Manual transfer/));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ hitpay: { enabled: false } }),
		);
	});

	it("manual with nothing saved warns that buyers have nothing to pay with", () => {
		renderCard({ hitpay: undefined, manualCount: 0 });
		expect(screen.getByText(/nothing to pay with yet/)).toBeTruthy();
	});
});

describe("HitpayAccountCard", () => {
	it("names the account's state and links to where the keys live", () => {
		const open = vi.fn();
		render(<HitpayAccountCard hitpay={CONNECTED} onOpenIntegrations={open} />);
		expect(screen.getByText("Connected")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));
		expect(open).toHaveBeenCalled();
	});

	it("test keys read as a warning, not as connected", () => {
		render(
			<HitpayAccountCard
				hitpay={{ ...CONNECTED, mode: "sandbox" }}
				onOpenIntegrations={vi.fn()}
			/>,
		);
		expect(screen.getByText("Test keys")).toBeTruthy();
	});
});
