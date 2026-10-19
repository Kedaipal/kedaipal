// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "../../paraglide/messages";
import { PAID_BEAT, PAYNOW_BEATS, PayNowPanes } from "./pay-now";

/**
 * Phase 02 of the seller-flow walkthrough: the buyer pays ONLINE through the
 * seller's own HitPay account and the order confirms itself — no screenshot,
 * no tap. The beat is passed in; these tests pin what each beat claims,
 * against the real order page's copy ("Pay now · RM …", "confirms
 * automatically", "Paid online via HitPay").
 */

afterEach(cleanup);

function textAt(beat: number, still = false): string {
	const { container } = render(<PayNowPanes beat={beat} still={still} />);
	const text = container.textContent ?? "";
	cleanup();
	return text;
}

describe("PayNowPanes", () => {
	it("has a beat table the timeline can flatten, ending on the paid beat", () => {
		expect(PAYNOW_BEATS.length).toBe(PAID_BEAT + 1);
	});

	it("opens on the order page's Pay now button, with the transfer door under it, and an unpaid seller card", () => {
		const text = textAt(0);
		expect(text).toContain(m.paynow_pay_now({ amount: m.handshake_amount() }));
		expect(text).toContain(m.paynow_pay_sub());
		expect(text).toContain(m.paynow_transfer_instead());
		expect(text).toContain(m.handshake_seller_unpaid_title());
		expect(text).toContain(m.handshake_seller_pending());
		expect(text).not.toContain(m.paynow_seller_paid());
	});

	it("opens HitPay's checkout with the real rails, then the QR to scan", () => {
		const sheet = textAt(2);
		expect(sheet).toContain(m.paynow_sheet_label());
		for (const method of [
			m.paynow_method_duitnow(),
			m.paynow_method_fpx(),
			m.paynow_method_tng(),
			m.paynow_method_card(),
		]) {
			expect(sheet).toContain(method);
		}
		const scan = textAt(3);
		expect(scan).toContain(m.paynow_scan_title());
		expect(scan).toContain(m.paynow_scan_body());
	});

	it("ends paid on both sides with nobody tapping: the seller card says Paid online via HitPay", () => {
		const text = textAt(PAID_BEAT);
		expect(text).toContain(
			m.paynow_paid_title({ amount: m.handshake_amount() }),
		);
		expect(text).toContain(m.paynow_paid_body());
		expect(text).toContain(m.paynow_seller_paid());
		expect(text).toContain(m.handshake_seller_confirmed());
		expect(text).toContain(m.paynow_caption());
		expect(text).not.toContain(m.handshake_seller_mark_received());
		expect(text).not.toContain(m.handshake_seller_unpaid_title());
	});

	it("renders the paid frame as a still", () => {
		const text = textAt(0, true);
		expect(text).toContain(m.paynow_seller_paid());
		expect(text).not.toContain(m.paynow_sheet_label());
	});

	it("never claims the money passes through Kedaipal", () => {
		expect(m.paynow_powered()).toMatch(/your own HitPay account/i);
		expect(m.paynow_paid_body()).not.toMatch(/sent/i);
	});
});
