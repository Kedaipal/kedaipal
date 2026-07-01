import { describe, expect, test } from "vitest";
import {
	billingConfigToBlocks,
	formatDocDate,
	formatMoney,
	formatPeriodLabel,
	invoiceToSubscriptionData,
	orderToReceiptData,
	paymentMethodsToBlocks,
	subscriptionLineLabel,
} from "./document";

// 2026-06-30 00:00 in Malaysia (UTC+8) is 2026-06-29 16:00 UTC.
const JUN_30_MYT = Date.UTC(2026, 5, 29, 16, 0, 0);

describe("formatMoney", () => {
	test("formats sen as RM major units with 2dp", () => {
		expect(formatMoney(0, "MYR")).toBe("RM 0.00");
		expect(formatMoney(10400, "MYR")).toBe("RM 104.00");
		expect(formatMoney(150, "MYR")).toBe("RM 1.50");
	});
	test("groups thousands", () => {
		expect(formatMoney(123456, "MYR")).toBe("RM 1,234.56");
		expect(formatMoney(100000000, "MYR")).toBe("RM 1,000,000.00");
	});
	test("renders negatives (discount lines) with a leading minus", () => {
		expect(formatMoney(-4500, "MYR")).toBe("-RM 45.00");
	});
	test("falls back to the currency code prefix for non-MYR", () => {
		expect(formatMoney(100, "USD")).toBe("USD 1.00");
	});
});

describe("formatDocDate / formatPeriodLabel", () => {
	test("renders the MYT calendar day regardless of host timezone", () => {
		expect(formatDocDate(JUN_30_MYT)).toBe("30 Jun 2026");
		// One ms before MYT midnight is still the 29th.
		expect(formatDocDate(JUN_30_MYT - 1)).toBe("29 Jun 2026");
	});
	test("period label is month + year", () => {
		expect(formatPeriodLabel(JUN_30_MYT)).toBe("Jun 2026");
	});
});

describe("subscriptionLineLabel", () => {
	test("founding invoices get the founding plan label", () => {
		expect(
			subscriptionLineLabel({
				plan: "pro",
				billingCycle: "monthly",
				foundingDiscount: 4500,
			}),
		).toBe("Kedaipal Founding 10 Seller Plan - Monthly Subscription");
	});
	test("standard invoices name the plan + cycle", () => {
		expect(
			subscriptionLineLabel({ plan: "pro", billingCycle: "monthly" }),
		).toBe("Kedaipal Pro Plan - Monthly Subscription");
		expect(
			subscriptionLineLabel({ plan: "starter", billingCycle: "annual" }),
		).toBe("Kedaipal Starter Plan - Annual Subscription");
	});
	test("defaults to Pro/Monthly when fields are missing", () => {
		expect(subscriptionLineLabel({})).toBe(
			"Kedaipal Pro Plan - Monthly Subscription",
		);
	});
});

describe("billingConfigToBlocks", () => {
	test("returns [] for missing config", () => {
		expect(billingConfigToBlocks(null)).toEqual([]);
		expect(billingConfigToBlocks(undefined)).toEqual([]);
		expect(billingConfigToBlocks({})).toEqual([]);
	});
	test("emits a bank block and a DuitNow block", () => {
		const blocks = billingConfigToBlocks({
			bankName: "Maybank",
			bankAccountName: "Kedaipal",
			bankAccountNumber: "1234567890",
			duitnowId: "kedaipal@bank",
		});
		expect(blocks).toEqual([
			{ label: "Bank transfer", lines: ["Maybank", "Kedaipal", "1234567890"] },
			{ label: "DuitNow", lines: ["kedaipal@bank"] },
		]);
	});
	test("skips the bank block when no bank fields are set", () => {
		expect(billingConfigToBlocks({ duitnowId: "x@y" })).toEqual([
			{ label: "DuitNow", lines: ["x@y"] },
		]);
	});
});

