import { describe, expect, test } from "vitest";
import { COUNTRIES } from "./country";
import {
	COUNTRY_PAYMENT_METHODS,
	isOrderPaymentMethod,
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
	paymentMethodLabel,
} from "./paymentMethod";

/**
 * The settled-method tag (SG-lite widened it, 86eyph341). Two separate things
 * are pinned here because conflating them is exactly the bug this ticket fixed:
 * the ENUM is what may be STAMPED on an order (the HitPay gateway stamps rails
 * the seller's picker never offers), while COUNTRY_PAYMENT_METHODS is only what
 * the seller is OFFERED to hand-pick.
 */

/**
 * The exact list every Malaysian store saw before SG-lite, frozen by hand.
 * If this test goes red, an MY seller's "Mark payment received" dialog and
 * counter "Paid now" picker just changed — which this ticket promised they
 * would not. Derive nothing here: a frozen literal is the whole point.
 */
const MY_METHODS_BEFORE_SG_LITE = [
	"cash",
	"duitnow",
	"tng",
	"bank_transfer",
	"fpx",
	"card",
	"other",
] as const;

describe("ORDER_PAYMENT_METHODS (what may be stamped)", () => {
	test("carries the SG rails as well as the MY ones", () => {
		for (const m of ["paynow", "paylah", "nets", "grabpay"]) {
			expect(isOrderPaymentMethod(m)).toBe(true);
		}
		// Every pre-SG value still stamps — orders in the wild hold these.
		for (const m of MY_METHODS_BEFORE_SG_LITE) {
			expect(isOrderPaymentMethod(m)).toBe(true);
		}
		expect(isOrderPaymentMethod("bitcoin")).toBe(false);
	});

	test("is a set — no duplicates", () => {
		expect(new Set(ORDER_PAYMENT_METHODS).size).toBe(
			ORDER_PAYMENT_METHODS.length,
		);
	});

	test("every member has a non-empty label", () => {
		for (const m of ORDER_PAYMENT_METHODS) {
			expect(PAYMENT_METHOD_LABELS[m]?.trim().length).toBeGreaterThan(0);
		}
		expect(PAYMENT_METHOD_LABELS.paynow).toBe("PayNow");
		expect(PAYMENT_METHOD_LABELS.paylah).toBe("PayLah!");
		expect(PAYMENT_METHOD_LABELS.nets).toBe("NETS");
		expect(PAYMENT_METHOD_LABELS.grabpay).toBe("GrabPay");
	});

	test("labels are unique, so two chips can never read the same", () => {
		const labels = ORDER_PAYMENT_METHODS.map((m) => PAYMENT_METHOD_LABELS[m]);
		expect(new Set(labels).size).toBe(labels.length);
	});

	test("labelling is country-blind — a gateway-stamped rail still renders", () => {
		// The regression this guards: MY's picker doesn't offer GrabPay, but
		// HitPay MY can settle one. Gating the LABEL on the country list would
		// print the raw code on that seller's order page.
		expect(paymentMethodLabel("grabpay")).toBe("GrabPay");
		expect(paymentMethodLabel("paynow")).toBe("PayNow");
		// Unknown/legacy values pass through rather than blanking.
		expect(paymentMethodLabel("some_future_wallet")).toBe("some_future_wallet");
		expect(paymentMethodLabel(undefined)).toBeUndefined();
	});
});

describe("COUNTRY_PAYMENT_METHODS (what the seller is offered)", () => {
	test("MY is byte-identical to the pre-SG-lite list, in the same order", () => {
		expect(COUNTRY_PAYMENT_METHODS.MY).toEqual([...MY_METHODS_BEFORE_SG_LITE]);
	});

	test("SG leads with PayNow and drops every MY-only rail", () => {
		expect(COUNTRY_PAYMENT_METHODS.SG).toEqual([
			"cash",
			"paynow",
			"paylah",
			"nets",
			"grabpay",
			"bank_transfer",
			"card",
			"other",
		]);
		// The bug report: a PayNow-paid SG order had to be filed under "Other".
		for (const my of ["duitnow", "tng", "fpx"]) {
			expect(COUNTRY_PAYMENT_METHODS.SG).not.toContain(my);
		}
	});

	test("every country has a list of real, unique, labelled enum members", () => {
		for (const country of COUNTRIES) {
			const list = COUNTRY_PAYMENT_METHODS[country];
			expect(list.length).toBeGreaterThan(0);
			expect(new Set(list).size).toBe(list.length);
			for (const m of list) {
				expect(isOrderPaymentMethod(m)).toBe(true);
				expect(PAYMENT_METHOD_LABELS[m]?.trim().length).toBeGreaterThan(0);
			}
		}
	});

	test("every country offers cash first and 'other' as the escape hatch", () => {
		// Cash is the counter default (the picker seeds from list[0]) and
		// "other" must always exist or an odd rail has nowhere to go.
		for (const country of COUNTRIES) {
			expect(COUNTRY_PAYMENT_METHODS[country][0]).toBe("cash");
			expect(COUNTRY_PAYMENT_METHODS[country]).toContain("other");
		}
	});

	test("the offered lists are a strict subset of the enum, never the reverse", () => {
		// Deliberate: `grabpay` is stampable in MY but not offered there. If this
		// flips, someone has started gating stamps on the picker.
		const offered = new Set<OrderPaymentMethod>(
			COUNTRIES.flatMap((c) => [...COUNTRY_PAYMENT_METHODS[c]]),
		);
		for (const m of offered) {
			expect(ORDER_PAYMENT_METHODS).toContain(m);
		}
		expect(offered.has("grabpay")).toBe(true);
		expect(COUNTRY_PAYMENT_METHODS.MY).not.toContain("grabpay");
	});
});
