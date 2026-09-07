import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";
import type { AwbLabelData } from "./awb";
import type { OrderReceiptData, SubscriptionInvoiceData } from "./document";
import {
	__wrapForTest as wrapForTest,
	buildAwbPdf,
	buildOrderReceiptPdf,
	buildSubscriptionInvoicePdf,
} from "./render";

/** A PDF file always starts with the "%PDF" magic bytes. */
function isPdf(bytes: Uint8Array): boolean {
	return (
		bytes.length > 4 &&
		String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF"
	);
}

const receipt: OrderReceiptData = {
	storeName: "Sweet Co",
	sellerLines: [],
	orderShortId: "ORD-1234",
	orderDate: Date.UTC(2026, 5, 29, 16, 0, 0),
	paid: true,
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

describe("buildOrderReceiptPdf — seller identity block (z8r3fdcrzj)", () => {
	test("renders with legal-identity From lines", async () => {
		const bytes = await buildOrderReceiptPdf({
			...receipt,
			sellerLines: [
				"Hermoolah Enterprise",
				"SSM no. 202403123456",
				"12, Jalan Contoh 3/4",
				"40000 Shah Alam, Selangor",
				"billing@hermoolah.com",
			],
		});
		expect(isPdf(bytes)).toBe(true);
	});
});

describe("buildSubscriptionInvoicePdf — receipt face (z8r3fdcrzj)", () => {
	test("renders the paid face (no payment card, Amount paid bar)", async () => {
		const bytes = await buildSubscriptionInvoicePdf({
			...invoice,
			issuerBank: [],
			paid: { paidAt: Date.UTC(2026, 8, 6), methodLabel: "DuitNow" },
		});
		expect(isPdf(bytes)).toBe(true);
	});
});

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

	test("renders an unpaid order (invoice) with the how-to-pay block", async () => {
		const bytes = await buildOrderReceiptPdf({
			...receipt,
			paid: false,
			paidDate: undefined,
			paymentStatusLabel: "Awaiting payment",
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

	test("renders a cross-border SGD invoice (no payment card, S$ amounts)", async () => {
		const bytes = await buildSubscriptionInvoicePdf({
			...invoice,
			planLineLabel: "Kedaipal Pro Plan - Monthly Subscription",
			foundingDiscount: undefined,
			amount: 5900,
			total: 5900,
			currency: "SGD",
			issuerBank: [],
		});
		expect(isPdf(bytes)).toBe(true);
	});
});

// --- C: despatch label -----------------------------------------------------
//
// The layout's own arithmetic is the risk here (a fixed-size sheet that must
// never overflow), so these render the extremes: everything present, nothing
// present, and the values most likely to blow a fixed box.

const labelBase: AwbLabelData = {
	storeName: "Wagyu Walid Frozen Supplies",
	sender: {
		heading: "From",
		name: "Wagyu Walid",
		phone: "+60 123456789",
		lines: ["12, Jalan Kenanga 3, Taman Sri Muda, 40400 Shah Alam, Selangor"],
	},
	recipient: {
		heading: "Deliver to",
		name: "Nur Aisyah binti Rahman",
		phone: "+60 11-5939 9791",
		lines: [
			"B-12-3, Residensi Suria Apartment Block B",
			"Jalan Puchong Perdana 5/2",
			"47100 Puchong",
			"Selangor",
		],
		notes: "Gate code 1234, call on arrival",
	},
	orderShortId: "ORD-8FK2",
	orderDate: Date.UTC(2026, 7, 20),
	fulfilmentLabel: "Deliver on Fri, 21 Aug 2026 · 3:30 PM",
	courierName: "J&T Express",
	trackingNo: "630123456789",
	storeUrl: "https://kedaipal.com/wagyu-walid?src=awb",
	payment: { kind: "cod", amount: 12800 },
	currency: "MYR",
	weightLabel: "1.20 kg",
	items: [
		{ name: "Wagyu Ribeye A5 (500g)", quantity: 2 },
		{ name: "Beef Short Rib", quantity: 1 },
	],
	totalUnits: 3,
	note: "Please deliver after 5pm, I'm at work",
	footerText: "Returns: 012-345 6789 · Thank you!",
};

/** Page count + size, read back out of the produced document. */
async function pages(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map((p) => ({
		width: Math.round(p.getWidth()),
		height: Math.round(p.getHeight()),
	}));
}

describe("buildAwbPdf", () => {
	test("A6 gives one label per page, at label size", async () => {
		const bytes = await buildAwbPdf([labelBase, labelBase], {
			paperSize: "a6",
		});
		expect(isPdf(bytes)).toBe(true);
		// 105 × 148 mm in points.
		expect(await pages(bytes)).toEqual([
			{ width: 298, height: 420 },
			{ width: 298, height: 420 },
		]);
	});

	test("A4 4-up imposes four labels per sheet", async () => {
		const five = Array.from({ length: 5 }, () => labelBase);
		const sheets = await pages(await buildAwbPdf(five, { paperSize: "a4-4up" }));
		expect(sheets).toHaveLength(2);
		expect(sheets[0]).toEqual({ width: 595, height: 842 });
	});

	test("renders with everything optional stripped away", async () => {
		const bytes = await buildAwbPdf(
			[
				{
					storeName: "Sue Chef Kitchen",
					sender: { heading: "From", name: "Sue Chef Kitchen", lines: [] },
					recipient: {
						heading: "Deliver to",
						name: "Tan Wei Ming",
						lines: ["Blk 123 Ang Mo Kio Ave 4", "560123 Singapore"],
					},
					orderShortId: "ORD-A1B2",
					orderDate: Date.UTC(2026, 7, 20),
					currency: "SGD",
					totalUnits: 1,
				},
			],
			{ paperSize: "a6" },
		);
		expect(isPdf(bytes)).toBe(true);
	});

	test("an order with no courier or tracking number still prints", async () => {
		const bytes = await buildAwbPdf(
			[{ ...labelBase, courierName: undefined, trackingNo: undefined }],
			{ paperSize: "a6" },
		);
		expect(isPdf(bytes)).toBe(true);
	});

	test("a tracking number too long to scan degrades to text, not bars", async () => {
		const bytes = await buildAwbPdf(
			[{ ...labelBase, trackingNo: "X".repeat(60) }],
			{ paperSize: "a6" },
		);
		expect(isPdf(bytes)).toBe(true);
	});

	test("absurdly long text can't break the sheet", async () => {
		const bytes = await buildAwbPdf(
			[
				{
					...labelBase,
					storeName: "A".repeat(200),
					recipient: {
						...labelBase.recipient,
						name: "B".repeat(150),
						lines: Array.from({ length: 12 }, (_, i) => `Address line ${i} `.repeat(8)),
						notes: "C".repeat(300),
					},
					note: "D".repeat(400),
					footerText: "E".repeat(300),
					items: Array.from({ length: 40 }, (_, i) => ({
						name: `Item number ${i} with a very long descriptive name`,
						quantity: i + 1,
					})),
				},
			],
			{ paperSize: "a6" },
		);
		expect(await pages(bytes)).toEqual([{ width: 298, height: 420 }]);
	});

	test("non-Latin-1 text degrades instead of throwing (the receipt rule)", async () => {
		const bytes = await buildAwbPdf(
			[
				{
					...labelBase,
					storeName: "🍰 甜品店 Sweet",
					recipient: { ...labelBase.recipient, name: "陈伟明" },
				},
			],
			{ paperSize: "a6" },
		);
		expect(isPdf(bytes)).toBe(true);
	});

	// The warning is an EXTRA line in a block sized to fit without one, so the
	// arithmetic is the risk: it must come out of the address budget rather than
	// pushing the block down over the payment strip. Both parties carrying one,
	// on the smaller sheet, with a long address still to place, is the worst
	// case the layout can be handed.
	test("an address warning stays inside the block it belongs to", async () => {
		const bytes = await buildAwbPdf(
			[
				{
					...labelBase,
					sender: {
						...labelBase.sender,
						warning: "! Return address incomplete - check Settings",
					},
					recipient: {
						...labelBase.recipient,
						warning: "! Address incomplete - check the order",
					},
				},
			],
			{ paperSize: "a6" },
		);
		expect(await pages(bytes)).toEqual([{ width: 298, height: 420 }]);
	});

	// PR #208 review: `wrap` could only break at spaces, so an unbroken token
	// wider than the label (a pasted plus-code, a URL, a run-together address —
	// line1 allows 120 chars with no per-token limit) was emitted whole and
	// pdf-lib drew it past the edge: on a 4-up sheet, across the cut line and
	// onto the NEXT buyer's label. Measured rather than eyeballed — the assert
	// is that every drawn glyph stays inside its own quadrant.
	test("an unbroken 120-char address line stays inside its own quadrant", async () => {
		const monster = "X".repeat(120);
		const bytes = await buildAwbPdf(
			[
				{
					...labelBase,
					recipient: {
						...labelBase.recipient,
						lines: [monster, "47100 Puchong"],
						notes: "N".repeat(90),
					},
					note: "D".repeat(120),
					footerText: "E".repeat(120),
				},
				labelBase,
				labelBase,
				labelBase,
			],
			{ paperSize: "a4-4up" },
		);
		expect(await pages(bytes)).toHaveLength(1);

		// The top-left quadrant's right edge, in points: an A4 page is 595.28 wide,
		// so each quadrant is half that. Nothing the first label draws may cross it.
		const doc = await PDFDocument.load(bytes);
		const page = doc.getPages()[0];
		const quadrantRight = page.getWidth() / 2;
		const helv = await doc.embedFont(StandardFonts.Helvetica);
		// Re-measure the widest thing the label could have drawn: if `wrap` still
		// returned the token whole, this width alone would blow the quadrant.
		expect(helv.widthOfTextAtSize(monster, 10)).toBeGreaterThan(quadrantRight);
		// …and after the fix, every wrapped chunk fits the label's inner width.
		for (const line of wrapForTest(helv, monster, 10, 240)) {
			expect(helv.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(240);
		}
	});

	test("an empty batch is still a valid, explanatory PDF", async () => {
		const bytes = await buildAwbPdf([], { paperSize: "a4-4up" });
		expect(isPdf(bytes)).toBe(true);
		expect(await pages(bytes)).toHaveLength(1);
	});

	test("a logo that pdf-lib can't embed is skipped, not fatal", async () => {
		const svg = new TextEncoder().encode("<svg xmlns='...'></svg>");
		const bytes = await buildAwbPdf([labelBase], {
			paperSize: "a6",
			logo: svg,
		});
		expect(isPdf(bytes)).toBe(true);
	});

	test("a full 100-label batch stays a sane file size", async () => {
		const many = Array.from({ length: 100 }, (_, i) => ({
			...labelBase,
			orderShortId: `ORD-${1000 + i}`,
			storeUrl: `https://kedaipal.com/wagyu-walid-${i % 10}?src=awb`,
		}));
		const bytes = await buildAwbPdf(many, { paperSize: "a4-4up" });
		expect(await pages(bytes)).toHaveLength(25);
		// Merged module runs keep the QR/barcode geometry compact; a blow-up here
		// would mean a print job too big to hand back from an action.
		expect(bytes.length).toBeLessThan(2_000_000);
	});
});
