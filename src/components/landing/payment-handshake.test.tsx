// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import {
	HANDSHAKE_BEATS,
	PaymentHandshake,
	RECEIVED_BEAT,
} from "./payment-handshake";

/**
 * The mock is decorative, so the tests pin what the story CLAIMS: it opens on
 * a state (never a blank beat), the buyer pays from their order page with a
 * screenshot, the seller marks it received, and both sides flip without a
 * message to the buyer — the real flow since 4 Aug 2026. Plus the copy
 * column, which carries the content a screen reader gets.
 */

let reducedMotion = false;
let inView = false;

vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return {
		...actual,
		useReducedMotion: () => reducedMotion,
		useInView: () => inView,
	};
});

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

/** One `act` per beat — the hook re-arms from an effect (see delivery.test). */
let beatCursor = 0;
function stepLoop(count: number) {
	for (let i = 0; i < count; i++) {
		act(() => vi.advanceTimersByTime(HANDSHAKE_BEATS[beatCursor]));
		beatCursor = (beatCursor + 1) % HANDSHAKE_BEATS.length;
	}
}

describe("PaymentHandshake", () => {
	beforeEach(() => {
		reducedMotion = false;
		inView = false;
		beatCursor = 0;
		vi.stubGlobal("IntersectionObserver", NeverInViewObserver);
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("opens on a state, not a blank: How to pay on the buyer's page, Unpaid on the seller's order", () => {
		const { container } = render(<PaymentHandshake />);
		const text = container.textContent ?? "";
		expect(text).toContain(m.handshake_how_to_pay());
		expect(text).toContain(m.handshake_ive_paid());
		expect(text).toContain(m.handshake_seller_unpaid_title());
		expect(text).toContain(m.handshake_seller_pending());
		expect(text).not.toContain(m.handshake_seller_claimed());
		expect(text).not.toContain(m.handshake_buyer_received_title());
		expect(text).not.toContain(m.handshake_caption());
	});

	it("walks the real flow: claim with a screenshot → seller marks received → both sides flip, no message to the buyer", () => {
		vi.useFakeTimers();
		inView = true;
		const { container } = render(<PaymentHandshake />);
		const text = () => container.textContent ?? "";

		// Beat 1: the sheet is up, screenshot first, submit held with its reason.
		stepLoop(1);
		expect(text()).toContain(m.handshake_sheet_attach_title());
		expect(text()).toContain(m.handshake_sheet_submit_blocked());

		// Beat 2: the screenshot landed, so Submit is live.
		stepLoop(1);
		expect(text()).toContain(m.handshake_sheet_attached());
		expect(text()).toContain(m.handshake_sheet_submit());

		// Beat 3: submitted — the buyer waits on their page; the seller sees the
		// claim with the reference, and the one WhatsApp goes to the SELLER.
		stepLoop(1);
		expect(text()).toContain(m.handshake_buyer_waiting_title());
		expect(text()).toContain(m.handshake_seller_claimed());
		expect(text()).toContain(m.handshake_seller_reference());
		expect(text()).toContain(m.handshake_alert_body());
		expect(text()).not.toContain(m.handshake_buyer_received_title());

		// Beats 4–5: the seller taps, both sides flip, the receipt is on the
		// buyer's page and the caption says nothing was sent.
		stepLoop(RECEIVED_BEAT - 3);
		expect(text()).toContain(m.handshake_buyer_received_title());
		expect(text()).toContain(m.handshake_buyer_receipt());
		expect(text()).toContain(m.handshake_seller_received());
		expect(text()).toContain(m.handshake_seller_auto_confirmed());
		expect(text()).toContain(m.handshake_seller_confirmed());
		expect(text()).toContain(m.handshake_caption());
		expect(text()).not.toContain(m.handshake_seller_claimed());
	});

	it("renders the received frame as a still under reduced motion", () => {
		reducedMotion = true;
		const { container } = render(<PaymentHandshake />);
		const text = container.textContent ?? "";
		expect(text).toContain(m.handshake_buyer_received_title());
		expect(text).toContain(m.handshake_seller_received());
		expect(text).toContain(m.handshake_caption());
		expect(text).not.toContain(m.handshake_how_to_pay());
		expect(text).not.toContain(m.handshake_seller_unpaid_title());
	});

	it("says in the copy that nothing is sent — the receipt is on the order page", () => {
		render(<PaymentHandshake />);
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			m.handshake_heading(),
		);
		expect(m.handshake_body_2()).toMatch(/order page/i);
		expect(m.handshake_body_2()).not.toMatch(/goes out on WhatsApp/i);
		expect(m.handshake_point_3()).toMatch(/order page/i);
		expect(screen.getByText(m.handshake_point_3())).toBeTruthy();
	});
});
