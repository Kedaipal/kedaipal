/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { OPEN_SESSION_TTL_MS } from "./counterCheckout";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_seller_a";
const USER_B = "user_seller_b";

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Bearcamp",
		slug: `bearcamp-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Insert a customer row directly (faster than driving an order). */
async function seedCustomer(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	waPhone: string,
	name: string,
): Promise<Id<"customers">> {
	const now = Date.now();
	return t.run(async (ctx) =>
		ctx.db.insert("customers", {
			retailerId,
			waPhone,
			name,
			searchText: `${name.toLowerCase()} ${waPhone}`,
			orderCount: 3,
			totalSpent: 15000,
			firstOrderAt: now - 1000,
			lastOrderAt: now,
			createdAt: now,
			updatedAt: now,
		}),
	);
}

/**
 * Ensure the store's permanent QR token + start a walk-in session via a scan,
 * returning the created session's id + pairing code. This is the ONLY way a
 * counter session is created now — 86ey5neg6 removed the per-session KP- flow.
 */
async function startWalkIn(
	t: ReturnType<typeof setup>,
	userId: string,
	opts: { waPhone?: string; profileName?: string } = {},
): Promise<{
	sessionId: Id<"counterCheckoutSessions">;
	code: string;
	retailerId: Id<"retailers">;
}> {
	const asUser = t.withIdentity({ subject: userId });
	const { token } = await asUser.mutation(
		api.counterCheckout.ensureCounterQrToken,
		{},
	);
	const waPhone = opts.waPhone ?? "60123456789";
	const res = await t.mutation(
		internal.counterCheckout.startSessionFromStoreQr,
		{ token, waPhone, profileName: opts.profileName },
	);
	if (res.result !== "started")
		throw new Error(`walk-in not started: ${res.result}`);
	const sessionId = await t.run(async (ctx) => {
		const s = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", res.retailerId).eq("status", "buyer_identified"),
			)
			.filter((q) => q.eq(q.field("waPhone"), waPhone))
			.unique();
		if (!s) throw new Error("walk-in session row not found");
		return s._id;
	});
	return { sessionId, code: res.code, retailerId: res.retailerId };
}

describe("counterCheckout — read + ownership", () => {
	test("owner reads the session; a non-owner gets null (graceful, no leak)", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const { sessionId } = await startWalkIn(t, USER_A);

		const own = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(own?.status).toBe("buyer_identified");

		// Not-owned resolves to null (→ friendly "not found" UI), not a thrown
		// Forbidden — the session id is URL-addressable, so a foreign id must
		// degrade gracefully and not reveal whether the session exists.
		const foreign = await t
			.withIdentity({ subject: USER_B })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(foreign).toBeNull();
	});

	test("a session past its TTL reads as expired even before the cron flips it", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await startWalkIn(t, USER_A);
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - 1 }),
		);
		const read = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.getCheckoutSession, { sessionId });
		expect(read?.status).toBe("expired");
	});
});

describe("counterCheckout — cancel + expiry cron", () => {
	test("owner cancels an open session", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await startWalkIn(t, USER_A);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.cancelCheckoutSession, { sessionId });
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("cancelled");
	});

	test("expireStaleSessions flips idle past-TTL sessions to expired", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await startWalkIn(t, USER_A);
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - 1000 }),
		);

		const res = await t.mutation(
			internal.counterCheckout.expireStaleSessions,
			{ status: "buyer_identified" },
		);
		expect(res.expired).toBeGreaterThanOrEqual(1);
		const row = await t.run((ctx) => ctx.db.get(sessionId));
		expect(row?.status).toBe("expired");
	});
});

async function seedVariant(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	opts: {
		price?: number;
		onHand?: number;
		block?: boolean;
		requiresProof?: boolean;
	} = {},
): Promise<Id<"productVariants">> {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: "Latte",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: opts.block ?? false,
		requiresProof: opts.requiresProof ?? false,
		variants: [
			{ optionValues: [], price: opts.price ?? 1200, onHand: opts.onHand ?? 50 },
		],
	});
	const variant = await t.run((ctx) =>
		ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first(),
	);
	if (!variant) throw new Error("variant seed failed");
	return variant._id;
}

/** Seed an isCustom (quote, price-0) variant — the made-to-order line. */
async function seedCustomVariant(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
): Promise<Id<"productVariants">> {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: "Bespoke Cake",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [
			// A product can't be custom-only — it needs a base variant alongside.
			{ optionValues: [], price: 2000, onHand: 5 },
			{
				optionValues: [],
				price: 0,
				onHand: 0,
				isCustom: true,
				customLabel: "Bespoke",
			},
		],
	});
	const v = await t.run((ctx) =>
		ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.filter((q) => q.eq(q.field("isCustom"), true))
			.first(),
	);
	if (!v) throw new Error("custom variant seed failed");
	return v._id;
}

async function boundSession(t: ReturnType<typeof setup>, retailerId: Id<"retailers">) {
	void retailerId; // sessions resolve via USER_A's store
	const { sessionId } = await startWalkIn(t, USER_A, { profileName: "Aiman" });
	return sessionId;
}

describe("counterCheckout — createOrderFromSession", () => {
	test("creates a confirmed self-collect order, paid in person, and completes the session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 1500 });
		const sessionId = await boundSession(t, retailer._id);

		const { shortId, orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});
		expect(shortId).toMatch(/^ORD-/);

		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("confirmed");
		expect(order?.source).toBe("counter"); // stamped as a walk-in sale
		expect(order?.deliveryMethod).toBe("self_collect");
		expect(order?.paymentStatus).toBe("received");
		expect(order?.paymentMethod).toBe("cash");
		expect(order?.total).toBe(3000);
		expect(order?.customer.waPhone).toBe("60123456789");
		expect(order?.trackingToken).toMatch(/^[A-Za-z0-9]{24}$/);

		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("completed");
		expect(session?.orderId).toBe(orderId);

		// Customer linked + aggregates updated.
		const asUser = t.withIdentity({ subject: USER_A });
		const customers = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(customers.page).toHaveLength(1);
		expect(customers.page[0].orderCount).toBe(1);
		expect(customers.page[0].totalSpent).toBe(3000);
	});

	test("counter orders meter the monthly subscriptionUsage counter (soft cap)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
			});

		const total = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("subscriptionUsage")
				.withIndex("by_retailer_month", (q) =>
					q.eq("retailerId", retailer._id),
				)
				.collect();
			return rows.reduce((sum, r) => sum + r.orders, 0);
		});
		expect(total).toBe(1);
	});

	test("pay-later leaves the order unpaid", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: false,
			});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentStatus).toBe("unpaid");
	});

	test("decrements stock for hard-block variants", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 5,
		});
		const sessionId = await boundSession(t, retailer._id);

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				paidInPerson: true,
			});
		const variant = await t.run((ctx) => ctx.db.get(variantId));
		expect(variant?.onHand).toBe(3);
	});

	test("rejects creating an order when the session isn't buyer_identified", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);
		// Knock it out of the buyer_identified state the guard requires.
		await t.run((ctx) => ctx.db.patch(sessionId, { status: "cancelled" }));

		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.counterCheckout.createOrderFromSession, {
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: true,
				}),
		).rejects.toThrow(/Bind a buyer/);
	});

	test("a non-owner cannot create an order off someone else's session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);

		await expect(
			t
				.withIdentity({ subject: USER_B })
				.mutation(api.counterCheckout.createOrderFromSession, {
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: true,
				}),
		).rejects.toThrow(/Forbidden/);
	});

	test("a fixed-price design-approval (requiresProof) item now sells at the counter, no mockup gate", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		// requiresProof but NOT custom → has a real price; design is agreed in person.
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			requiresProof: true,
			price: 3000,
		});
		const sessionId = await boundSession(t, retailer._id);

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("confirmed");
		expect(order?.items[0]?.price).toBe(3000);
		expect(order?.mockupStatus).toBeUndefined(); // no gate — sold in person
	});

	test("a custom line sells with the vendor-set price and no mockup gate", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedCustomVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 2, unitPrice: 4500 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.items[0]?.price).toBe(4500);
		expect(order?.items[0]?.variantLabel).toBe("Bespoke");
		expect(order?.total).toBe(9000);
		expect(order?.mockupStatus).toBeUndefined();
	});

	test("a high-value custom price is accepted — no upper cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedCustomVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);

		// RM 500,000 — above the old RM 100k ceiling. A vendor's business can be
		// high-value (watches, renovations, B2B); the guard is the review modal,
		// not a hardcoded cap. Locks the "no cap" behaviour against regression.
		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 500_000_00 }],
				paidInPerson: true,
				paymentMethod: "bank_transfer",
			});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.items[0]?.price).toBe(500_000_00);
		expect(order?.total).toBe(500_000_00);
	});

	test("a custom line without a valid price is rejected", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedCustomVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }], // no price
				paidInPerson: true,
			}),
		).rejects.toThrow(/Set a price/);
		await expect(
			asA.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 0 }], // zero
				paidInPerson: true,
			}),
		).rejects.toThrow(/Set a price/);
		// Session survives the rejections — the vendor can fix and retry.
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("buyer_identified");
	});

	test("a client price on a NON-custom line is ignored (server price wins)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			price: 1200,
		});
		const sessionId = await boundSession(t, retailer._id);

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1, unitPrice: 1 }], // tampered → ignored
				paidInPerson: true,
				paymentMethod: "cash",
			});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.items[0]?.price).toBe(1200);
	});
});

describe("counterCheckout — open sessions + draft", () => {
	test("a walk-in session gets the long idle window", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const sessionId = await boundSession(t, retailer._id);
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		// A multi-day idle window (not a short scan window).
		expect(session?.expiresAt).toBeGreaterThan(
			Date.now() + 24 * 60 * 60 * 1000,
		);
		expect(session?.expiresAt).toBeLessThanOrEqual(
			Date.now() + OPEN_SESSION_TTL_MS + 1000,
		);
	});

	test("saveSessionDraft persists the cart + getCheckoutSession returns it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		await asA.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [{ variantId, quantity: 3 }],
				paidInPerson: false,
				paymentMethod: "duitnow",
			},
		});

		const read = await asA.query(api.counterCheckout.getCheckoutSession, {
			sessionId,
		});
		expect(read?.draft?.items).toEqual([{ variantId, quantity: 3 }]);
		expect(read?.draft?.paidInPerson).toBe(false);
		expect(read?.draft?.paymentMethod).toBe("duitnow");
	});

	test("saveSessionDraft drops junk lines and slides the idle window", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await boundSession(t, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		// Backdate the expiry so we can prove the save slides it forward.
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - 1000 }),
		);
		await asA.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: {
				items: [
					{ variantId, quantity: 2 },
					{ variantId, quantity: 0 }, // dropped (non-positive)
				],
			},
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.draft?.items).toEqual([{ variantId, quantity: 2 }]);
		expect(session?.expiresAt).toBeGreaterThan(Date.now());
	});

	test("saveSessionDraft is rejected on a non-identified session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const sessionId = await boundSession(t, retailer._id);
		await t.run((ctx) => ctx.db.patch(sessionId, { status: "completed" }));
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.counterCheckout.saveSessionDraft, {
				sessionId,
				draft: { items: [] },
			}),
		).rejects.toThrow(/isn't open for editing/);
	});

	test("listOpenSessions returns bound sessions with draft counts + pairing code", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		const { sessionId: bound, code } = await startWalkIn(t, USER_A, {
			profileName: "Aiman",
		});
		await asA.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId: bound,
			draft: { items: [{ variantId, quantity: 2 }] },
		});

		const open = await asA.query(api.counterCheckout.listOpenSessions, {});
		expect(open).toHaveLength(1);
		expect(open[0].itemCount).toBe(2);
		expect(open[0].displayName).toBe("Aiman");
		expect(open[0].origin).toBe("store_qr");
		expect(open[0].pairingCode).toBe(code);
	});

	test("listOpenSessions excludes completed / cancelled sessions", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		const sessionId = await boundSession(t, retailer._id);
		await asA.mutation(api.counterCheckout.createOrderFromSession, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			paidInPerson: true,
			paymentMethod: "cash",
		}); // → completed

		const open = await asA.query(api.counterCheckout.listOpenSessions, {});
		expect(open).toHaveLength(0);
	});

	test("an idle bound session past its window is swept + drops off the list", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const sessionId = await boundSession(t, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		// Force the idle window into the past, then run the bound-session sweep.
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { expiresAt: Date.now() - 1000 }),
		);
		// Effectively-expired even before the cron runs.
		const open1 = await asA.query(api.counterCheckout.listOpenSessions, {});
		expect(open1).toHaveLength(0);

		await t.mutation(internal.counterCheckout.expireStaleSessions, {
			status: "buyer_identified",
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("expired");
	});

	test("saveSessionDraft is forbidden across tenants", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailerA._id);
		const sessionId = await boundSession(t, retailerA._id);

		// USER_B owns a different store and must not write to USER_A's session.
		await expect(
			t
				.withIdentity({ subject: USER_B })
				.mutation(api.counterCheckout.saveSessionDraft, {
					sessionId,
					draft: { items: [{ variantId, quantity: 1 }] },
				}),
		).rejects.toThrow(/Forbidden/);
	});

	test("listOpenSessions is scoped to the caller's own store", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		await boundSession(t, retailerA._id); // an open session for A only

		const aSees = await t
			.withIdentity({ subject: USER_A })
			.query(api.counterCheckout.listOpenSessions, {});
		expect(aSees).toHaveLength(1);

		// USER_B sees none of A's open checkouts.
		const bSees = await t
			.withIdentity({ subject: USER_B })
			.query(api.counterCheckout.listOpenSessions, {});
		expect(bSees).toHaveLength(0);
	});
});

describe("store QR poster (86ey5m35w)", () => {
	async function ensureToken(t: ReturnType<typeof setup>, userId: string) {
		return t
			.withIdentity({ subject: userId })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
	}

	test("ensure is idempotent; rotate replaces the token and kills the old one", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);

		const first = await ensureToken(t, USER_A);
		expect(first.token).toMatch(/^[A-Za-z0-9]{24}$/);
		// Generate again → same token (the card's button can never rotate by accident).
		const second = await ensureToken(t, USER_A);
		expect(second.token).toBe(first.token);

		const rotated = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.rotateCounterQrToken, {});
		expect(rotated.token).not.toBe(first.token);

		// The OLD poster is dead: its token no longer resolves a store.
		const stale = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token: first.token, waPhone: "60123456789" },
		);
		expect(stale).toEqual({ result: "not_found" });
	});

	test("a poster scan creates a bound walk-in session; a rescan re-claims it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const { token } = await ensureToken(t, USER_A);

		const start = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token, waPhone: "60123456789", profileName: "Aiman" },
		);
		expect(start).toMatchObject({
			result: "started",
			retailerId: retailer._id,
			storeName: "Bearcamp",
			reclaimed: false,
		});
		if (start.result !== "started") throw new Error("unreachable");
		// A short "Letter+Digit" pairing code the buyer shows the cashier.
		expect(start.code).toMatch(/^[A-HJ-NP-Z][2-9]$/);

		const rows = await t.run(async (ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
				)
				.collect(),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].origin).toBe("store_qr");
		expect(rows[0].pairingCode).toBe(start.code);
		expect(rows[0].waPhone).toBe("60123456789");
		expect(rows[0].waProfileName).toBe("Aiman");
		expect(rows[0].isNewCustomer).toBe(true);

		// Rescan → SAME session (no duplicate), same code, flagged reclaimed.
		const again = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token, waPhone: "60123456789" },
		);
		expect(again).toMatchObject({
			result: "started",
			reclaimed: true,
			code: start.code,
		});
		const rowsAfter = await t.run(async (ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
				)
				.collect(),
		);
		expect(rowsAfter).toHaveLength(1);
	});

	test("a returning customer is linked for the history panel", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const customerId = await seedCustomer(
			t,
			retailer._id,
			"60123456789",
			"Aiman",
		);
		const { token } = await ensureToken(t, USER_A);

		await t.mutation(internal.counterCheckout.startSessionFromStoreQr, {
			token,
			waPhone: "60123456789",
		});
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
				)
				.unique(),
		);
		expect(row?.customerId).toBe(customerId);
		expect(row?.isNewCustomer).toBe(false);
	});

	test("pairing codes are unique across a store's concurrent open sessions", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { token } = await ensureToken(t, USER_A);

		const codes = new Set<string>();
		for (let i = 0; i < 8; i++) {
			const res = await t.mutation(
				internal.counterCheckout.startSessionFromStoreQr,
				{ token, waPhone: `6012345${(1000 + i).toString()}` },
			);
			if (res.result !== "started") throw new Error(`unexpected ${res.result}`);
			codes.add(res.code);
		}
		// No collisions among the 8 concurrent open walk-ins.
		expect(codes.size).toBe(8);
	});

	test("unknown token resolves nothing (no store leaked)", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const res = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token: "Zz99Yy88Xx77Ww66Vv55Uu44", waPhone: "60123456789" },
		);
		expect(res).toEqual({ result: "not_found" });
	});

	test("the per-store open walk-in cap returns busy (spam blast radius)", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { token } = await ensureToken(t, USER_A);

		// Fill the cap from distinct phones (each within its own rate limit).
		for (let i = 0; i < 10; i++) {
			const res = await t.mutation(
				internal.counterCheckout.startSessionFromStoreQr,
				{ token, waPhone: `6012345${(1000 + i).toString()}` },
			);
			expect(res).toMatchObject({ result: "started" });
		}
		const over = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token, waPhone: "60123459999" },
		);
		expect(over).toMatchObject({ result: "busy", storeName: "Bearcamp" });
	});

	test("purge deletes dead sessions past retention, keeps recent + completed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const now = Date.now();
		const old = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago — past retention

		const mk = (
			status: "expired" | "cancelled" | "completed",
			expiresAt: number,
		) =>
			t.run(async (ctx) =>
				ctx.db.insert("counterCheckoutSessions", {
					retailerId: retailer._id,
					sellerUserId: USER_A,
					token: `tok_${status}_${expiresAt}`,
					status,
					waPhone: "60123456789",
					expiresAt,
					createdAt: expiresAt - 1000,
					updatedAt: expiresAt,
				}),
			);

		const oldExpired = await mk("expired", old);
		const oldCancelled = await mk("cancelled", old);
		const oldCompleted = await mk("completed", old); // kept — links to an order
		const freshExpired = await mk("expired", now - 1000); // kept — inside retention

		// Sweep both statuses explicitly (deterministic). The first call also
		// self-chains to `cancelled` via the scheduler — same paginated-cron shape
		// (and same harmless post-teardown stderr in convex-test) as the sibling
		// expireStaleSessions test above.
		await t.mutation(internal.counterCheckout.purgeStaleSessions, {
			status: "expired",
		});
		await t.mutation(internal.counterCheckout.purgeStaleSessions, {
			status: "cancelled",
		});

		expect(await t.run((ctx) => ctx.db.get(oldExpired))).toBeNull();
		expect(await t.run((ctx) => ctx.db.get(oldCancelled))).toBeNull();
		expect(await t.run((ctx) => ctx.db.get(oldCompleted))).not.toBeNull();
		expect(await t.run((ctx) => ctx.db.get(freshExpired))).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Identity escape hatches — manual phone entry + anonymous walk-in (86ey8vqp6)
// ---------------------------------------------------------------------------

/** Count the store's open (buyer_identified) sessions for a phone. */
async function openSessionsForPhone(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	waPhone: string,
): Promise<number> {
	return t.run(async (ctx) => {
		const rows = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", retailerId).eq("status", "buyer_identified"),
			)
			.collect();
		return rows.filter((s) => s.waPhone === waPhone).length;
	});
}

/** The pending `notifyCounterOrderCreated` scheduled jobs (with their args). */
async function counterNotifyJobs(
	t: ReturnType<typeof setup>,
): Promise<Array<{ orderId: unknown; includePrivacyNotice?: boolean }>> {
	const jobs = await t.run((ctx) =>
		ctx.db.system.query("_scheduled_functions").collect(),
	);
	return jobs
		.filter((j) => j.name.includes("notifyCounterOrderCreated"))
		.map((j) => j.args[0] as { orderId: unknown; includePrivacyNotice?: boolean });
}

describe("counterCheckout — manual phone entry (86ey8vqp6)", () => {
	test("normalizes a local MY number and re-links an existing customer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		// Existing customer stored in E.164 form (as an inbound scan would).
		await seedCustomer(t, retailer._id, "60123456789", "Aiman");

		// Cashier types the LOCAL form with separators.
		const { sessionId, reclaimed } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "012-345 6789",
				name: "Aiman",
			});
		expect(reclaimed).toBe(false);

		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("buyer_identified");
		expect(session?.origin).toBe("cashier");
		// Keyed identically to the scan bind → existing customer matched.
		expect(session?.waPhone).toBe("60123456789");
		expect(session?.waProfileName).toBe("Aiman");
		expect(session?.isNewCustomer).toBe(false);
		expect(session?.customerId).toBeDefined();
		expect(session?.pairingCode).toBeDefined();
	});

	test("a brand-new buyer binds as new, then the order links the customer once", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 1500 });

		const { sessionId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "0123456789",
				name: "Aiman",
			});
		const preBind = await t.run((ctx) => ctx.db.get(sessionId));
		expect(preBind?.isNewCustomer).toBe(true);
		expect(preBind?.customerId).toBeUndefined();

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});

		// Name flows onto the order snapshot.
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.customer.name).toBe("Aiman");

		// Exactly one customer, aggregated once, seeded with the typed name.
		const customers = await t
			.withIdentity({ subject: USER_A })
			.query(api.customers.list, {
				retailerId: retailer._id,
				sort: "recency",
				paginationOpts: { numItems: 10, cursor: null },
			});
		expect(customers.page).toHaveLength(1);
		expect(customers.page[0].orderCount).toBe(1);
		expect(customers.page[0].waPhone).toBe("60123456789");
		expect(customers.page[0].name).toBe("Aiman");
	});

	test("requires a buyer name", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.counterCheckout.bindSessionManualPhone, {
					waPhone: "0123456789",
					name: "   ",
				}),
		).rejects.toThrow(/name/i);
	});

	test("rejects a name shorter than 3 characters", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.counterCheckout.bindSessionManualPhone, {
					waPhone: "0123456789",
					name: "Jo",
				}),
		).rejects.toThrow(/at least 3/i);
	});

	test("rejects an invalid phone", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.counterCheckout.bindSessionManualPhone, {
					waPhone: "abc",
					name: "Aiman",
				}),
		).rejects.toThrow();
	});

	test("the order confirmation carries the PDPA notice (manual-phone first contact)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 1500 });
		const { sessionId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "0123456789",
				name: "Aiman",
			});
		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});

		const jobs = await counterNotifyJobs(t);
		const mine = jobs.find((j) => j.orderId === orderId);
		expect(mine).toBeDefined();
		// Manual phone = buyer never scanned → notice rides the confirmation.
		expect(mine?.includePrivacyNotice).toBe(true);
	});

	test("a scan after a manual bind re-claims — no duplicate session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { token } = await asUser.mutation(
			api.counterCheckout.ensureCounterQrToken,
			{},
		);

		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "0123456789", name: "Aiman" },
		);

		// Same buyer now scans the poster with their E.164 number.
		const res = await t.mutation(
			internal.counterCheckout.startSessionFromStoreQr,
			{ token, waPhone: "60123456789", profileName: "Aiman" },
		);
		expect(res.result === "started" && res.reclaimed).toBe(true);

		// Still exactly one open session for that buyer — the manual one, resumed.
		expect(await openSessionsForPhone(t, retailer._id, "60123456789")).toBe(1);
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("buyer_identified");
	});
});

describe("counterCheckout — anonymous walk-in (86ey8vqp6)", () => {
	test("creates a no-identity order, touches no customer, sends no WhatsApp", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 2000 });

		const { sessionId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.startAnonymousSession, {});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("buyer_identified");
		expect(session?.waPhone).toBeUndefined();
		expect(session?.customerId).toBeUndefined();

		const { orderId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});

		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("confirmed");
		expect(order?.source).toBe("counter");
		expect(order?.customer.waPhone).toBeUndefined();
		expect(order?.customer.name).toBeUndefined();
		expect(order?.customerId).toBeUndefined();

		// No CRM row created — aggregates stay clean.
		const customers = await t
			.withIdentity({ subject: USER_A })
			.query(api.customers.list, {
				retailerId: retailer._id,
				sort: "recency",
				paginationOpts: { numItems: 10, cursor: null },
			});
		expect(customers.page).toHaveLength(0);

		// No buyer confirmation scheduled — nobody to reach.
		const jobs = await counterNotifyJobs(t);
		expect(jobs.find((j) => j.orderId === orderId)).toBeUndefined();
	});

	test("pay-later is rejected on an anonymous session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 2000 });
		const { sessionId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.startAnonymousSession, {});

		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.counterCheckout.createOrderFromSession, {
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: false,
				}),
		).rejects.toThrow(/paid in person/i);
	});

	test("anonymous session creation is ownership-checked", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		await expect(
			t.mutation(api.counterCheckout.startAnonymousSession, {}),
		).rejects.toThrow();
	});

	test("an inline-set name lands on the anonymous order (no phone, no CRM)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, { price: 2000 });
		const asUser = t.withIdentity({ subject: USER_A });
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.startAnonymousSession,
			{},
		);

		// Cashier types a name on the build screen.
		await asUser.mutation(api.counterCheckout.setSessionCustomerName, {
			sessionId,
			name: "John",
		});
		const read = await asUser.query(api.counterCheckout.getCheckoutSession, {
			sessionId,
		});
		expect(read?.displayName).toBe("John");

		const { orderId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.customer.name).toBe("John");
		// Still no phone + no CRM row — a named cash sale, not a contact.
		expect(order?.customer.waPhone).toBeUndefined();
		const customers = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(customers.page).toHaveLength(0);
	});

	test("startAnonymousSession accepts an initial name", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const { sessionId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.startAnonymousSession, { name: "Jane" });
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.waProfileName).toBe("Jane");
		expect(session?.waPhone).toBeUndefined();
	});

	test("setSessionCustomerName clears on a blank name", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.startAnonymousSession,
			{ name: "Jane" },
		);
		await asUser.mutation(api.counterCheckout.setSessionCustomerName, {
			sessionId,
			name: "  ",
		});
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.waProfileName).toBeUndefined();
	});

	test("setSessionCustomerName rejects a 1–2 char name (server backstop)", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.startAnonymousSession,
			{},
		);
		await expect(
			asUser.mutation(api.counterCheckout.setSessionCustomerName, {
				sessionId,
				name: "Jo",
			}),
		).rejects.toThrow(/at least 3/i);
	});
});
