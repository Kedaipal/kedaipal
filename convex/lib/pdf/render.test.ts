import { describe, expect, test } from "vitest";
import type { OrderReceiptData, SubscriptionInvoiceData } from "./document";
import { buildOrderReceiptPdf, buildSubscriptionInvoicePdf } from "./render";

/** A PDF file always starts with the "%PDF" magic bytes. */
function isPdf(bytes: Uint8Array): boolean {
	return (
		bytes.length > 4 &&
		String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF"
	);
}

const receipt: OrderReceiptData = {
	storeName: "Sweet Co",
	orderShortId: "ORD-1234",
	orderDate: Date.UTC(2026, 5, 29, 16, 0, 0),
	paymentStatusLabel: "Paid",
	paidDate: Date.UTC(2026, 5, 29, 16, 0, 0),
	customerName: "Aisha",
	customerPhone: "+60123456789",
	items: [
		{ name: "Chocolate Cake", variantLabel: "1kg", quantity: 2, unitPrice: 5000 },
		{ name: "Brownie box", quantity: 1, unitPrice: 2500 },
	],
	subtotal: 12500,
	total: 12500,
	currency: "MYR",
	fulfilmentDate: Date.UTC(2026, 6, 1, 16, 0, 0),
	customerNote: "No nuts please",
	paymentBlocks: [
		{ label: "Maybank", lines: ["Maybank", "Sweet Co", "1234567890"] },
	],
};

const invoice: SubscriptionInvoiceData = {
	invoiceNumber: "INV-202606-ABCD",
	billedToName: "Sweet Co",
	billedToContact: "+60123",
	issuedAt: Date.UTC(2026, 5, 29, 16, 0, 0),
	dueDate: Date.UTC(2026, 6, 13, 16, 0, 0),
	periodStart: Date.UTC(2026, 5, 29, 16, 0, 0),
	periodEnd: Date.UTC(2026, 6, 29, 16, 0, 0),
	planLineLabel: "Kedaipal Founding 10 Seller Plan - Monthly Subscription",
	amount: 14900,
	foundingDiscount: 4500,
	total: 10400,
	currency: "MYR",
	issuerBank: [{ label: "Bank transfer", lines: ["Maybank", "1234567890"] }],
};

describe("buildOrderReceiptPdf", () => {
	test("produces non-empty PDF bytes", async () => {
		const bytes = await buildOrderReceiptPdf(receipt);
		expect(isPdf(bytes)).toBe(true);
		expect(bytes.length).toBeGreaterThan(500);
	});

	test("renders with empty/missing optional fields", async () => {
		const bytes = await buildOrderReceiptPdf({
			...receipt,
			customerName: undefined,
			customerPhone: undefined,
			paidDate: undefined,
			fulfilmentDate: undefined,
			customerNote: undefined,
			paymentBlocks: [],
		});
		expect(isPdf(bytes)).toBe(true);
	});

	test("does not throw on non-Latin store names (emoji / CJK)", async () => {
		const bytes = await buildOrderReceiptPdf({
			...receipt,
			storeName: "🍰 甜品店 Sweet",
			items: [{ name: "蛋糕 🎂", quantity: 1, unitPrice: 9900 }],
		});
		expect(isPdf(bytes)).toBe(true);
	});
});

describe("buildSubscriptionInvoicePdf", () => {
	test("produces non-empty PDF bytes", async () => {
		const bytes = await buildSubscriptionInvoicePdf(invoice);
		expect(isPdf(bytes)).toBe(true);
		expect(bytes.length).toBeGreaterThan(500);
	});

	test("renders a non-founding invoice with no discount line", async () => {
		const bytes = await buildSubscriptionInvoicePdf({
			...invoice,
			planLineLabel: "Kedaipal Pro Plan - Monthly Subscription",
			foundingDiscount: undefined,
			amount: 10400,
			total: 10400,
			issuerBank: [],
		});
		expect(isPdf(bytes)).toBe(true);
	});
});
