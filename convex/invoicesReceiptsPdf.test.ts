/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_admin_pdf";
const USER_A = "user_pdf_a";
const USER_B = "user_pdf_b";
let prevAdminEnv: string | undefined;

beforeAll(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterAll(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const isPdf = (buf: ArrayBuffer): boolean => {
	const b = new Uint8Array(buf);
	return String.fromCharCode(b[0], b[1], b[2], b[3]) === "%PDF";
};

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${userId}`,
		slug: `store-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedOrder(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
) {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: "Chocolate Cake",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price: 5000, onHand: 10 }],
	});
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 2 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Aisha", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar",
			city: "PJ",
			state: "Selangor",
			postcode: "47301",
		},
	});
	return shortId;
}

async function tokenFor(t: ReturnType<typeof setup>, shortId: string) {
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		return o?.trackingToken ?? "__none__";
	});
}

describe("orders.generateReceiptPdf (UC A)", () => {
	test("buyer (token) gets a PDF named after the order", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		const shortId = await seedOrder(t, USER_A, r._id);
		const token = await tokenFor(t, shortId);

		const res = await t.action(api.orders.generateReceiptPdf, { token });
		expect(res).not.toBeNull();
		expect(res?.filename).toBe(`Receipt-${shortId}.pdf`);
		expect(res && isPdf(res.pdf)).toBe(true);
	});

	test("owning seller (shortId) gets a PDF", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		const shortId = await seedOrder(t, USER_A, r._id);
		const res = await t
			.withIdentity({ subject: USER_A })
			.action(api.orders.generateReceiptPdf, { shortId });
		expect(res && isPdf(res.pdf)).toBe(true);
	});

	test("a different signed-in user cannot fetch by shortId", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const shortId = await seedOrder(t, USER_A, r._id);
		await expect(
			t
				.withIdentity({ subject: USER_B })
				.action(api.orders.generateReceiptPdf, { shortId }),
		).rejects.toThrow(/forbidden/i);
	});

	test("unknown order returns null", async () => {
		const t = setup();
		const res = await t.action(api.orders.generateReceiptPdf, {
			token: "__none__",
		});
		expect(res).toBeNull();
	});
});

describe("orders.exportOrders (CSV)", () => {
	test("honours the bucket filter", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const first = await seedOrder(t, USER_A, r._id);
		await seedOrder(t, USER_A, r._id);
		// Move one order out of "new" (pending) into "confirmed".
		await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", first))
				.first();
			if (o) await ctx.db.patch(o._id, { status: "confirmed" });
		});

		const all = await asA.action(api.orders.exportOrders, {
			retailerId: r._id,
			bucket: "all",
		});
		expect(all.count).toBe(2);
		// A small set is fully exported — never flagged as truncated.
		expect(all.capped).toBe(false);

		const news = await asA.action(api.orders.exportOrders, {
			retailerId: r._id,
			bucket: "new",
		});
		expect(news.count).toBe(1);
		// Header + one data row.
		expect(news.csv.split("\r\n")).toHaveLength(2);
	});

	test("selection mode exports exactly the given orders", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const keep = await seedOrder(t, USER_A, r._id);
		await seedOrder(t, USER_A, r._id);
		const keepId = await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", keep))
				.first();
			return o?._id as Id<"orders">;
		});

		const res = await asA.action(api.orders.exportOrders, {
			retailerId: r._id,
			bucket: "all",
			orderIds: [keepId],
		});
		expect(res.count).toBe(1);
		expect(res.csv).toContain(keep);
	});

	test("filter mode paginates across pages (does not truncate at one page)", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await asA.mutation(api.products.create, {
			retailerId: r._id,
			name: "Item",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			variants: [{ optionValues: [], price: 100, onHand: 1000 }],
		});
		// 600 orders > one 500-row scan page — proves the export aggregates pages
		// rather than silently stopping at the first (the MEDIUM review finding).
		const N = 600;
		await t.run(async (ctx) => {
			const now = Date.now();
			for (let i = 0; i < N; i++) {
				await ctx.db.insert("orders", {
					retailerId: r._id,
					shortId: `ORD-B${i}`,
					items: [{ productId, name: "Item", price: 100, quantity: 1 }],
					subtotal: 100,
					total: 100,
					currency: "MYR",
					status: "pending",
					channel: "whatsapp",
					customer: { name: "Bulk" },
					createdAt: now - i,
					updatedAt: now - i,
				});
			}
		});

		const res = await asA.action(api.orders.exportOrders, {
			retailerId: r._id,
			bucket: "all",
		});
		expect(res.count).toBe(N);
		expect(res.capped).toBe(false);
		// Header + N data rows.
		expect(res.csv.split("\r\n")).toHaveLength(N + 1);
	});

	test("a non-owner cannot export another retailer's orders", async () => {
		const t = setup();
		const r = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		await expect(
			t
				.withIdentity({ subject: USER_B })
				.action(api.orders.exportOrders, { retailerId: r._id, bucket: "all" }),
		).rejects.toThrow(/forbidden/i);
	});
});

