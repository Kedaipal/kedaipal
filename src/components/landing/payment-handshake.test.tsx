// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { m } from "../../paraglide/messages";
import { HandshakePanes, RECEIVED_BEAT } from "./payment-handshake";

/**
 * The handshake mock is phase 02 of the seller-flow walkthrough
 * (`seller-flow.tsx` owns the clock). These tests pin what the story CLAIMS
 * at each beat, with the beat passed in: it opens on a state (never a blank),
 * the buyer pays from their order page with a screenshot, the seller marks it
 * received, and both sides flip without a message to the buyer — the real
 * flow since 4 Aug 2026.
 */

afterEach(cleanup);

function textAt(beat: number, still = false): string {
	const { container } = render(<HandshakePanes beat={beat} still={still} />);
	const text = container.textContent ?? "";
	cleanup();
	return text;
}

describe("HandshakePanes", () => {
	it("opens on a state, not a blank: How to pay on the buyer's page, Unpaid on the seller's order", () => {
		const text = textAt(0);
		expect(text).toContain(m.handshake_how_to_pay());
		expect(text).toContain(m.handshake_ive_paid());
		expect(text).toContain(m.handshake_seller_unpaid_title());
		expect(text).toContain(m.handshake_seller_pending());
		expect(text).not.toContain(m.handshake_seller_claimed());
		expect(text).not.toContain(m.handshake_buyer_received_title());
		expect(text).not.toContain(m.handshake_caption());
	});

	it("walks the real flow: claim with a screenshot → seller marks received → both sides flip, no message to the buyer", () => {
		// Beat 1: the sheet is up, screenshot first, submit held with its reason.
		expect(textAt(1)).toContain(m.handshake_sheet_attach_title());
		expect(textAt(1)).toContain(m.handshake_sheet_submit_blocked());

		// Beat 2: the screenshot landed, so Submit is live.
		expect(textAt(2)).toContain(m.handshake_sheet_attached());
		expect(textAt(2)).toContain(m.handshake_sheet_submit());

		// Beat 3: submitted — the buyer waits on their page; the seller sees the
		// claim with the reference, and the one WhatsApp goes to the SELLER.
		const claimed = textAt(3);
		expect(claimed).toContain(m.handshake_buyer_waiting_title());
		expect(claimed).toContain(m.handshake_seller_claimed());
		expect(claimed).toContain(m.handshake_seller_reference());
		expect(claimed).toContain(m.handshake_alert_body());
		expect(claimed).not.toContain(m.handshake_buyer_received_title());

		// The received beat: both sides flip, the receipt is on the buyer's
		// page and the caption says nothing was sent.
		const received = textAt(RECEIVED_BEAT);
		expect(received).toContain(m.handshake_buyer_received_title());
		expect(received).toContain(m.handshake_buyer_receipt());
		expect(received).toContain(m.handshake_seller_received());
		expect(received).toContain(m.handshake_seller_auto_confirmed());
		expect(received).toContain(m.handshake_seller_confirmed());
		expect(received).toContain(m.handshake_caption());
		expect(received).not.toContain(m.handshake_seller_claimed());
	});

	it("renders the received frame as a still", () => {
		const text = textAt(0, true);
		expect(text).toContain(m.handshake_buyer_received_title());
		expect(text).toContain(m.handshake_seller_received());
		expect(text).toContain(m.handshake_caption());
		expect(text).not.toContain(m.handshake_how_to_pay());
		expect(text).not.toContain(m.handshake_seller_unpaid_title());
	});

	it("never says the receipt was sent — it is on the order page", () => {
		expect(m.handshake_seller_receipt_line()).toMatch(/order page/i);
		expect(m.handshake_caption()).not.toMatch(/receipt sent/i);
	});
});
