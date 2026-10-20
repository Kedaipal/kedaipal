import { describe, expect, test } from "vitest";
import {
	counterPrimaryAction,
	showsSellerPaymentControls,
} from "./counter-panel";

/**
 * The counter panel's mode rules (86eyq0epn). The invariant the whole redesign
 * exists for is the first test here: in send mode the seller must not be shown
 * collection or payment, because the BUYER picks those — keying them and then
 * tapping Send silently discarded the work.
 */
describe("showsSellerPaymentControls", () => {
	test("counter keys its own payment; send never does", () => {
		expect(showsSellerPaymentControls("counter")).toBe(true);
		expect(showsSellerPaymentControls("send")).toBe(false);
	});
});

describe("counterPrimaryAction", () => {
	const base = {
		empty: false,
		money: "RM 20.00",
		windowMinutes: 15,
		buyerName: "Zaki",
	};

	test("each mode names its own outcome, and shows the money", () => {
		expect(counterPrimaryAction({ ...base, mode: "counter" }).label).toBe(
			"Review order · RM 20.00",
		);
		expect(counterPrimaryAction({ ...base, mode: "send" }).label).toBe(
			"Send link · RM 20.00",
		);
	});

	test("an empty cart is disabled with a reason in both modes", () => {
		for (const mode of ["counter", "send"] as const) {
			const a = counterPrimaryAction({ ...base, mode, empty: true });
			expect(a.disabled).toBe(true);
			expect(a.reason).toBe("Add an item first");
		}
	});

	test("a mixed RSVP cart blocks BOTH modes, naming the line to remove (z8r3fdhh45)", () => {
		// Unlike `freeLine`, this one is not a send-path nicety: `orders.create`
		// refuses a mixed order at either door, so an enabled button in counter
		// mode would be a lie that fails at submit.
		for (const mode of ["counter", "send"] as const) {
			const a = counterPrimaryAction({
				...base,
				mode,
				mixedRsvp: "Ceramic mug",
			});
			expect(a.disabled).toBe(true);
			expect(a.reason).toMatch(/its own order/i);
			// Names WHAT to take out — "this order is invalid" leaves the seller
			// hunting through the cart.
			expect(a.reason).toContain("Ceramic mug");
		}
	});

	test("the mix outranks the event's send-mode reason — it blocks more doors", () => {
		// A mixed cart necessarily HAS an event line, so both reasons apply.
		// The mix is the one the seller can act on.
		const a = counterPrimaryAction({
			...base,
			mode: "send",
			eventName: "BNI Breakfast",
			mixedRsvp: "Ceramic mug",
		});
		expect(a.reason).toMatch(/its own order/i);
	});

	test("an empty cart still outranks the mix — there is nothing to unmix", () => {
		const a = counterPrimaryAction({
			...base,
			mode: "counter",
			empty: true,
			mixedRsvp: "Ceramic mug",
		});
		expect(a.reason).toBe("Add an item first");
	});

	test("a free (RM0) line blocks SEND only — a claim link exists to take a payment", () => {
		const send = counterPrimaryAction({
			...base,
			mode: "send",
			freeLine: "Bespoke Cake",
		});
		expect(send.disabled).toBe(true);
		expect(send.reason).toMatch(/"Bespoke Cake" is free/i);
		expect(send.reason).toMatch(/counter/i);
		// The counter rings a free line up as a free order (or as a RM0 line on
		// a paid one) and reviews it in its own dialog, so it is never blocked.
		expect(
			counterPrimaryAction({
				...base,
				mode: "counter",
				freeLine: "Bespoke Cake",
			}).disabled,
		).toBe(false);
	});

	test("an event line blocks SEND with the EVENT's reason, outranking 'freeLine'", () => {
		// A free RSVP line is also RM0, so without the ordering this would read
		// "is free — ring it up at the counter" — misnaming what the seller sees.
		const send = counterPrimaryAction({
			...base,
			mode: "send",
			freeLine: "BNI Breakfast",
			eventName: "BNI Breakfast",
		});
		expect(send.disabled).toBe(true);
		expect(send.reason).toContain('"BNI Breakfast" is an event');
		expect(send.reason).toMatch(/RSVP to the fixed date/);
		// The counter path takes walk-in RSVPs — never blocked by the event.
		expect(
			counterPrimaryAction({
				...base,
				mode: "counter",
				eventName: "BNI Breakfast",
			}).disabled,
		).toBe(false);
	});

	test("the send helper names the buyer, the window AND the payment runway", () => {
		const a = counterPrimaryAction({ ...base, mode: "send" });
		expect(a.helper).toContain("Zaki");
		expect(a.helper).toContain("15 minutes");
		// The runway is the part a seller can't infer from the chips — say it.
		expect(a.helper).toMatch(/at least 15 minutes to pay/);
		expect(a.helper).toMatch(/Nothing is charged until they pay/);
	});

	test("a nameless buyer degrades to a pronoun, never an empty gap", () => {
		const a = counterPrimaryAction({
			...base,
			mode: "send",
			buyerName: undefined,
		});
		expect(a.helper?.startsWith("They gets")).toBe(false);
		expect(a.helper).toContain("They get");
	});

	test("the counter path carries no helper line — it needs no explaining", () => {
		expect(
			counterPrimaryAction({ ...base, mode: "counter" }).helper,
		).toBeUndefined();
	});

	test("a CLOSED counter blocks both modes, outranks every cart reason, and is READ not hovered (z8r3fdudf7)", () => {
		const closed =
			"Kedaipal has paused ordering at your store, so the counter can't take orders either.";
		for (const mode of ["counter", "send"] as const) {
			// Even an empty cart: "add an item" would send them to do work
			// that can't end in an order.
			const a = counterPrimaryAction({ ...base, mode, empty: true, closed });
			expect(a.disabled).toBe(true);
			expect(a.reason).toBe(closed);
			expect(a.helper).toBe(closed);
		}
	});
});