describe("invoices PDF (UC B)", () => {
	async function seedInvoice(t: ReturnType<typeof setup>, userId: string) {
		const r = await seedRetailer(t, userId);
		const invoiceId = await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
				.first();
			if (!sub) throw new Error("no sub");
			const now = Date.now();
			return ctx.db.insert("invoices", {
				retailerId: r._id,
				subscriptionId: sub._id,
				invoiceNumber: `INV-TEST-${userId}`,
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				foundingDiscount: 4500,
				total: 10400,
				currency: "MYR",
				periodStart: now,
				periodEnd: now + 30 * 86_400_000,
				dueDate: now + 14 * 86_400_000,
				status: "pending",
				createdAt: now,
			});
		});
		return { retailerId: r._id, invoiceId };
	}

	test("generateInvoicePdf stores a PDF and is idempotent", async () => {
		const t = setup();
		const { invoiceId } = await seedInvoice(t, USER_A);

		await t.action(internal.invoices.generateInvoicePdf, { invoiceId });
		const firstId = await t.run(
			async (ctx) => (await ctx.db.get(invoiceId))?.pdfStorageId,
		);
		expect(firstId).toBeDefined();

		// Re-running is a no-op (skips when a PDF already exists).
		await t.action(internal.invoices.generateInvoicePdf, { invoiceId });
		const secondId = await t.run(
			async (ctx) => (await ctx.db.get(invoiceId))?.pdfStorageId,
		);
		expect(secondId).toBe(firstId);
	});

	test("getInvoicePdfUrl: owner allowed, others forbidden, admin allowed", async () => {
		const t = setup();
		const { invoiceId } = await seedInvoice(t, USER_A);
		await seedRetailer(t, USER_B);
		await t.action(internal.invoices.generateInvoicePdf, { invoiceId });

		const ownerUrl = await t
			.withIdentity({ subject: USER_A })
			.query(api.invoices.getInvoicePdfUrl, { invoiceId });
		expect(typeof ownerUrl).toBe("string");

		const adminUrl = await t
			.withIdentity({ subject: ADMIN })
			.query(api.invoices.getInvoicePdfUrl, { invoiceId });
		expect(typeof adminUrl).toBe("string");

		await expect(
			t
				.withIdentity({ subject: USER_B })
				.query(api.invoices.getInvoicePdfUrl, { invoiceId }),
		).rejects.toThrow(/forbidden/i);
	});

	test("getInvoicePdfUrl returns null before the PDF is rendered", async () => {
		const t = setup();
		const { invoiceId } = await seedInvoice(t, USER_A);
		const url = await t
			.withIdentity({ subject: USER_A })
			.query(api.invoices.getInvoicePdfUrl, { invoiceId });
		expect(url).toBeNull();
	});

	test("getOrCreateInvoicePdfUrl renders on demand for a legacy invoice", async () => {
		const t = setup();
		// Seeded invoice has NO pdfStorageId (mirrors invoices issued before this
		// feature) — the action must generate it and return a URL.
		const { invoiceId } = await seedInvoice(t, USER_A);
		const url = await t
			.withIdentity({ subject: USER_A })
			.action(api.invoices.getOrCreateInvoicePdfUrl, { invoiceId });
		expect(typeof url).toBe("string");
		// The blob is now persisted on the invoice.
		const stored = await t.run(
			async (ctx) => (await ctx.db.get(invoiceId))?.pdfStorageId,
		);
		expect(stored).toBeDefined();
	});

	test("getOrCreateInvoicePdfUrl rejects a non-owner before generating", async () => {
		const t = setup();
		const { invoiceId } = await seedInvoice(t, USER_A);
		await seedRetailer(t, USER_B);
		await expect(
			t
				.withIdentity({ subject: USER_B })
				.action(api.invoices.getOrCreateInvoicePdfUrl, { invoiceId }),
		).rejects.toThrow(/forbidden/i);
		// No PDF was generated for the unauthorized request (unset id reads as
		// null/undefined depending on the harness).
		const stored = await t.run(
			async (ctx) => (await ctx.db.get(invoiceId))?.pdfStorageId,
		);
		expect(stored == null).toBe(true);
	});
});
