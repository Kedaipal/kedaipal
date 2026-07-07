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

	test("summarizes items as 'qty x name (variant)'", () => {
		const row = orderToCsvRow(base);
		expect(row[CSV_COLUMNS.indexOf("Items")]).toBe(
			"2x Cake (1kg); 1x Brownie",
		);
	});

	test("pickup fee column prints the fee, and 0.00 when free — Subtotal + Pickup fee = Total always sums", () => {
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
		expect(row[CSV_COLUMNS.indexOf("Customer")]).toBe("");
		expect(row[CSV_COLUMNS.indexOf("Fulfilment date")]).toBe("");
		expect(row[CSV_COLUMNS.indexOf("Total")]).toBe("0.00");
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
