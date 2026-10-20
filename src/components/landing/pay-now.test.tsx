// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "../../paraglide/messages";
import { PAID_BEAT, PAYNOW_BEATS, PayNowPanes } from "./pay-now";

/**
 * Phase 02 of the seller-flow walkthrough: the buyer pays ONLINE through the
 * seller's own HitPay account and the order confirms itself. The beat is
 * passed in; these tests pin each beat to the state the REAL product has
 * (`track.$token.tsx`, `app.orders.$shortId.tsx`, `docs/hitpay-gateway.md`)
 * — the first cut acted out a flow that doesn't exist, and Arif caught it.
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

	it("opens on the real order page: Payment Unpaid, Pay now, the gateway's rails — and NO bank-transfer door", () => {
		const text = textAt(0);
		expect(text).toContain(m.paynow_buyer_unpaid());
		expect(text).toContain(m.paynow_pay_now({ amount: m.handshake_amount() }));
		expect(text).toContain(m.paynow_pay_sub());
		// A HitPay store withholds its bank details (86eye9xd4): the
		// "paid by bank transfer instead?" door never renders on this order.
		expect(text).not.toMatch(/bank transfer instead/i);
		// The seller sees the dashboard's own unpaid card, not an invention.
		expect(text).toContain(m.paynow_seller_unpaid());
		expect(text).toContain(m.handshake_seller_mark_received());
		expect(text).toContain(m.hero_after_status_1());
		expect(text).not.toContain(m.paynow_seller_received());
	});

	it("the tap opens HitPay's HOSTED page — the phone leaves the order page for it", () => {
		expect(textAt(1)).toContain(m.paynow_opening());
		const page = textAt(2);
		expect(page).toContain(m.paynow_page_label());
		expect(page).toContain(m.paynow_page_paying());
		expect(page).toContain(m.paynow_page_choose());
		for (const method of [
			m.paynow_method_duitnow(),
			m.paynow_method_fpx(),
			m.paynow_method_tng(),
			m.paynow_method_card(),
		]) {
			expect(page).toContain(method);
		}
		const scan = textAt(3);
		expect(scan).toContain(m.paynow_scan_title());
		expect(scan).toContain(m.paynow_scan_body());
	});

	it("comes back to the order page CONFIRMING — the real post-redirect state — before it reads paid", () => {
		const text = textAt(4);
		expect(text).toContain(m.paynow_confirming());
		expect(text).toContain(m.paynow_confirming_sub());
		expect(text).not.toContain(m.paynow_buyer_confirmed());
		expect(text).not.toContain(m.paynow_seller_received());
	});

	it("ends paid on both sides with nobody tapping: Payment Confirmed, Paid online via HitPay, one reference quoted twice", () => {
		const text = textAt(PAID_BEAT);
		expect(text).toContain(m.paynow_buyer_confirmed());
		expect(text).toContain(m.paynow_buyer_paid_via());
		expect(text).toContain(m.handshake_buyer_receipt());
		expect(text).toContain(m.paynow_seller_received());
		expect(text).toContain(m.paynow_seller_paid());
		expect(text).toContain(m.handshake_seller_confirmed());
		expect(text).toContain(m.paynow_caption());
		expect(text.split(m.paynow_ref_value())).toHaveLength(3);
		expect(text).not.toContain(m.handshake_seller_mark_received());
		expect(text).not.toContain(m.paynow_buyer_unpaid());
	});

	it("renders the paid frame as a still, with no hosted page to leave for", () => {
		const text = textAt(0, true);
		expect(text).toContain(m.paynow_seller_received());
		expect(text).not.toContain(m.paynow_page_label());
		expect(text).not.toContain(m.paynow_opening());
	});

	it("names the rails as the product does and never claims the money passes through Kedaipal", () => {
		expect(m.paynow_pay_sub()).toMatch(/DuitNow, FPX, Touch 'n Go or card/);
		expect(m.paynow_pay_sub()).toMatch(/confirms automatically/);
		expect(m.paynow_caption()).toMatch(/your own HitPay account/i);
		expect(m.paynow_seller_paid()).toMatch(/^Paid online via HitPay/);
	});
});
