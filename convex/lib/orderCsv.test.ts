import { describe, expect, test } from "vitest";
import {
	csvAmount,
	csvDate,
	CSV_COLUMNS,
	escapeCsvField,
	orderToCsvRow,
	ordersToCsv,
} from "./orderCsv";

const JUN_30_MYT = Date.UTC(2026, 5, 29, 16, 0, 0);

describe("csvDate / csvAmount", () => {
	test("date is the sortable MYT calendar day", () => {
		expect(csvDate(JUN_30_MYT)).toBe("2026-06-30");
		expect(csvDate(undefined)).toBe("");
	});
	test("amount is plain major-units, no currency prefix", () => {
		expect(csvAmount(10400)).toBe("104.00");
		expect(csvAmount(0)).toBe("0.00");
	});
});

describe("escapeCsvField", () => {
	test("leaves a plain value untouched", () => {
		expect(escapeCsvField("Aisha")).toBe("Aisha");
	});
	test("quotes values containing comma, quote, or newline", () => {
		expect(escapeCsvField("a,b")).toBe('"a,b"');
		expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
		expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
	});
	test("defuses formula injection by prefixing a quote", () => {
		expect(escapeCsvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
		expect(escapeCsvField("+1")).toBe("'+1");
		expect(escapeCsvField("-1")).toBe("'-1");
		expect(escapeCsvField("@cmd")).toBe("'@cmd");
	});
	test("a value that is both a formula AND has a comma is escaped both ways", () => {
		expect(escapeCsvField("=A1,B1")).toBe(`"'=A1,B1"`);
	});
});

describe("orderToCsvRow", () => {
	const base = {
		shortId: "ORD-1234",
		createdAt: JUN_30_MYT,
		fulfilmentDate: JUN_30_MYT,
		status: "confirmed",
		paymentStatus: "received",
		paymentMethod: "duitnow",
		deliveryMethod: "delivery",
		customer: { name: "Aisha", waPhone: "+60123456789" },
		items: [
			{ name: "Cake", variantLabel: "1kg", quantity: 2 },
			{ name: "Brownie", quantity: 1 },
		],
		subtotal: 12500,
		total: 12500,
		currency: "MYR",
		customerNote: "No nuts",
	};

	test("a collection order's Fulfilment cell says so; the header never moves (86eyg0n8e)", () => {
		const collection = orderToCsvRow({
			...base,
			deliveryDirection: "collection",
		});
		expect(collection[CSV_COLUMNS.indexOf("Fulfilment")]).toBe("collection");
		// The column set is fixed — one export can hold both directions, so a
		// seller's bookkeeping template must keep matching on names.
		expect(CSV_COLUMNS).toContain("Delivery fee");
		expect(CSV_COLUMNS).not.toContain("Collection fee");
		expect(CSV_COLUMNS).toContain("Security deposit");
		// Standard + pickup rows are untouched.
		expect(orderToCsvRow(base)[CSV_COLUMNS.indexOf("Fulfilment")]).toBe(
			"delivery",
		);
		expect(
			orderToCsvRow({ ...base, deliveryMethod: "self_collect" })[
				CSV_COLUMNS.indexOf("Fulfilment")
			],
		).toBe("self_collect");
	});

	test("summarizes items as 'qty x name (variant)'", () => {
		const row = orderToCsvRow(base);
		expect(row[CSV_COLUMNS.indexOf("Items")]).toBe(
			"2x Cake (1kg); 1x Brownie",
		);
	});

	test("pickup fee column prints the fee, and 0.00 when free — Subtotal + Pickup fee = Total sums for a standard order", () => {
		const withFee = orderToCsvRow({
			...base,
			deliveryMethod: "self_collect",
			pickupFee: 500,
			total: 13000,
		});
		expect(withFee[CSV_COLUMNS.indexOf("Pickup fee")]).toBe("5.00");
		expect(withFee[CSV_COLUMNS.indexOf("Subtotal")]).toBe("125.00");
		expect(withFee[CSV_COLUMNS.indexOf("Total")]).toBe("130.00");
		// Free order (fee unset) → explicit 0.00, not blank.
		expect(orderToCsvRow(base)[CSV_COLUMNS.indexOf("Pickup fee")]).toBe(
			"0.00",
		);
	});

	test("delivery fee column prints the fee, and 0.00 when free — the totals identity sums", () => {
		const withFee = orderToCsvRow({
			...base,
			deliveryMethod: "delivery",
			deliveryFee: 800,
			total: 13300,
		});
		expect(withFee[CSV_COLUMNS.indexOf("Delivery fee")]).toBe("8.00");
		expect(withFee[CSV_COLUMNS.indexOf("Subtotal")]).toBe("125.00");
		expect(withFee[CSV_COLUMNS.indexOf("Total")]).toBe("133.00");
		// Free delivery (fee unset) → explicit 0.00 so Subtotal + fees = Total.
		expect(orderToCsvRow(base)[CSV_COLUMNS.indexOf("Delivery fee")]).toBe(
			"0.00",
		);
	});

	test("courier + tracking no columns print when attached, blank otherwise (86eyehvk4)", () => {
		const shipped = orderToCsvRow({
			...base,
			status: "shipped",
			courierName: "J&T Express",
			trackingNo: "630002864925",
		});
		expect(shipped[CSV_COLUMNS.indexOf("Courier")]).toBe("J&T Express");
		expect(shipped[CSV_COLUMNS.indexOf("Tracking no")]).toBe("630002864925");
		// Most orders never get one — blank, not "0.00"-style filler.
		const plain = orderToCsvRow(base);
		expect(plain[CSV_COLUMNS.indexOf("Courier")]).toBe("");
		expect(plain[CSV_COLUMNS.indexOf("Tracking no")]).toBe("");
	});

	test("fills sensible defaults for missing fields", () => {
		const row = orderToCsvRow({
			shortId: "ORD-9",
			createdAt: JUN_30_MYT,
			status: "pending",
			customer: {},
			items: [],
			subtotal: 0,
			total: 0,
			currency: "MYR",
		});
		expect(row[CSV_COLUMNS.indexOf("Payment")]).toBe("unpaid");
		// No name and no phone = an anonymous walk-in (86ey8vqp6) → labelled, not blank.
		expect(row[CSV_COLUMNS.indexOf("Customer")]).toBe("Walk-in customer");
		expect(row[CSV_COLUMNS.indexOf("Fulfilment date")]).toBe("");
		expect(row[CSV_COLUMNS.indexOf("Total")]).toBe("0.00");
	});
});

describe("orderToCsvRow — security deposit (86eyn4kee)", () => {
	test("prints the frozen deposit and 0.00 when absent, so columns subtract cleanly", () => {
		const booking = orderToCsvRow({
			shortId: "ORD-9001",
			createdAt: JUN_30_MYT,
			status: "confirmed",
			deliveryMethod: "booking",
			customer: { name: "Guest", waPhone: "+60123456789" },
			items: [{ name: "Riverside Plot", quantity: 2 }],
			subtotal: 16_000,
			securityDeposit: 10_000,
			total: 26_000,
			currency: "MYR",
		});
		expect(booking[CSV_COLUMNS.indexOf("Security deposit")]).toBe("100.00");
		const plain = orderToCsvRow({
			shortId: "ORD-9002",
			createdAt: JUN_30_MYT,
			status: "confirmed",
			deliveryMethod: "delivery",
			customer: { name: "Aisha", waPhone: "+60123456789" },
			items: [{ name: "Cake", quantity: 1 }],
			subtotal: 5_000,
			total: 5_000,
			currency: "MYR",
		});
		expect(plain[CSV_COLUMNS.indexOf("Security deposit")]).toBe("0.00");
	});
});

describe("ordersToCsv", () => {
	test("emits a header row plus one row per order with matching arity", () => {
		const csv = ordersToCsv([
			{
				shortId: "ORD-1",
				createdAt: JUN_30_MYT,
				status: "pending",
				customer: { name: "A" },
				items: [{ name: "X", quantity: 1 }],
				subtotal: 100,
				total: 100,
				currency: "MYR",
			},
		]);
		const lines = csv.split("\r\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(CSV_COLUMNS.join(","));
		expect(lines[1].split(",").length).toBe(CSV_COLUMNS.length);
	});

	test("an empty order list still yields the header", () => {
		expect(ordersToCsv([])).toBe(CSV_COLUMNS.join(","));
	});
});
