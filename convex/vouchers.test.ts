/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";
import { VOUCHER_BATCH_MAX } from "./lib/vouchers";
import { claimVoucherDiscount } from "./lib/voucherRedemption";

/**
 * The voucher module (`z8r3fdr617`): issuing, voiding, the seller's list and
 * the buyer's code check — plus the counter and claim redemption doors, whose
 * behaviour is specific to this module's session/claim plumbing rather than to
 * the totals seam (that lives in `voucherRedemption.test.ts`).
 */

const modules = import.meta.glob("./**/*.ts");

const USER_A = "user_v_owner";
const USER_B = "user_v_other";
const MEMBER = "user_v_member";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Voucher Store",
		slug: `v-store-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedVariant(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	price = 5000,
): Promise<Id<"productVariants">> {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: "Latte",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price, onHand: 50 }],
	});
	return t.run(async (ctx) => {
		const v = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!v) throw new Error("variant seed failed");
		return v._id;
	});
}

async function startWalkIn(
	t: ReturnType<typeof setup>,
	userId: string,
): Promise<Id<"counterCheckoutSessions">> {
	const asUser = t.withIdentity({ subject: userId });
	const { token } = await asUser.mutation(
		api.counterCheckout.ensureCounterQrToken,
		{},
	);
	const res = await t.mutation(
		internal.counterCheckout.startSessionFromStoreQr,
		{ token, waPhone: "60123456789", profileName: "Aiman" },
	);
	if (res.result !== "started") throw new Error("walk-in not started");
	return t.run(async (ctx) => {
		const rows = await ctx.db.query("counterCheckoutSessions").collect();
		const s = rows.find((r) => r.status === "buyer_identified");
		if (!s) throw new Error("no bound session");
		return s._id;
	});
}

/** Drop a store to Starter — the Pro gate's negative case. */
async function downgradeToStarter(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription");
		await ctx.db.patch(sub._id, { plan: "starter", status: "active" });
	});
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

describe("vouchers.create", () => {
	test("mints a single active voucher with a canonical code", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers, batchId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				note: "Raya giveaway",
			});
		expect(vouchers).toHaveLength(1);
		expect(vouchers[0].code).toMatch(/^KP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
		expect(vouchers[0].status).toBe("active");
		expect(vouchers[0].note).toBe("Raya giveaway");
		expect(vouchers[0].currency).toBe("MYR");
		// A single voucher is not a batch — that's what "was this part of a run?"
		// reads off.
		expect(batchId).toBeUndefined();
		expect(vouchers[0].batchId).toBeUndefined();
	});

	test("a batch shares one id and every code is distinct", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers, batchId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "percent",
				value: 10,
				count: 20,
			});
		expect(vouchers).toHaveLength(20);
		expect(batchId).toBeTypeOf("string");
		expect(new Set(vouchers.map((v) => v.code)).size).toBe(20);
		expect(vouchers.every((v) => v.batchId === batchId)).toBe(true);
	});

	test("refuses a value that isn't worth anything, or is worth too much", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		for (const args of [
			{ kind: "fixed" as const, value: 0 },
			{ kind: "fixed" as const, value: -100 },
			{ kind: "percent" as const, value: 0 },
			{ kind: "percent" as const, value: 101 },
			{ kind: "fixed" as const, value: 500_001 },
		]) {
			await expect(
				asUser.mutation(api.vouchers.create, {
					retailerId: retailer._id,
					...args,
				}),
			).rejects.toThrow();
		}
	});

	test("refuses a batch over the cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				count: VOUCHER_BATCH_MAX + 1,
			}),
		).rejects.toThrow(new RegExp(String(VOUCHER_BATCH_MAX)));
	});

	test("an expiry of TODAY is allowed — a voucher works all through its day", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				expiresAt: todayMytMidnight(),
			});
		expect(vouchers[0].status).toBe("active");
	});

	test("refuses an expiry already in the past, and a non-calendar-day value", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await expect(
			asUser.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				expiresAt: todayMytMidnight() - DAY_MS,
			}),
		).rejects.toThrow(/already passed/i);
		await expect(
			asUser.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				expiresAt: todayMytMidnight() + 3600_000, // mid-day, not a day
			}),
		).rejects.toThrow(/expiry date/i);
	});

	test("issuing is Pro — a Starter store is refused, and told where to go", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await downgradeToStarter(t, retailer._id);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
			}),
		).rejects.toThrow(/Pro plan/);
	});

	test("another store's owner can't issue against it", async () => {
		const t = setup();
		const mine = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		await expect(
			t.withIdentity({ subject: USER_B }).mutation(api.vouchers.create, {
				retailerId: mine._id,
				kind: "fixed",
				value: 1000,
			}),
		).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Voiding
// ---------------------------------------------------------------------------

describe("vouchers.voidVoucher", () => {
	async function oneVoucher(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
			});
		return { retailer, voucher: vouchers[0] };
	}

	test("void is SOFT — the row and its history stay", async () => {
		const t = setup();
		const { voucher } = await oneVoucher(t);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.voidVoucher, {
				voucherId: voucher.id,
				reason: "Sent to the wrong buyer",
			});
		const row = await t.run((ctx) => ctx.db.get(voucher.id));
		expect(row).not.toBeNull();
		expect(row?.status).toBe("voided");
		expect(row?.voidedAt).toBeTypeOf("number");
		expect(row?.voidReason).toBe("Sent to the wrong buyer");
		// The code is preserved, so the seller can still answer "what happened
		// to the code I sent you?".
		expect(row?.code).toBe(voucher.code);
	});

	test("void is idempotent", async () => {
		const t = setup();
		const { voucher } = await oneVoucher(t);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.vouchers.voidVoucher, { voucherId: voucher.id });
		await expect(
			asUser.mutation(api.vouchers.voidVoucher, { voucherId: voucher.id }),
		).resolves.toBeNull();
	});

	test("a SPENT voucher can't be voided — that would rewrite a placed order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const { vouchers } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
			});
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			voucherCode: vouchers[0].code,
		});
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.vouchers.voidVoucher, {
				voucherId: vouchers[0].id,
			}),
		).rejects.toThrow(/already been used/i);
	});

	test("voiding is NOT Pro-gated — a downgraded store can withdraw its promises", async () => {
		// Every feature's "disabling stays un-gated" rule: a seller who drops to
		// Starter must still be able to call off codes they issued on Pro.
		const t = setup();
		const { retailer, voucher } = await oneVoucher(t);
		await downgradeToStarter(t, retailer._id);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.voidVoucher, { voucherId: voucher.id });
		expect((await t.run((ctx) => ctx.db.get(voucher.id)))?.status).toBe(
			"voided",
		);
	});

	test("voidBatch skips what it can't do and names the skip", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers, batchId } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 1000,
			count: 4,
		});
		// Spend one of the four.
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			voucherCode: vouchers[0].code,
		});
		const result = await asUser.mutation(api.vouchers.voidBatch, {
			retailerId: retailer._id,
			batchId: batchId!,
			reason: "Print run cancelled",
		});
		// Refusing the whole batch because one of four is spent would leave the
		// seller voiding three by hand.
		expect(result).toEqual({ voided: 3, skippedRedeemed: 1 });
		expect((await t.run((ctx) => ctx.db.get(vouchers[0].id)))?.status).toBe(
			"redeemed",
		);
	});
});

// ---------------------------------------------------------------------------
// The seller's list
// ---------------------------------------------------------------------------

describe("vouchers.list", () => {
	test("returns the whole book with every state resolved, expired judged live", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 1000,
			count: 4,
		});
		// One spent…
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			voucherCode: vouchers[0].code,
		});
		// …one voided…
		await asUser.mutation(api.vouchers.voidVoucher, {
			voucherId: vouchers[1].id,
		});
		// …and one lapsed, with no cron involved.
		await t.run((ctx) =>
			ctx.db.patch(vouchers[2].id, {
				expiresAt: todayMytMidnight() - 3 * DAY_MS,
			}),
		);

		const all = await asUser.query(api.vouchers.list, {
			retailerId: retailer._id,
		});
		expect(all.counts).toEqual({
			active: 1,
			redeemed: 1,
			voided: 1,
			expired: 1,
		});
		expect(all.vouchers).toHaveLength(4);

		// Every row comes back with its RESOLVED status — the lapsed one reads
		// `expired` with no cron having touched it, which is what lets the
		// client filter and group without a second query (voucher-groups.ts).
		expect(
			all.vouchers.find((row) => row.id === vouchers[2].id)?.status,
		).toBe("expired");
		expect(all.vouchers.filter((row) => row.status === "expired")).toHaveLength(
			1,
		);
	});

	test("a redeemed row links to the order it paid for", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			voucherCode: vouchers[0].code,
		});
		const { vouchers: rows } = await asUser.query(api.vouchers.list, {
			retailerId: retailer._id,
		});
		const spent = rows.find((row) => row.status === "redeemed");
		expect(spent?.redeemedOrder?.shortId).toBe(shortId);
		expect(spent?.redeemedOrder?.total).toBe(4000);
	});

	test("history stays readable on a DOWNGRADED store", async () => {
		// The 8 Oct decision: issuing is Pro, but a store that drops to Starter
		// still has to see the codes it already sent out.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 1000,
			count: 2,
		});
		await downgradeToStarter(t, retailer._id);
		const { vouchers, counts } = await asUser.query(api.vouchers.list, {
			retailerId: retailer._id,
		});
		expect(vouchers).toHaveLength(2);
		expect(counts.active).toBe(2);
	});

	test("the list needs the vouchers grant — orders alone is not enough", async () => {
		// Issuing gives money away, so it is its own area. A front-desk helper
		// with full order rights must not inherit it.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await t.run(async (ctx) => {
			await ctx.db.insert("retailerMembers", {
				retailerId: retailer._id,
				userId: MEMBER,
				email: "helper@example.com",
				status: "active",
				permissions: { orders: "write", products: "read" },
				invitedBy: USER_A,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			});
		});
		await expect(
			t.withIdentity({ subject: MEMBER }).query(api.vouchers.list, {
				retailerId: retailer._id,
			}),
		).rejects.toThrow();
		// …and with the grant, it works.
		await t.run(async (ctx) => {
			const m = await ctx.db
				.query("retailerMembers")
				.filter((q) => q.eq(q.field("userId"), MEMBER))
				.first();
			if (m)
				await ctx.db.patch(m._id, {
					permissions: { orders: "write", vouchers: "read" },
				});
		});
		const res = await t
			.withIdentity({ subject: MEMBER })
			.query(api.vouchers.list, { retailerId: retailer._id });
		expect(res.vouchers).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// The buyer's code check
// ---------------------------------------------------------------------------

describe("vouchers.checkCode", () => {
	test("a good code returns its canonical spelling and terms", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "percent",
				value: 15,
			});
		const res = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			// Typed carelessly — the field corrects it in place.
			code: vouchers[0].code.toLowerCase().replace(/-/g, ""),
		});
		expect(res).toEqual({
			ok: true,
			code: vouchers[0].code,
			terms: { kind: "percent", value: 15 },
		});
	});

	test("a refusal is DATA, not a throw — a bad code must not read as an error", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const unknown = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "KP-ZZZZ-ZZZZ",
		});
		expect(unknown).toMatchObject({ ok: false, refusal: "not_found" });
		const junk = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "hello",
		});
		expect(junk).toMatchObject({ ok: false, refusal: "malformed" });
	});

	test("checking does NOT spend the voucher", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { vouchers } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
			});
		for (let i = 0; i < 3; i++)
			await t.mutation(api.vouchers.checkCode, {
				retailerId: retailer._id,
				code: vouchers[0].code,
			});
		expect((await t.run((ctx) => ctx.db.get(vouchers[0].id)))?.status).toBe(
			"active",
		);
	});

	test("the check is rate-limited — a code is a guessable secret", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		// The bucket is 10 with a 20/min refill; hammering past it must refuse
		// rather than hand out an unmetered guessing oracle.
		let refused = false;
		for (let i = 0; i < 40; i++) {
			try {
				await t.mutation(api.vouchers.checkCode, {
					retailerId: retailer._id,
					code: "KP-ZZZZ-ZZZZ",
				});
			} catch {
				refused = true;
				break;
			}
		}
		expect(refused).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Door 2 — the counter
// ---------------------------------------------------------------------------

describe("counter checkout", () => {
	test("the sale spends the code and keeps the draft in canonical form", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 1500);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 500,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 2 }],
				// Keyed off the buyer's QR, lowercase and unpunctuated.
				voucherCode: vouchers[0].code.toLowerCase().replace(/-/g, ""),
			},
		});
		// The draft keeps the CANONICAL spelling, so the door never re-parses.
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.voucherCode).toBe(vouchers[0].code);

		const { orderId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId, quantity: 2 }],
				paidInPerson: true,
				voucherCode: vouchers[0].code,
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.subtotal).toBe(3000);
		expect(order?.voucherDiscount).toBe(500);
		expect(order?.total).toBe(2500);
		expect((await t.run((ctx) => ctx.db.get(vouchers[0].id)))?.status).toBe(
			"redeemed",
		);
	});

	test("the door reads the ARGUMENT, never the debounced draft", async () => {
		// The draft is a 700ms autosave; items are already passed explicitly for
		// exactly this reason, and the voucher now is too. A sale that passes no
		// code charges full price even with one sitting in the draft — which is
		// what makes "applied in the panel" and "charged on the order" the same
		// fact instead of a race the seller can lose.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 1500);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 500,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 1 }],
				voucherCode: vouchers[0].code,
			},
		});
		const { orderId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{ sessionId, items: [{ variantId, quantity: 1 }], paidInPerson: true },
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.total).toBe(1500);
		expect(order?.voucherId).toBeUndefined();
		// …and the code is still spendable, not burned by a sale that ignored it.
		expect((await t.run((ctx) => ctx.db.get(vouchers[0].id)))?.status).toBe(
			"active",
		);
	});

	test("a 100% code at the counter is a FREE order — nothing to collect", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 1500);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "percent",
			value: 100,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 1 }],
				voucherCode: vouchers[0].code,
			},
		});
		const { orderId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId, quantity: 1 }],
				// "Paid now · Cash" on a free order would contradict the page.
				paidInPerson: true,
				voucherCode: vouchers[0].code,
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.total).toBe(0);
		expect(order?.paymentStatus).toBe("unpaid");
		expect(order?.paymentMethod).toBeUndefined();
	});

	test("a lapsed code refuses the SALE rather than ringing up a surprise price", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 1500);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 500,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 1 }],
				voucherCode: vouchers[0].code,
			},
		});
		// Voided while the cart sat open.
		await asUser.mutation(api.vouchers.voidVoucher, {
			voucherId: vouchers[0].id,
		});
		await expect(
			asUser.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				voucherCode: vouchers[0].code,
			}),
		).rejects.toThrow(/no longer valid/i);
	});

	test("an unparseable draft code is dropped, never saved — autosave can't fail", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 1500);
		const asUser = t.withIdentity({ subject: USER_A });
		const sessionId = await startWalkIn(t, USER_A);
		// Mid-keystroke. Refusing the save would lose the rest of the cart.
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: { items: [{ variantId, quantity: 1 }], voucherCode: "KP-7F" },
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.voucherCode).toBeUndefined();
		expect(session?.draft?.items).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Door 3 — the claim link
// ---------------------------------------------------------------------------

describe("claim link", () => {
	async function claimWithVoucher(
		t: ReturnType<typeof setup>,
		terms: { kind: "fixed" | "percent"; value: number } = {
			kind: "fixed",
			value: 500,
		},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 3000);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			...terms,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 1 }],
				voucherCode: vouchers[0].code,
			},
		});
		const { token } = await asUser.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 60,
			voucherCode: vouchers[0].code,
		});
		return { retailer, variantId, voucher: vouchers[0], token, asUser };
	}

	test("the voucher is FROZEN at send but not yet spent — a claim is an offer", async () => {
		const t = setup();
		const { voucher, token } = await claimWithVoucher(t);
		const claim = await t.run(async (ctx) =>
			ctx.db
				.query("orderClaims")
				.withIndex("by_token", (q) => q.eq("token", token))
				.unique(),
		);
		expect(claim?.voucherId).toBe(voucher.id);
		expect(claim?.voucherSnapshot).toEqual({
			code: voucher.code,
			kind: "fixed",
			value: 500,
		});
		// An abandoned link must not burn a voucher.
		expect((await t.run((ctx) => ctx.db.get(voucher.id)))?.status).toBe(
			"active",
		);
	});

	test("the buyer's page prices it, and the commit charges the same", async () => {
		const t = setup();
		const { voucher, token } = await claimWithVoucher(t);
		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.voucher).toMatchObject({
			kind: "applied",
			snapshot: { code: voucher.code, kind: "fixed", value: 500 },
		});
		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const order = await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			return o;
		});
		expect(order?.subtotal).toBe(3000);
		expect(order?.voucherDiscount).toBe(500);
		expect(order?.total).toBe(2500);
		expect((await t.run((ctx) => ctx.db.get(voucher.id)))?.status).toBe(
			"redeemed",
		);
	});

	/**
	 * Every seller-side figure for a claim is NET of its voucher
	 * (`z8r3fdr617`). The hands-on pass found all three printing the gross:
	 * a claim sent at RM 25.00 read "RM 30.00" in the claims list, on the
	 * frozen "waiting on buyer" screen whose entire job is to mirror what the
	 * buyer sees, and in the buyer's own page header above its own ticket.
	 */
	test("the seller's claim figures are net of the voucher, not the items total", async () => {
		const t = setup();
		const { token, asUser } = await claimWithVoucher(t);

		// The claims list row.
		const [row] = await asUser.query(api.orderClaims.listClaims, {});
		expect(row.total).toBe(2500); // 3000 items − 500 voucher

		// The frozen counter screen — same claim, same number.
		const claim = await t.run(async (ctx) =>
			ctx.db
				.query("orderClaims")
				.withIndex("by_token", (q) => q.eq("token", token))
				.unique(),
		);
		const session = await asUser.query(
			api.counterCheckout.getCheckoutSession,
			{ sessionId: claim!.sessionId },
		);
		expect(session?.liveClaim?.total).toBe(2500);

		// And the buyer's page prices from the same rule.
		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.itemsTotal).toBe(3000);
		expect(page?.open?.voucher).toMatchObject({ kind: "applied" });
	});

	/**
	 * The trap that makes "just judge it live everywhere" wrong: once the claim
	 * COMPLETES, its voucher is `redeemed`, so `claimVoucherState` answers
	 * `dropped` — and a row that re-judged would hand back the GROSS for the
	 * one case where the discount definitely happened. Completed rows read the
	 * order instead.
	 */
	test("a completed claim reads the ORDER's total, not a re-judged voucher", async () => {
		const t = setup();
		const { token, asUser, voucher } = await claimWithVoucher(t);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		// The voucher really is spent — this is what would mislead a re-judge.
		expect((await t.run((ctx) => ctx.db.get(voucher.id)))?.status).toBe(
			"redeemed",
		);

		const rows = await asUser.query(api.orderClaims.listClaims, {});
		const completed = rows.find((r) => r.status === "completed");
		expect(completed?.total).toBe(2500);
	});

	/**
	 * The one case neither branch could write alone: a voucher claim on a
	 * store whose payments are PAUSED (`z8r3fdr6gg` landed on staging while
	 * this was in review).
	 *
	 * The two features meet on the same screen and must not blur into each
	 * other: "you can't pay yet" and "this is what you'll pay" are different
	 * sentences about different things. A lapsed store's buyers can still
	 * ORDER — that is the whole point of that feature — so the voucher must
	 * still apply, still be spent, and the total must still be the discounted
	 * one. Only the paying is shut.
	 */
	test("a lapsed store still honours the voucher — only the paying is shut", async () => {
		const t = setup();
		const { token, retailer, voucher } = await claimWithVoucher(t);
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			if (!sub) throw new Error("no subscription row");
			await ctx.db.patch(sub._id, { status: "past_due" });
		});

		const page = await t.query(api.orderClaims.getByToken, { token });
		// Both true at once, and neither softens the other.
		expect(page?.store.paymentsPaused).toBe(true);
		expect(page?.open?.voucher).toMatchObject({ kind: "applied" });

		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const order = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		expect(order?.total).toBe(2500);
		expect(order?.voucherDiscount).toBe(500);
		expect((await t.run((ctx) => ctx.db.get(voucher.id)))?.status).toBe(
			"redeemed",
		);
	});

	test("a voucher spent elsewhere DROPS with a notice — never a dead end", async () => {
		// The one door that doesn't refuse: the buyer followed a link and only
		// the seller can issue another, so refusing would strand them. The page
		// says so BEFORE the form, and the commit charges exactly that.
		const t = setup();
		const { voucher, token, asUser } = await claimWithVoucher(t);
		await asUser.mutation(api.vouchers.voidVoucher, {
			voucherId: voucher.id,
			reason: "Issued twice by mistake",
		});

		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.voucher).toMatchObject({
			kind: "dropped",
			refusal: "voided",
		});
		expect(page?.open?.voucher).toHaveProperty("message");

		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const order = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		// Charged full price — which the page had already said — and the order
		// records NO voucher, because none was spent.
		expect(order?.total).toBe(3000);
		expect(order?.voucherId).toBeUndefined();
		expect(order?.voucherSnapshot).toBeUndefined();
		expect(order?.voucherDiscount).toBeUndefined();
	});

	test("sending with a dead code is refused — the seller can still fix it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, 3000);
		const asUser = t.withIdentity({ subject: USER_A });
		const { vouchers } = await asUser.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 500,
		});
		const sessionId = await startWalkIn(t, USER_A);
		await asUser.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 1 }],
				voucherCode: vouchers[0].code,
			},
		});
		await asUser.mutation(api.vouchers.voidVoucher, {
			voucherId: vouchers[0].id,
		});
		await expect(
			asUser.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 60,
				voucherCode: vouchers[0].code,
			}),
		).rejects.toThrow(/no longer valid/i);
	});
});

/**
 * `claimVoucherDiscount` — the ONE author of what a claim's voucher takes off
 * (`z8r3fdr617`).
 *
 * It exists because the rule was written twice: once in the claim page's
 * maths and once, during the hands-on pass, in the page HEADER — which had
 * been printing the GROSS items figure, so a claim sent at RM 32.00 greeted
 * the buyer with "RM 40.00" directly above a ticket reading "TOTAL RM 32.00".
 * Two copies of a money rule is how those two numbers part company, so there
 * is one copy and these tests hold it to the `applied`-only contract.
 */
describe("claimVoucherDiscount", () => {
	test("an applied voucher discounts; dropped and none never do", () => {
		const terms = { kind: "percent", value: 20 } as const;
		const snapshot = { code: "KP-TEST-CODE", kind: "percent" as const, value: 20 };

		expect(
			claimVoucherDiscount(
				{
					kind: "applied",
					voucherId: "v1" as Id<"vouchers">,
					snapshot,
					terms,
				},
				4000,
			),
		).toBe(800);

		// The whole reason the claim page degrades instead of refusing: a
		// dropped voucher must price at FULL and say why. A non-zero here
		// would quote the buyer a discount the commit then declines to give.
		expect(
			claimVoucherDiscount(
				{
					kind: "dropped",
					snapshot,
					refusal: "voided",
					message: "This voucher is no longer valid.",
				},
				4000,
			),
		).toBe(0);

		expect(claimVoucherDiscount({ kind: "none" }, 4000)).toBe(0);
		expect(claimVoucherDiscount(undefined, 4000)).toBe(0);
	});

	test("it clamps to the item subtotal, so a claim total can't go negative", () => {
		expect(
			claimVoucherDiscount(
				{
					kind: "applied",
					voucherId: "v2" as Id<"vouchers">,
					snapshot: { code: "KP-BIG0-0000", kind: "fixed" as const, value: 5000 },
					terms: { kind: "fixed", value: 5000 },
				},
				3000,
			),
		).toBe(3000);
	});
});
