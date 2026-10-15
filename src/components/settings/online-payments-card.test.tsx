// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlinePaymentsCard } from "./online-payments-card";

/**
 * HitPay connect card, country-aware copy (SG-lite, 86eyph341). The card is
 * presentational (summary in, patch out) — these tests pin the three things
 * that were Malaysia-only and would have been plainly wrong for the first
 * Singapore vendor: the business registry a seller must hold, the rail the
 * payout speed is compared against, and which marks the pitch shows.
 *
 * They also pin the two load-bearing lines that must survive any copy edit:
 * the money lands in the seller's OWN HitPay account and Kedaipal adds nothing.
 */

function renderCard(
	overrides: Partial<Parameters<typeof OnlinePaymentsCard>[0]> = {},
) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	render(
		<OnlinePaymentsCard
			hitpay={undefined}
			canUse={true}
			country="MY"
			onSave={onSave}
			onChooseHowBuyersPay={vi.fn()}
			{...overrides}
		/>,
	);
	return onSave;
}

/** The pitch bullets only render before an account is connected. */
function pitchText(): string {
	return document.body.textContent ?? "";
}

describe("OnlinePaymentsCard — country-aware copy", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("an MY store still reads exactly as before: SSM + DuitNow", () => {
		renderCard({ country: "MY" });
		const text = pitchText();
		expect(text).toContain("SSM-registered business");
		expect(text).toContain("not instant like a direct DuitNow transfer");
		expect(text).toContain("from ~1.2% for DuitNow QR");
		// SG's registry must not leak into a Malaysian store's card.
		expect(text).not.toContain("ACRA");
		expect(text).not.toContain("UEN");
	});

	it("an SG store reads UEN/ACRA and compares against PayNow, never SSM", () => {
		renderCard({ country: "SG" });
		const text = pitchText();
		// SSM is the Malaysian registry — the original defect.
		expect(text).not.toContain("SSM");
		expect(text).toContain("ACRA-registered business");
		expect(text).toContain("UEN");
		// DuitNow does not exist in Singapore, in any bullet.
		expect(text).not.toContain("DuitNow");
		expect(text).toContain("not instant like a direct PayNow transfer");
	});

	it("keeps the load-bearing money lines in both countries", () => {
		for (const country of ["MY", "SG"] as const) {
			cleanup();
			renderCard({ country });
			const text = pitchText();
			expect(text).toContain("Kedaipal takes nothing");
			// Never promises a rail the seller hasn't switched on themselves.
			expect(text).toContain("buyers only ever see the ones you've enabled");
		}
	});

	it("pitches the market's rails — SG leads with a PayNow chip, not a raster", () => {
		renderCard({ country: "SG" });
		// paynow.svg is a base64 PNG in an <svg> shell, so PayNow is deliberately
		// a wordmark chip. If someone wires the file in, this goes red.
		expect(screen.getByText("PayNow")).toBeTruthy();
		expect(document.querySelector('img[src="/img/payment/paynow.svg"]')).toBe(
			null,
		);
		// And it must never print the raw API code.
		expect(pitchText()).not.toContain("paynow online");
	});

	it("an MY store pitches the MY marks", () => {
		renderCard({ country: "MY" });
		expect(
			document.querySelector('img[src="/img/payment/duitnow.svg"]'),
		).toBeTruthy();
		expect(
			document.querySelector('img[src="/img/payment/touchngo.svg"]'),
		).toBeTruthy();
		expect(screen.queryByText("PayNow")).toBeNull();
	});
});

describe("OnlinePaymentsCard — the account, not the choice (86eye9xd4)", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("connecting stores the keys without switching buyers over", async () => {
		const onSave = renderCard();
		fireEvent.change(screen.getByLabelText(/API key/i), {
			target: { value: "test_key_abcd" },
		});
		fireEvent.change(screen.getByLabelText(/Salt/i), {
			target: { value: "salt_1234" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect HitPay" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				hitpay: { enabled: false, apiKey: "test_key_abcd", salt: "salt_1234" },
			}),
		);
		// …and says where the switch is, before the seller taps.
		expect(document.body.textContent).toContain("Payments → How buyers pay");
	});

	it("a connected card points at How buyers pay instead of a second switch", () => {
		const onChoose = vi.fn();
		const onSave = renderCard({
			hitpay: { enabled: false, hasCredentials: true, apiKeyHint: "abcd" },
			onChooseHowBuyersPay: onChoose,
		});
		expect(screen.queryByRole("button", { name: /Pause|Resume/ })).toBeNull();
		expect(screen.getByText("Not in use")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose how buyers pay" }),
		);
		expect(onChoose).toHaveBeenCalled();
		expect(onSave).not.toHaveBeenCalled();
	});
});
