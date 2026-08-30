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
		unpriced: false,
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

	test("an unpriced line blocks SEND only — a claim freezes prices at send", () => {
		const send = counterPrimaryAction({
			...base,
			mode: "send",
			unpriced: true,
		});
		expect(send.disabled).toBe(true);
		expect(send.reason).toMatch(/price for every custom item/i);
		// The counter path resolves price at create and reviews it in its own
		// dialog, so it must not be blocked here.
		expect(
			counterPrimaryAction({ ...base, mode: "counter", unpriced: true })
				.disabled,
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
});
