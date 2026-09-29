// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionView } from "../../lib/subscription";
import { PlanPickerCard } from "./plan-picker-card";

// The picker only writes: subscribeSelf (mutation) then, for a store with no
// saved method, startAutoRenewSetup (action) → HitPay. Controllable per test.
const mocks = vi.hoisted(() => ({
	subscribeSelf: vi.fn(),
	startAutoRenewSetup: vi.fn(),
	toastSuccess: vi.fn(),
}));
vi.mock("convex/react", () => ({
	useMutation: () => mocks.subscribeSelf,
	useAction: () => mocks.startAutoRenewSetup,
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

/** A trialing store choosing a plan, with a saved method on file. */
function sub(stopped: boolean): SubscriptionView {
	return {
		plan: "pro",
		status: "trialing",
		comped: false,
		caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
		autoRenew: {
			method: "card",
			methodLabel: "Visa ·· 4242",
			failedAttempts: 0,
			failing: false,
			stopped,
		},
	};
}

function renderPicker(s: SubscriptionView) {
	render(
		<PlanPickerCard
			sub={s}
			currency="MYR"
			renewing={false}
			foundingPricing={false}
			foundingPricingLapsed={false}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Subscribe to Pro" }));
}

describe("PlanPickerCard — a saved method whose auto-charging is STOPPED", () => {
	it("subscribing writes the invoice and stays put — never the authorisation page that would refuse", async () => {
		mocks.subscribeSelf.mockResolvedValue({
			invoiceId: "inv_1",
			chargingSavedMethod: false,
		});
		renderPicker(sub(true));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
		expect(mocks.subscribeSelf).toHaveBeenCalledWith({
			plan: "pro",
			billingCycle: "monthly",
		});
		// startAutoRenewSetup refuses "already on" for a store with a method —
		// calling it here would end the flow on an error toast.
		expect(mocks.startAutoRenewSetup).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Your invoice is ready", {
			description: expect.stringMatching(/Automatic charging is stopped/),
		});
		// The button is re-armed, not left on a spinner.
		expect(
			screen.getByRole("button", { name: "Subscribe to Pro" }),
		).toBeTruthy();
	});

	it("a healthy saved method is still charged straight away (unchanged)", async () => {
		mocks.subscribeSelf.mockResolvedValue({
			invoiceId: "inv_1",
			chargingSavedMethod: true,
		});
		renderPicker(sub(false));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			"Charging your saved payment method…",
			expect.anything(),
		);
		expect(mocks.startAutoRenewSetup).not.toHaveBeenCalled();
	});
});