describe("paymentMethodsToBlocks", () => {
	test("bank method lists only the populated fields", () => {
		expect(
			paymentMethodsToBlocks([
				{
					type: "bank",
					label: "Maybank",
					bankName: "Maybank",
					bankAccountNumber: "111",
				},
			]),
		).toEqual([{ label: "Maybank", lines: ["Maybank", "111"] }]);
	});
	test("a single qr method keeps its own label + scan pointer", () => {
		const blocks = paymentMethodsToBlocks([{ type: "qr", label: "DuitNow QR" }]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].label).toBe("DuitNow QR");
		expect(blocks[0].lines[0]).toMatch(/scan/i);
	});

	test("multiple qr methods collapse into ONE generic pointer block", () => {
		const blocks = paymentMethodsToBlocks([
			{ type: "qr", label: "DuitNow QR" },
			{ type: "qr", label: "Touch 'n Go" },
		]);
		// Not one-per-QR — a single "Pay by QR" line, no repeated pointer.
		expect(blocks).toHaveLength(1);
		expect(blocks[0].label).toBe("Pay by QR");
		expect(blocks[0].lines).toHaveLength(1);
	});

	test("banks stay per-method; the single QR block keeps the seller's order", () => {
		const blocks = paymentMethodsToBlocks([
			{ type: "bank", label: "Maybank", bankAccountNumber: "111" },
			{ type: "qr", label: "DuitNow QR" },
			{ type: "qr", label: "Touch 'n Go" },
			{ type: "bank", label: "CIMB", bankAccountNumber: "222" },
		]);
		// Two bank blocks + exactly one QR block, at the first QR's position.
		expect(blocks.map((b) => b.label)).toEqual(["Maybank", "Pay by QR", "CIMB"]);
	});
});

describe("orderToReceiptData", () => {
	const baseOrder = {
		shortId: "ORD-1234",
		createdAt: JUN_30_MYT,
		customer: { name: "  Aisha  ", waPhone: "+60123456789" },
		items: [{ name: "Cake", variantLabel: "1kg", quantity: 2, price: 5000 }],
		subtotal: 10000,
		total: 10000,
		currency: "MYR",
	};

	test("maps items, trims customer name, and sets the status label", () => {
		const data = orderToReceiptData({
			order: { ...baseOrder, paymentStatus: "unpaid" },
			storeName: "Sweet Co",
			paymentMethods: [],
		});
		expect(data.customerName).toBe("Aisha");
		expect(data.paymentStatusLabel).toBe("Awaiting payment");
		expect(data.paidDate).toBeUndefined();
		// Unpaid → an invoice (the document title keys off this flag).
		expect(data.paid).toBe(false);
		expect(data.items).toEqual([
			{ name: "Cake", variantLabel: "1kg", quantity: 2, unitPrice: 5000 },
		]);
	});

	test("a claimed-but-unconfirmed payment is still an invoice (not paid)", () => {
		const data = orderToReceiptData({
			order: { ...baseOrder, paymentStatus: "claimed" },
			storeName: "Sweet Co",
			paymentMethods: [],
		});
		expect(data.paid).toBe(false);
		expect(data.paymentStatusLabel).toBe("Payment claimed");
	});

	test("a received payment surfaces the paid date + label", () => {
		const data = orderToReceiptData({
			order: {
				...baseOrder,
				paymentStatus: "received",
				paymentReceivedAt: JUN_30_MYT,
			},
			storeName: "Sweet Co",
			paymentMethods: [],
		});
		expect(data.paymentStatusLabel).toBe("Paid");
		expect(data.paidDate).toBe(JUN_30_MYT);
		// Received → a receipt.
		expect(data.paid).toBe(true);
	});
});

describe("invoiceToSubscriptionData", () => {
	const invoice = {
		invoiceNumber: "INV-202606-ABCD",
		plan: "pro" as const,
		billingCycle: "monthly" as const,
		amount: 14900,
		foundingDiscount: 4500,
		total: 10400,
		currency: "MYR",
		periodStart: JUN_30_MYT,
		periodEnd: JUN_30_MYT,
		dueDate: JUN_30_MYT,
		createdAt: JUN_30_MYT,
	};

	test("maps invoice + retailer + billing config", () => {
		const data = invoiceToSubscriptionData({
			invoice,
			retailer: { storeName: "Sweet Co", waPhone: "+60123", slug: "sweet" },
			billingConfig: { bankName: "Maybank", bankAccountNumber: "111" },
		});
		expect(data.billedToName).toBe("Sweet Co");
		expect(data.billedToContact).toBe("+60123");
		expect(data.planLineLabel).toMatch(/Founding/);
		expect(data.total).toBe(10400);
		expect(data.issuerBank[0].label).toBe("Bank transfer");
	});

	test("falls back to the store URL when the retailer has no phone", () => {
		const data = invoiceToSubscriptionData({
			invoice,
			retailer: { storeName: "Sweet Co", slug: "sweet" },
			billingConfig: null,
		});
		expect(data.billedToContact).toBe("kedaipal.com/sweet");
		expect(data.issuerBank).toEqual([]);
	});
});
