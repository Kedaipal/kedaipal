/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fulfilmentDateBounds } from "./lib/fulfilmentDate";
import {
	CLAIM_MAX_SENDS,
	CLAIM_RESEND_COOLDOWN_MS,
	CLAIM_RETENTION_MS,
} from "./lib/orderClaims";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_seller_a";
const USER_B = "user_seller_b";
const BUYER_PHONE = "60123456789";

const MY_ADDRESS = {
	line1: "12 Jalan Ampang",
	city: "Kuala Lumpur",
	state: "Selangor",
	postcode: "40450",
};

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "K Frozen Food",
		slug: `kfrozen-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedVariant(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	opts: {
		name?: string;
		price?: number;
		onHand?: number;
		block?: boolean;
		requiresProof?: boolean;
		minNoticeDays?: number;
	} = {},
): Promise<Id<"productVariants">> {
	const asUser = t.withIdentity({ subject: userId });
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name: opts.name ?? "Ribeye MS5",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: opts.block ?? false,
		requiresProof: opts.requiresProof ?? false,
		minNoticeDays: opts.minNoticeDays,
		variants: [
			{ optionValues: [], price: opts.price ?? 8900, onHand: opts.onHand ?? 50 },
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

/** Bind a walk-in session by manual phone — the claim-link entry point. */
async function seedSession(
	t: ReturnType<typeof setup>,
	userId: string,
	opts: { waPhone?: string; name?: string } = {},
): Promise<Id<"counterCheckoutSessions">> {
	const asUser = t.withIdentity({ subject: userId });
	const { sessionId } = await asUser.mutation(
		api.counterCheckout.bindSessionManualPhone,
		{
			waPhone: opts.waPhone ?? BUYER_PHONE,
			name: opts.name ?? "Aina Hamzah",
		},
	);
	return sessionId;
}

async function getClaim(t: ReturnType<typeof setup>, claimId: Id<"orderClaims">) {
	const claim = await t.run((ctx) => ctx.db.get(claimId));
	if (!claim) throw new Error("claim vanished");
	return claim;
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("orderClaims — sendClaim", () => {
	test("freezes seller-keyed lines (incl. overrides) and opens a claim", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			price: 12000,
		});
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		const before = Date.now();
		const { claimId, token, expiresAt } = await asA.mutation(
			api.orderClaims.sendClaim,
			{
				sessionId,
				// Seller adjusted the price down (86eyphh8r) — the claim must freeze
				// the adjusted figure, not the catalog's.
				items: [{ variantId, quantity: 2, unitPrice: 8900 }],
				windowMinutes: 15,
			},
		);
		const claim = await getClaim(t, claimId);
		expect(claim.status).toBe("open");
		expect(claim.waPhone).toBe(BUYER_PHONE);
		expect(claim.buyerName).toBe("Aina Hamzah");
		expect(claim.lines).toHaveLength(1);
		expect(claim.lines[0].price).toBe(8900);
		expect(claim.lines[0].quantity).toBe(2);
		expect(claim.token).toBe(token);
		expect(claim.sentCount).toBe(1);
		expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
		// The chosen window becomes the store default (the dialog says so).
		const updated = await asA.query(api.retailers.getMyRetailer);
		expect(updated?.claimLinkWindowMinutes).toBe(15);
	});

	test("stock is NOT decremented at send (a claim is an offer)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 5,
		});
		const sessionId = await seedSession(t, USER_A);
		await t.withIdentity({ subject: USER_A }).mutation(
			api.orderClaims.sendClaim,
			{
				sessionId,
				items: [{ variantId, quantity: 3 }],
				windowMinutes: 60,
			},
		);
		const variant = await t.run((ctx) => ctx.db.get(variantId));
		expect(variant?.onHand).toBe(5);
	});

	test("refuses an anonymous session — nobody to send the link to", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { sessionId } = await asA.mutation(
			api.counterCheckout.startAnonymousSession,
			{},
		);
		const retailer = await asA.query(api.retailers.getMyRetailer);
		const variantId = await seedVariant(t, USER_A, retailer!._id);
		await expect(
			asA.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/WhatsApp number/);
	});

	test("hard-block stock shortfall refuses at send — never a dead link", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			block: true,
			onHand: 1,
		});
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/in stock/);
	});

	test("a second send supersedes the first open claim (old link dies)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const first = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 15,
		});
		const second = await asA.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 2 }],
			windowMinutes: 15,
		});
		expect((await getClaim(t, first.claimId)).status).toBe("cancelled");
		expect((await getClaim(t, second.claimId)).status).toBe("open");
	});

	test("a foreign seller can't send from someone else's session", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_B }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("an out-of-bounds window is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 1,
			}),
		).rejects.toThrow(/at least/);
	});
});

describe("orderClaims — resend + cancel", () => {
	async function openClaim(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 24 * 60,
			});
		return { claimId, sessionId, retailerId: retailer._id, variantId };
	}

	test("resend is cooled down, then re-sends WITHOUT moving the deadline", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.orderClaims.resendClaim, { claimId }),
		).rejects.toThrow(/moment/);
		const before = await getClaim(t, claimId);
		// Age the last send past the cooldown — the deadline must not move.
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				lastSentAt: before.lastSentAt - CLAIM_RESEND_COOLDOWN_MS - 1000,
			}),
		);
		await asA.mutation(api.orderClaims.resendClaim, { claimId });
		const after = await getClaim(t, claimId);
		expect(after.sentCount).toBe(2);
		expect(after.expiresAt).toBe(before.expiresAt);
	});

	test("the hard send cap refuses even after the cooldown", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				sentCount: CLAIM_MAX_SENDS,
				lastSentAt: Date.now() - CLAIM_RESEND_COOLDOWN_MS * 2,
			}),
		);
		await expect(
			t
				.withIdentity({ subject: USER_A })
				.mutation(api.orderClaims.resendClaim, { claimId }),
		).rejects.toThrow(/maximum/);
	});

	test("cancel releases an open claim; the buyer page reads cancelled", async () => {
		const t = setup();
		const { claimId } = await openClaim(t);
		const token = (await getClaim(t, claimId)).token;
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.cancelClaim, { claimId });
		expect((await getClaim(t, claimId)).status).toBe("cancelled");
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("cancelled");
		expect(payload?.open).toBeUndefined();
	});

	test("counter sale + session cancel both kill the open claim", async () => {
		const t = setup();
		const { claimId, sessionId, variantId } = await openClaim(t);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.counterCheckout.createOrderFromSession, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			paidInPerson: true,
		});
		expect((await getClaim(t, claimId)).status).toBe("cancelled");

		// And the dismissal path — a fresh session + claim at the SAME store
		// (a different buyer, so the manual bind doesn't re-claim the first).
		const secondSession = await seedSession(t, USER_A, {
			waPhone: "60198765432",
			name: "Mira Razak",
		});
		const { claimId: secondClaim } = await asA.mutation(
			api.orderClaims.sendClaim,
			{
				sessionId: secondSession,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			},
		);
		await asA.mutation(api.counterCheckout.cancelCheckoutSession, {
			sessionId: secondSession,
		});
		expect((await getClaim(t, secondClaim)).status).toBe("cancelled");
	});
});

describe("orderClaims — getByToken", () => {
	test("unknown token answers null (route 404s)", async () => {
		const t = setup();
		expect(
			await t.query(api.orderClaims.getByToken, { token: "nope" }),
		).toBeNull();
	});

	test("open payload carries frozen lines + the raised notice floor", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, {
			minNoticeDays: 3,
			price: 5000,
		});
		const sessionId = await seedSession(t, USER_A);
		const { token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2 }],
				windowMinutes: 60,
			});
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("open");
		expect(payload?.open?.itemsTotal).toBe(10000);
		expect(payload?.open?.waPhone).toBe(BUYER_PHONE);
		// Store notice 0 raised to the product's 3-day override.
		expect(payload?.store.minNoticeDays).toBe(3);
	});

	test("an open claim past its deadline reads expired before the cron flips it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		const payload = await t.query(api.orderClaims.getByToken, { token });
		expect(payload?.status).toBe("expired");
		expect(payload?.open).toBeUndefined();
	});
});

describe("orderClaims — commit", () => {
	async function sendOne(
		t: ReturnType<typeof setup>,
		opts: Parameters<typeof seedVariant>[3] = {},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id, opts);
		const sessionId = await seedSession(t, USER_A);
		const { claimId, token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 2, unitPrice: 8900 }],
				windowMinutes: 60,
			});
		return { retailer, variantId, sessionId, claimId, token };
	}

	test("commits the order at the LOCKED price even after a catalog re-price", async () => {
		const t = setup();
		const { variantId, sessionId, claimId, token } = await sendOne(t, {
			block: true,
			onHand: 10,
			price: 12000,
		});
		// Seller re-prices the catalog between send and open — the claim's frozen
		// 8900 must still be charged (the whole point of "price locked").
		await t.run((ctx) => ctx.db.patch(variantId, { price: 99900 }));

		const result = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(result.shortId).toMatch(/^ORD-/);

		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order).not.toBeNull();
		expect(order?.source).toBe("claim");
		expect(order?.items[0].price).toBe(8900);
		expect(order?.subtotal).toBe(17800);
		expect(order?.customer.waPhone).toBe(BUYER_PHONE);
		// No template env in tests → the legacy pending path (same as storefront).
		expect(order?.status).toBe("pending");
		// Stock decremented at COMMIT.
		const variant = await t.run((ctx) => ctx.db.get(variantId));
		expect(variant?.onHand).toBe(8);
		// Claim + session both settled.
		expect((await getClaim(t, claimId)).status).toBe("completed");
		const session = await t.run((ctx) => ctx.db.get(sessionId));
		expect(session?.status).toBe("completed");
		// Customer aggregates linked.
		const customer = await t.run((ctx) =>
			ctx.db
				.query("customers")
				.withIndex("by_retailer_phone", (q) =>
					q
						.eq("retailerId", order!.retailerId)
						.eq("waPhone", BUYER_PHONE),
				)
				.unique(),
		);
		expect(customer?.orderCount).toBe(1);
	});

	test("confirm-push env set → the order commits confirmed with the push stamped", async () => {
		vi.stubEnv("WHATSAPP_ORDER_CONFIRM_TEMPLATE", "order_confirmation_utility");
		const t = setup();
		const { claimId, token } = await sendOne(t);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order?.status).toBe("confirmed");
		expect(order?.confirmationPushStatus).toBe("sending");
	});

	test("a second commit is idempotent — same order handed back", async () => {
		const t = setup();
		const { token } = await sendOne(t);
		const first = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const second = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(second.shortId).toBe(first.shortId);
	});

	test("expired and cancelled claims refuse to commit", async () => {
		const t = setup();
		const { claimId, token } = await sendOne(t);
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/expired/);

		const t2 = setup();
		const second = await sendOne(t2);
		await t2
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.cancelClaim, { claimId: second.claimId });
		await expect(
			t2.mutation(api.orderClaims.commit, {
				token: second.token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/no longer active/);
	});

	test("sold-out-at-commit names the line and refuses (no silent drop)", async () => {
		const t = setup();
		const { variantId, token } = await sendOne(t, {
			block: true,
			onHand: 10,
		});
		await t.run((ctx) => ctx.db.patch(variantId, { onHand: 1 }));
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
			}),
		).rejects.toThrow(/sold out/);
	});

	test("min-order rules do NOT apply (seller keyed the cart)", async () => {
		const t = setup();
		const { retailer, token } = await sendOne(t);
		// A floor far above the claim total — a storefront cart would bounce.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { minOrderValue: 1_000_000 });
		});
		const result = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(result.shortId).toMatch(/^ORD-/);
	});

	test("no mockup gate on a requiresProof line (agreed in the live)", async () => {
		const t = setup();
		const { claimId, token } = await sendOne(t, { requiresProof: true });
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const order = await t.run(async (ctx) => {
			const claim = await ctx.db.get(claimId);
			return claim?.orderId ? await ctx.db.get(claim.orderId) : null;
		});
		expect(order?.mockupStatus).toBeUndefined();
	});

	test("the notice floor (store ∨ product) rejects a too-soon date", async () => {
		const t = setup();
		const { token } = await sendOne(t, { minNoticeDays: 3 });
		// Today is inside the 3-day product notice → refused.
		const today = fulfilmentDateBounds(0).min;
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
				deliveryAddress: MY_ADDRESS,
				fulfilmentDate: today,
			}),
		).rejects.toThrow();
	});

	test("delivery needs an address; self_collect refuses one", async () => {
		const t = setup();
		const { token } = await sendOne(t);
		await expect(
			t.mutation(api.orderClaims.commit, {
				token,
				deliveryMethod: "delivery",
			}),
		).rejects.toThrow(/address/i);
	});
});

describe("orderClaims — listClaims + crons", () => {
	test("listClaims shows the live-judged status; foreign sellers see nothing", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});

		const mine = await t
			.withIdentity({ subject: USER_A })
			.query(api.orderClaims.listClaims, {});
		expect(mine).toHaveLength(1);
		expect(mine[0].status).toBe("open");

		const theirs = await t
			.withIdentity({ subject: USER_B })
			.query(api.orderClaims.listClaims, {});
		expect(theirs).toHaveLength(0);

		// Past-deadline open row reads Expired in the list before any sweep.
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		const after = await t
			.withIdentity({ subject: USER_A })
			.query(api.orderClaims.listClaims, {});
		expect(after[0].status).toBe("expired");
	});

	test("expire cron flips past-deadline claims; purge deletes old dead ones only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const variantId = await seedVariant(t, USER_A, retailer._id);
		const sessionId = await seedSession(t, USER_A);
		const { claimId } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await t.run((ctx) =>
			ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }),
		);
		await t.mutation(internal.orderClaims.expireStaleClaims, {});
		expect((await getClaim(t, claimId)).status).toBe("expired");

		// Fresh-dead: retained. Old-dead: purged (PII).
		await t.mutation(internal.orderClaims.purgeStaleClaims, {});
		expect(await t.run((ctx) => ctx.db.get(claimId))).not.toBeNull();
		await t.run((ctx) =>
			ctx.db.patch(claimId, {
				expiresAt: Date.now() - CLAIM_RETENTION_MS - 1000,
			}),
		);
		await t.mutation(internal.orderClaims.purgeStaleClaims, {});
		expect(await t.run((ctx) => ctx.db.get(claimId))).toBeNull();
	});
});
