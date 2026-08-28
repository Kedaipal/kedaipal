import { describe, expect, test } from "vitest";
import {
	ALL_ORDER_COLUMN_KEYS,
	csvAmount,
	csvDate,
	CSV_COLUMNS,
	type CsvOrder,
	DEFAULT_ORDER_COLUMN_KEYS,
	escapeCsvField,
	ORDER_COLUMNS,
	ORDER_COLUMNS_BY_KEY,
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

// ---------------------------------------------------------------------------
// 86eyrtz74 — the export gaps Hermoolah reported, plus the arithmetic hole the
// audit turned up. Each block below pins one thing that was silently missing.
// ---------------------------------------------------------------------------

const cell = (o: CsvOrder, label: string): string =>
	orderToCsvRow(o)[CSV_COLUMNS.indexOf(label)];

const minimal: CsvOrder = {
	shortId: "ORD-9001",
	createdAt: JUN_30_MYT,
	status: "confirmed",
	customer: { name: "Aisha" },
	items: [{ name: "Cake", quantity: 1 }],
	subtotal: 10000,
	total: 10000,
	currency: "MYR",
};

describe("totals reconcile (the arithmetic hole)", () => {
	// THE bug: `computeOrderTotals` adds the mockup quote to `total` alongside
	// the fees, but there was no quote column — so on every made-to-order order
	// the exported Total did not equal the sum of the exported parts, and a
	// seller's spreadsheet silently failed to balance.
	test("Subtotal + Custom work + Pickup fee + Delivery fee === Total", () => {
		const shapes: CsvOrder[] = [
			// plain
			{ ...minimal, subtotal: 12500, total: 12500 },
			// pickup fee only
			{ ...minimal, subtotal: 12500, pickupFee: 500, total: 13000 },
			// delivery fee only
			{ ...minimal, subtotal: 12500, deliveryFee: 800, total: 13300 },
			// made-to-order: quote folded into the total (the regression case)
			{ ...minimal, subtotal: 12500, mockupQuotedAmount: 4500, total: 17000 },
			// everything at once
			{
				...minimal,
				subtotal: 12500,
				mockupQuotedAmount: 4500,
				pickupFee: 500,
				deliveryFee: 800,
				total: 18300,
			},
		];
		for (const o of shapes) {
			const sum =
				Number(cell(o, "Subtotal")) +
				Number(cell(o, "Custom work")) +
				Number(cell(o, "Pickup fee")) +
				Number(cell(o, "Delivery fee"));
			expect(sum.toFixed(2)).toBe(cell(o, "Total"));
		}
	});

	test("every money column prints 0.00, never blank, so the sum works", () => {
		for (const label of ["Custom work", "Pickup fee", "Delivery fee"]) {
			expect(cell(minimal, label)).toBe("0.00");
		}
	});
});

describe("address + pickup columns (the reported gap)", () => {
	const delivery: CsvOrder = {
		...minimal,
		deliveryMethod: "delivery",
		deliveryAddress: {
			line1: "12 Jalan Kenari 5",
			line2: "Bandar Puchong Jaya",
			city: "Puchong",
			state: "Selangor",
			postcode: "47100",
			notes: "Gate code 1234",
		},
	};
	const selfCollect: CsvOrder = {
		...minimal,
		deliveryMethod: "self_collect",
		pickupSnapshot: { label: "Setapak stall", address: "3 Jalan Genting" },
	};

	test("a delivery order exports every address part in its own column", () => {
		expect(cell(delivery, "Address line 1")).toBe("12 Jalan Kenari 5");
		expect(cell(delivery, "Address line 2")).toBe("Bandar Puchong Jaya");
		expect(cell(delivery, "City")).toBe("Puchong");
		expect(cell(delivery, "State")).toBe("Selangor");
		expect(cell(delivery, "Postcode")).toBe("47100");
		expect(cell(delivery, "Address notes")).toBe("Gate code 1234");
	});

	test("a self-collect order exports the outlet, and blanks the address", () => {
		expect(cell(selfCollect, "Pickup location")).toBe("Setapak stall");
		expect(cell(selfCollect, "Pickup address")).toBe("3 Jalan Genting");
		for (const label of ["Address line 1", "City", "State", "Postcode"]) {
			expect(cell(selfCollect, label)).toBe("");
		}
	});

	test("a delivery order blanks the pickup columns", () => {
		expect(cell(delivery, "Pickup location")).toBe("");
		expect(cell(delivery, "Pickup address")).toBe("");
	});

	test("buyer-typed address lines are still injection-escaped", () => {
		const hostile: CsvOrder = {
			...delivery,
			deliveryAddress: { ...delivery.deliveryAddress!, line1: "=HYPERLINK(1)" },
		};
		expect(ordersToCsv([hostile])).toContain("'=HYPERLINK(1)");
	});
});

describe("categories column", () => {
	test("comma-separated, deduped across lines, sorted", () => {
		const o: CsvOrder = { ...minimal, categories: ["Pastry", "Kuih"] };
		expect(cell({ ...o, categories: ["Kuih", "Pastry"] }, "Categories (current)")).toBe(
			"Kuih, Pastry",
		);
	});
	test("absent categories read blank, never 'undefined'", () => {
		expect(cell(minimal, "Categories (current)")).toBe("");
	});
	test("the header names the drift — it is a live lookup, not a snapshot", () => {
		expect(CSV_COLUMNS).toContain("Categories (current)");
	});
});

describe("the rest of the missing fields", () => {
	test("payment reference and paid-on date export", () => {
		const o: CsvOrder = {
			...minimal,
			paymentReference: "MBB-88213",
			paymentReceivedAt: JUN_30_MYT,
		};
		expect(cell(o, "Payment reference")).toBe("MBB-88213");
		expect(cell(o, "Paid on")).toBe("2026-06-30");
	});
	test("fulfilment time, order type and origin export", () => {
		const o: CsvOrder = {
			...minimal,
			fulfilmentTimeMinutes: 930,
			source: "counter",
			attributionSource: "tiktok",
		};
		expect(cell(o, "Fulfilment time")).toBe("3:30 PM");
		expect(cell(o, "Order type")).toBe("counter");
		expect(cell(o, "Came from")).toBe("TikTok");
	});
	test("a legacy order with no stamped source reads as storefront", () => {
		expect(cell(minimal, "Order type")).toBe("storefront");
	});
	test("flags read Yes / blank, never 'false'", () => {
		expect(cell({ ...minimal, deliveryFeePending: true }, "Fee pending")).toBe("Yes");
		expect(cell(minimal, "Fee pending")).toBe("");
		expect(cell({ ...minimal, pinnedAt: 1 }, "Pinned")).toBe("Yes");
		expect(cell(minimal, "Pinned")).toBe("");
	});
	test("cancelled reason exports", () => {
		expect(cell({ ...minimal, cancelledReason: "Buyer changed mind" }, "Cancelled reason")).toBe(
			"Buyer changed mind",
		);
	});
});

describe("the money run stays adjacent", () => {
	// The whole point of adding Custom work is that a human can eyeball the
	// arithmetic left-to-right. If a later column is inserted between these,
	// that stops being true — so the adjacency is pinned, not incidental.
	test("Subtotal · Custom work · Pickup fee · Delivery fee · Total are consecutive", () => {
		const start = CSV_COLUMNS.indexOf("Subtotal");
		expect(CSV_COLUMNS.slice(start, start + 5)).toEqual([
			"Subtotal",
			"Custom work",
			"Pickup fee",
			"Delivery fee",
			"Total",
		]);
	});
});

describe("column subsets (the table's 'export visible columns')", () => {
	test("narrows to the requested keys", () => {
		const csv = ordersToCsv([minimal], ["shortId", "total"]);
		const [header, row] = csv.split("\r\n");
		expect(header).toBe("Order ID,Total");
		expect(row).toBe("ORD-9001,100.00");
	});

	test("emits registry order regardless of the order asked for", () => {
		const csv = ordersToCsv([minimal], ["total", "shortId"]);
		expect(csv.split("\r\n")[0]).toBe("Order ID,Total");
	});

	test("an unknown key is dropped, not fatal — a stale client still exports", () => {
		const csv = ordersToCsv([minimal], ["shortId", "columnThatWasRenamed"]);
		expect(csv.split("\r\n")[0]).toBe("Order ID");
	});

	test("no recognised keys at all falls back to every column", () => {
		expect(ordersToCsv([minimal], ["nonsense"]).split("\r\n")[0]).toBe(
			CSV_COLUMNS.join(","),
		);
	});

	test("an omitted or empty key list exports everything (the cards view)", () => {
		expect(ordersToCsv([minimal], []).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
		expect(ordersToCsv([minimal]).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
	});
});

describe("the registry never leaks a secret", () => {
	// `orders.trackingToken` is the capability that unlocks the buyer's no-auth
	// tracking page. An export gets emailed to bookkeepers, so the token must
	// never be a column — this fails loudly if someone adds one.
	test("no column is derived from the tracking token", () => {
		const suspicious = ORDER_COLUMNS.filter(
			(c) => /token|secret|_id$/i.test(c.key) || /token/i.test(c.label),
		);
		expect(suspicious).toEqual([]);
	});

	test("a token on the source object cannot reach any cell", () => {
		const withToken = {
			...minimal,
			trackingToken: "tok_supersecret",
		} as CsvOrder & { trackingToken: string };
		expect(ordersToCsv([withToken])).not.toContain("tok_supersecret");
	});
});

describe("default column set", () => {
	test("is a real subset — the table opens readable, not with 36 columns", () => {
		expect(DEFAULT_ORDER_COLUMN_KEYS.length).toBeGreaterThan(0);
		expect(DEFAULT_ORDER_COLUMN_KEYS.length).toBeLessThan(
			ALL_ORDER_COLUMN_KEYS.length,
		);
	});
	test("every default key is a real column", () => {
		for (const k of DEFAULT_ORDER_COLUMN_KEYS) {
			expect(ORDER_COLUMNS_BY_KEY.has(k)).toBe(true);
		}
	});
	test("column keys are unique", () => {
		expect(new Set(ALL_ORDER_COLUMN_KEYS).size).toBe(ALL_ORDER_COLUMN_KEYS.length);
	});
	test("column labels are unique — the CSV header must not repeat a name", () => {
		expect(new Set(CSV_COLUMNS).size).toBe(CSV_COLUMNS.length);
	});
});
