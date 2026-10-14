// Bulk promotions (`z8r3fducfd`) — put many products on one promotion, edit
// it and end it as one. See docs/promo-price.md#promotions-bulk.
//
// THE PROMOTION IS A HANDLE, NOT A PRICE. Every write here fans out to the
// existing per-product `products.promo` config and per-variant `promoPrice`
// through `sanitizePromo`, and `convex/lib/promo.ts` (`effectivePrice`) stays
// the one place a price is decided. Nothing on the storefront, the order
// doors or the tally knows promotions exist.
//
// THE QUEUE. Applying and clearing are batched (`processQueue`): a member row
// is `pending` until its prices are written and `clearing` until they are
// taken off. The first batch runs inside the seller's own mutation, so a
// promotion of a few dozen products is live the moment they tap; anything
// past `PROMOTION_BATCH_WRITES` finishes in scheduled continuations, and the
// dashboard shows "Applying…" until it does.
//
// GATES. Setting (create / update / add) is Pro, like the single-product
// promo; ending and removing never are, so a store that dropped to Starter
// can always switch a sale off. Every write takes the lapsed-store lock,
// exactly as `products.update` does. No credit gate: the catalogue is paid
// for by the subscription (creditLockCoverage.test.ts).

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import { featuresForPlan } from "./lib/plans";
import { effectiveKind } from "./lib/productKind";
import { promoPhase, sanitizePromo } from "./lib/promo";
import {
	MAX_PROMOTION_PRICES,
	MAX_PROMOTION_PRODUCTS,
	memberPromoInput,
	PROMOTION_BATCH_WRITES,
	type PromotionTerms,
	promotionIsOpen,
	targetPromoPrice,
} from "./lib/promotions";
import { rateLimiter } from "./lib/rateLimiter";
import { variantLabel } from "./lib/variant";
import {
	assertPlanFeature,
	assertSubscriptionActive,
	getAccess,
} from "./subscriptions";

const termsValidator = {
	label: v.optional(v.string()),
	percentOff: v.number(),
	startsAt: v.optional(v.number()),
	endsAt: v.optional(v.number()),
	unitCap: v.optional(v.number()),
	maxPerOrder: v.optional(v.number()),
	payWithinMinutes: v.optional(v.number()),
};

const memberInputValidator = v.object({
	productId: v.id("products"),
	prices: v.array(
		v.object({ variantId: v.id("productVariants"), promoPrice: v.number() }),
	),
});

type MemberInput = {
	productId: Id<"products">;
	prices: Array<{ variantId: Id<"productVariants">; promoPrice: number }>;
};

type TermsInput = PromotionTerms & { percentOff: number };

function listingOf(product: Doc<"products">) {
	return {
		isBooking: effectiveKind(product.kind) === "booking",
		isEvent: product.event !== undefined,
	};
}

/** Validate the shared terms once, up front, with the same sanitizer each
 * product's write will run — so a bad window refuses the whole save with
 * one sentence instead of failing product by product mid-queue. */
function assertTerms(terms: TermsInput, now: number): void {
	if (
		!Number.isInteger(terms.percentOff) ||
		terms.percentOff < 1 ||
		terms.percentOff > 99
	)
		throw new ConvexError("The discount must be a whole percent from 1 to 99.");
	try {
		sanitizePromo(
			memberPromoInput(terms, { isBooking: false, isEvent: false }),
			undefined,
			now,
		);
	} catch (err) {
		throw new ConvexError((err as Error).message);
	}
}

/** The open promotion a product sits in, if any (other than `except`). */
async function openMembershipOf(
	ctx: QueryCtx,
	productId: Id<"products">,
	now: number,
	except?: Id<"promotions">,
): Promise<{
	member: Doc<"promotionMembers">;
	promotion: Doc<"promotions">;
} | null> {
	const rows = await ctx.db
		.query("promotionMembers")
		.withIndex("by_product", (q) => q.eq("productId", productId))
		.collect();
	for (const member of rows) {
		if (member.state !== "pending" && member.state !== "applied") continue;
		if (member.promotionId === except) continue;
		const promotion = await ctx.db.get(member.promotionId);
		if (promotion && promotionIsOpen(promotion, now))
			return { member, promotion };
	}
	return null;
}

/** A product carrying its OWN sale (set in its product form, not by a
 * promotion) that hasn't ended yet. Joining a promotion replaces it, so that
 * needs the same explicit "move" as leaving another promotion. */
function hasOwnSale(product: Doc<"products">, now: number): boolean {
	const phase = promoPhase(product.promo, now);
	return phase === "live" || phase === "scheduled";
}

/**
 * Check and stage a set of new members. Every product must be the store's,
 * not archived, and either free or explicitly listed in `move` — a product
 * already on another open promotion or on its own sale is never taken over
 * silently. Prices are validated against the product's real variants.
 */
async function stageMembers(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	promotionId: Id<"promotions"> | undefined,
	members: MemberInput[],
	move: Id<"products">[],
	now: number,
): Promise<{
	staged: Array<{ productId: Id<"products">; prices: MemberInput["prices"] }>;
	moveFrom: Array<Id<"promotionMembers">>;
}> {
	const seen = new Set<string>();
	const moveSet = new Set<string>(move);
	const staged: Array<{
		productId: Id<"products">;
		prices: MemberInput["prices"];
	}> = [];
	const moveFrom: Array<Id<"promotionMembers">> = [];
	for (const input of members) {
		if (seen.has(input.productId))
			throw new ConvexError("A product appears twice in this promotion.");
		seen.add(input.productId);
		const product = await ctx.db.get(input.productId);
		if (!product || product.retailerId !== retailerId)
			throw new ConvexError("One of these products no longer exists.");
		if (!product.active)
			throw new ConvexError(
				`"${product.name}" is archived — restore it before putting it on sale.`,
			);

		const other = await openMembershipOf(ctx, product._id, now, promotionId);
		if (other) {
			if (!moveSet.has(product._id))
				throw new ConvexError(
					`"${product.name}" is already on ${other.promotion.label ?? "another promotion"}. Move it here to replace that sale.`,
				);
			moveFrom.push(other.member._id);
		} else if (hasOwnSale(product, now) && !moveSet.has(product._id)) {
			throw new ConvexError(
				`"${product.name}" already has its own sale. Move it here to replace that sale.`,
			);
		}

		const variants = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", product._id))
			.collect();
		const byId = new Map(variants.map((vr) => [vr._id as string, vr]));
		const prices: MemberInput["prices"] = [];
		for (const line of input.prices) {
			const variant = byId.get(line.variantId);
			if (!variant)
				throw new ConvexError(
					`A choice of "${product.name}" changed while you were editing. Review the prices again.`,
				);
			if (targetPromoPrice(variant, line.promoPrice) === undefined)
				throw new ConvexError(
					`A sale price for "${product.name}" must be above zero and below its normal price.`,
				);
			prices.push(line);
		}
		staged.push({ productId: product._id, prices });
	}
	return { staged, moveFrom };
}

function assertSizes(memberCount: number, priceCount: number): void {
	if (memberCount === 0)
		throw new ConvexError("Pick at least one product for the promotion.");
	if (memberCount > MAX_PROMOTION_PRODUCTS)
		throw new ConvexError(
			`A promotion can hold up to ${MAX_PROMOTION_PRODUCTS} products.`,
		);
	if (priceCount > MAX_PROMOTION_PRICES)
		throw new ConvexError(
			`That's more than ${MAX_PROMOTION_PRICES.toLocaleString("en-MY")} sale prices in one promotion — split it into two.`,
		);
}

/** Write one member's prices onto its product. Returns the writes it made. */
async function applyMember(
	ctx: MutationCtx,
	promotion: Doc<"promotions">,
	member: Doc<"promotionMembers">,
	now: number,
): Promise<number> {
	const product = await ctx.db.get(member.productId);
	// Archived or deleted since it was staged: nothing to write, and nothing
	// of ours on the product to clear later.
	if (!product?.active) {
		await ctx.db.patch(member._id, { state: "cleared", updatedAt: now });
		await bumpProductCount(ctx, promotion._id, -1, now);
		return 1;
	}
	let promo: Doc<"products">["promo"];
	try {
		promo = sanitizePromo(
			memberPromoInput(promotion, listingOf(product)),
			product.promo,
			now,
		);
	} catch {
		// The window closed while the queue was still running (an end time a
		// few seconds out). The promotion reads as ended; leave the product.
		await ctx.db.patch(member._id, { state: "cleared", updatedAt: now });
		return 1;
	}
	await ctx.db.patch(product._id, { promo, updatedAt: now });
	const prices = new Map(
		member.prices.map((p) => [p.variantId as string, p.promoPrice]),
	);
	const variants = await ctx.db
		.query("productVariants")
		.withIndex("by_product", (q) => q.eq("productId", product._id))
		.collect();
	let writes = 2;
	for (const variant of variants) {
		// A variant the promotion doesn't price is written as NOT on sale —
		// including one that carried a price from the product's own earlier
		// sale. The promotion defines this product's prices while it runs.
		const target = targetPromoPrice(variant, prices.get(variant._id));
		if (variant.promoPrice === target) continue;
		await ctx.db.patch(variant._id, { promoPrice: target, updatedAt: now });
		writes++;
	}
	await ctx.db.patch(member._id, {
		state: "applied",
		runId: promo?.runId,
		updatedAt: now,
	});
	return writes;
}

/** Take one member's sale off its product — only while the product still
 * carries THIS promotion's run. A product the seller has since re-priced by
 * hand, or that another promotion took over, is left exactly as it is. */
async function clearMember(
	ctx: MutationCtx,
	member: Doc<"promotionMembers">,
	now: number,
): Promise<number> {
	const product = await ctx.db.get(member.productId);
	let writes = 1;
	if (
		product?.promo !== undefined &&
		member.runId !== undefined &&
		product.promo.runId === member.runId
	) {
		await ctx.db.patch(product._id, { promo: undefined, updatedAt: now });
		writes++;
		const variants = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", product._id))
			.collect();
		for (const variant of variants) {
			if (variant.promoPrice === undefined) continue;
			await ctx.db.patch(variant._id, { promoPrice: undefined, updatedAt: now });
			writes++;
		}
	}
	await ctx.db.patch(member._id, { state: "cleared", updatedAt: now });
	return writes;
}

/**
 * Work the queue for one promotion until the batch budget is spent, then hand
 * the rest to a scheduled continuation. Clearing runs before applying: an
 * "End now" must take prices OFF before anything else is written.
 */
async function runQueue(
	ctx: MutationCtx,
	promotionId: Id<"promotions">,
): Promise<void> {
	const promotion = await ctx.db.get(promotionId);
	if (!promotion) return;
	const now = Date.now();
	let budget = PROMOTION_BATCH_WRITES;
	for (const state of ["clearing", "pending"] as const) {
		while (budget > 0) {
			const batch = await ctx.db
				.query("promotionMembers")
				.withIndex("by_promotion_state", (q) =>
					q.eq("promotionId", promotionId).eq("state", state),
				)
				.take(10);
			if (batch.length === 0) break;
			for (const member of batch) {
				if (budget <= 0) break;
				budget -=
					state === "clearing"
						? await clearMember(ctx, member, now)
						: await applyMember(ctx, promotion, member, now);
			}
		}
	}
	const left = await ctx.db
		.query("promotionMembers")
		.withIndex("by_promotion_state", (q) =>
			q.eq("promotionId", promotionId).eq("state", "clearing"),
		)
		.first();
	const leftPending = await ctx.db
		.query("promotionMembers")
		.withIndex("by_promotion_state", (q) =>
			q.eq("promotionId", promotionId).eq("state", "pending"),
		)
		.first();
	if (left || leftPending)
		await ctx.scheduler.runAfter(0, internal.promotions.processQueue, {
			promotionId,
		});
}

/** Continuation for a promotion too big for one transaction. */
export const processQueue = internalMutation({
	args: { promotionId: v.id("promotions") },
	handler: async (ctx, { promotionId }): Promise<void> => {
		await runQueue(ctx, promotionId);
	},
});

async function insertMembers(
	ctx: MutationCtx,
	promotion: Doc<"promotions">,
	staged: Array<{ productId: Id<"products">; prices: MemberInput["prices"] }>,
	moveFrom: Array<Id<"promotionMembers">>,
	now: number,
): Promise<void> {
	// The product's old promotion lets go WITHOUT clearing — this one is
	// about to overwrite the product, and clearing first would flash it to
	// full price between the two writes.
	for (const id of moveFrom) {
		const left = await ctx.db.get(id);
		await ctx.db.patch(id, { state: "moved", updatedAt: now });
		if (left) await bumpProductCount(ctx, left.promotionId, -1, now);
	}
	await bumpProductCount(ctx, promotion._id, staged.length, now);
	for (const row of staged)
		await ctx.db.insert("promotionMembers", {
			promotionId: promotion._id,
			retailerId: promotion.retailerId,
			productId: row.productId,
			prices: row.prices,
			state: "pending",
			createdAt: now,
			updatedAt: now,
		});
}

async function bumpProductCount(
	ctx: MutationCtx,
	promotionId: Id<"promotions">,
	delta: number,
	now: number,
): Promise<void> {
	const row = await ctx.db.get(promotionId);
	if (!row || delta === 0) return;
	await ctx.db.patch(promotionId, {
		productCount: Math.max(0, row.productCount + delta),
		updatedAt: now,
	});
}

async function openMembers(
	ctx: QueryCtx,
	promotionId: Id<"promotions">,
): Promise<Doc<"promotionMembers">[]> {
	const [pending, applied] = await Promise.all(
		(["pending", "applied"] as const).map((state) =>
			ctx.db
				.query("promotionMembers")
				.withIndex("by_promotion_state", (q) =>
					q.eq("promotionId", promotionId).eq("state", state),
				)
				.collect(),
		),
	);
	return [...pending, ...applied];
}

async function loadOwnedPromotion(
	ctx: QueryCtx,
	promotionId: Id<"promotions">,
): Promise<Doc<"promotions">> {
	const promotion = await ctx.db.get(promotionId);
	if (!promotion) throw new ConvexError("That promotion no longer exists.");
	return promotion;
}

/**
 * The start a promotion stores. Always CONCRETE, never "open": each member's
 * `sanitizePromo` keeps a product's run (and so its unit-cap pool) only while
 * the window it is given is identical to the one it already has, and a capped
 * "start now" product stamps its own start. A promotion that left its start
 * open would hand every later edit an `undefined` against that stamp — and a
 * mere rename would reset every product's sold count (caught by test).
 *
 * "Now" on an EDIT means "keep running from when it started", not "restart":
 * an already-running start is kept; a future one is pulled forward to now.
 */
function concreteStart(
	requested: number | undefined,
	current: number | undefined,
	now: number,
): number {
	if (requested !== undefined) return requested;
	if (current !== undefined && current <= now) return current;
	return now;
}

function termsPatch(terms: TermsInput, startsAt: number) {
	return {
		label: terms.label?.trim() || undefined,
		percentOff: terms.percentOff,
		startsAt,
		endsAt: terms.endsAt,
		unitCap: terms.unitCap,
		maxPerOrder: terms.maxPerOrder,
		payWithinMinutes: terms.payWithinMinutes,
	};
}

// --- Writes -----------------------------------------------------------------

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		...termsValidator,
		members: v.array(memberInputValidator),
		/** Products the seller chose to MOVE here from another promotion or
		 * from their own sale. Anything else already on sale is refused. */
		move: v.optional(v.array(v.id("products"))),
	},
	handler: async (
		ctx,
		{ retailerId, members, move, ...terms },
	): Promise<Id<"promotions">> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "products",
			level: "write",
		});
		await rateLimiter.limit(ctx, "productWrite", {
			key: access.userId,
			throws: true,
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, retailerId);
			await assertPlanFeature(ctx, retailerId, "promo");
		}
		const now = Date.now();
		assertTerms(terms, now);
		assertSizes(
			members.length,
			members.reduce((n, m) => n + m.prices.length, 0),
		);
		const { staged, moveFrom } = await stageMembers(
			ctx,
			retailerId,
			undefined,
			members,
			move ?? [],
			now,
		);
		const promotionId = await ctx.db.insert("promotions", {
			retailerId,
			productCount: 0,
			...termsPatch(terms, concreteStart(terms.startsAt, undefined, now)),
			createdByUserId: access.userId,
			createdAt: now,
			updatedAt: now,
		});
		const promotion = await loadOwnedPromotion(ctx, promotionId);
		await insertMembers(ctx, promotion, staged, moveFrom, now);
		await runQueue(ctx, promotionId);
		await logAdminAction(ctx, access, "promotions.create", promotionId);
		return promotionId;
	},
});

/** Change the terms and re-price the current members. The review step sends
 * every member's prices (seeded from what each product carries now, so a
 * per-product override the seller made in a product form survives). A
 * window change mints a fresh run — and so a fresh unit-cap pool — per
 * product, by `sanitizePromo`'s rule; a label or cap edit keeps the pool. */
export const update = mutation({
	args: {
		promotionId: v.id("promotions"),
		...termsValidator,
		members: v.array(memberInputValidator),
	},
	handler: async (ctx, { promotionId, members, ...terms }): Promise<void> => {
		const promotion = await loadOwnedPromotion(ctx, promotionId);
		const access = await requireRetailerAccess(ctx, promotion.retailerId, {
			area: "products",
			level: "write",
		});
		await rateLimiter.limit(ctx, "productWrite", {
			key: access.userId,
			throws: true,
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, promotion.retailerId);
			await assertPlanFeature(ctx, promotion.retailerId, "promo");
		}
		const now = Date.now();
		if (!promotionIsOpen(promotion, now))
			throw new ConvexError(
				"This promotion has ended. Run it again to start a new one.",
			);
		assertTerms(terms, now);
		const current = await openMembers(ctx, promotionId);
		const byProduct = new Map(current.map((m) => [m.productId as string, m]));
		assertSizes(
			members.length,
			members.reduce((n, m) => n + m.prices.length, 0),
		);
		for (const input of members) {
			if (!byProduct.has(input.productId))
				throw new ConvexError(
					"A product left this promotion while you were editing. Review it again.",
				);
		}
		// Validate prices against the real variants (no moves on an edit: every
		// product is already a member, so `move` is everything).
		const { staged } = await stageMembers(
			ctx,
			promotion.retailerId,
			promotionId,
			members,
			members.map((m) => m.productId),
			now,
		);
		await ctx.db.patch(promotionId, {
			...termsPatch(
				terms,
				concreteStart(terms.startsAt, promotion.startsAt, now),
			),
			updatedAt: now,
		});
		for (const row of staged) {
			const member = byProduct.get(row.productId);
			if (!member) continue;
			await ctx.db.patch(member._id, {
				prices: row.prices,
				state: "pending",
				updatedAt: now,
			});
		}
		await runQueue(ctx, promotionId);
		await logAdminAction(ctx, access, "promotions.update", promotionId);
	},
});

export const addProducts = mutation({
	args: {
		promotionId: v.id("promotions"),
		members: v.array(memberInputValidator),
		move: v.optional(v.array(v.id("products"))),
	},
	handler: async (ctx, { promotionId, members, move }): Promise<void> => {
		const promotion = await loadOwnedPromotion(ctx, promotionId);
		const access = await requireRetailerAccess(ctx, promotion.retailerId, {
			area: "products",
			level: "write",
		});
		await rateLimiter.limit(ctx, "productWrite", {
			key: access.userId,
			throws: true,
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, promotion.retailerId);
			await assertPlanFeature(ctx, promotion.retailerId, "promo");
		}
		const now = Date.now();
		if (!promotionIsOpen(promotion, now))
			throw new ConvexError(
				"This promotion has ended. Run it again to start a new one.",
			);
		const current = await openMembers(ctx, promotionId);
		const already = new Set(current.map((m) => m.productId as string));
		if (members.some((m) => already.has(m.productId)))
			throw new ConvexError("One of these products is already in this promotion.");
		const currentPrices = current.reduce((n, m) => n + m.prices.length, 0);
		assertSizes(
			current.length + members.length,
			currentPrices + members.reduce((n, m) => n + m.prices.length, 0),
		);
		const { staged, moveFrom } = await stageMembers(
			ctx,
			promotion.retailerId,
			promotionId,
			members,
			move ?? [],
			now,
		);
		await insertMembers(ctx, promotion, staged, moveFrom, now);
		await ctx.db.patch(promotionId, { updatedAt: now });
		await runQueue(ctx, promotionId);
		await logAdminAction(ctx, access, "promotions.addProducts", promotionId);
	},
});

/** Take products out — never Pro-gated (switching a sale off is always open). */
export const removeProducts = mutation({
	args: {
		promotionId: v.id("promotions"),
		productIds: v.array(v.id("products")),
	},
	handler: async (ctx, { promotionId, productIds }): Promise<void> => {
		const promotion = await loadOwnedPromotion(ctx, promotionId);
		const access = await requireRetailerAccess(ctx, promotion.retailerId, {
			area: "products",
			level: "write",
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, promotion.retailerId);
		}
		const now = Date.now();
		const wanted = new Set<string>(productIds);
		let removed = 0;
		for (const member of await openMembers(ctx, promotionId)) {
			if (!wanted.has(member.productId)) continue;
			// Never applied: nothing of ours is on the product.
			await ctx.db.patch(member._id, {
				state: member.state === "applied" ? "clearing" : "cleared",
				removedAt: now,
				updatedAt: now,
			});
			removed++;
		}
		await bumpProductCount(ctx, promotionId, -removed, now);
		await runQueue(ctx, promotionId);
		await logAdminAction(ctx, access, "promotions.removeProducts", promotionId);
	},
});

/** "End now" — every product back to its normal price. Never Pro-gated. */
export const end = mutation({
	args: { promotionId: v.id("promotions") },
	handler: async (ctx, { promotionId }): Promise<void> => {
		const promotion = await loadOwnedPromotion(ctx, promotionId);
		const access = await requireRetailerAccess(ctx, promotion.retailerId, {
			area: "products",
			level: "write",
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, promotion.retailerId);
		}
		if (promotion.endedAt !== undefined) return;
		const now = Date.now();
		await ctx.db.patch(promotionId, { endedAt: now, updatedAt: now });
		for (const member of await openMembers(ctx, promotionId))
			await ctx.db.patch(member._id, {
				state: member.state === "applied" ? "clearing" : "cleared",
				updatedAt: now,
			});
		await runQueue(ctx, promotionId);
		await logAdminAction(ctx, access, "promotions.end", promotionId);
	},
});

// --- Reads ------------------------------------------------------------------

async function queueCounts(ctx: QueryCtx, promotionId: Id<"promotions">) {
	const count = async (state: Doc<"promotionMembers">["state"]) =>
		(
			await ctx.db
				.query("promotionMembers")
				.withIndex("by_promotion_state", (q) =>
					q.eq("promotionId", promotionId).eq("state", state),
				)
				.collect()
		).length;
	const [pending, applied, clearing, cleared] = await Promise.all([
		count("pending"),
		count("applied"),
		count("clearing"),
		count("cleared"),
	]);
	return { pending, applied, clearing, cleared };
}

/** Is any member of this promotion in `state`? One index read, never a count. */
async function anyInState(
	ctx: QueryCtx,
	promotionId: Id<"promotions">,
	state: "pending" | "clearing",
): Promise<boolean> {
	return (
		(await ctx.db
			.query("promotionMembers")
			.withIndex("by_promotion_state", (q) =>
				q.eq("promotionId", promotionId).eq("state", state),
			)
			.first()) !== null
	);
}

/** The Promotions home: newest first, each row phased on the client's own
 * clock (`promotionPhase`). Reads ONE document per promotion plus two
 * existence checks — never its members, which can number 200 each. */
export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "products",
			level: "read",
		});
		const plan = (await getAccess(ctx, retailerId)).plan;
		const rows = await ctx.db
			.query("promotions")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(100);
		const promotions = await Promise.all(
			rows.map(async (p) => {
				const [pending, clearing] = await Promise.all([
					anyInState(ctx, p._id, "pending"),
					anyInState(ctx, p._id, "clearing"),
				]);
				// The phase rule only asks "is there any?", so 1 stands for yes.
				const queue = { pending: pending ? 1 : 0, clearing: clearing ? 1 : 0 };
				return {
					_id: p._id,
					label: p.label,
					percentOff: p.percentOff,
					startsAt: p.startsAt,
					endsAt: p.endsAt,
					endedAt: p.endedAt,
					createdAt: p.createdAt,
					unitCap: p.unitCap,
					queue,
					// Products it holds, or — once it's over — ran on.
					productCount: p.productCount,
				};
			}),
		);
		return { promotions, pausedByPlan: !featuresForPlan(plan).promo };
	},
});

function variantRow(variant: Doc<"productVariants">) {
	return {
		_id: variant._id,
		label: variant.isCustom
			? (variant.customLabel ?? "Custom")
			: variantLabel(variant.optionValues),
		price: variant.price,
		promoPrice: variant.promoPrice,
		active: variant.active,
	};
}

/** One promotion with its products and every line's list and sale price. */
export const get = query({
	args: { promotionId: v.id("promotions") },
	handler: async (ctx, { promotionId }) => {
		const promotion = await ctx.db.get(promotionId);
		if (!promotion) return null;
		await requireRetailerAccess(ctx, promotion.retailerId, {
			area: "products",
			level: "read",
		});
		const plan = (await getAccess(ctx, promotion.retailerId)).plan;
		const queue = await queueCounts(ctx, promotionId);
		const ended =
			promotion.endedAt !== undefined || !promotionIsOpen(promotion, Date.now());
		// Ended: every product it ENDED on — `cleared` after "End now", still
		// `applied` when its window simply ran out. `moved` ones left for
		// another promotion and belong to that one's history instead, and
		// ones taken out with × (`removedAt`) had left before it ended — the
		// detail page would otherwise list more products than its own count,
		// and "Run again" would quietly put them back on sale.
		const members = ended
			? (
					await ctx.db
						.query("promotionMembers")
						.withIndex("by_promotion_state", (q) =>
							q.eq("promotionId", promotionId),
						)
						.collect()
				).filter(
					(m) =>
						m.state !== "moved" &&
						m.state !== "pending" &&
						m.removedAt === undefined,
				)
			: await openMembers(ctx, promotionId);
		const products = await Promise.all(
			members.map(async (member) => {
				const product = await ctx.db.get(member.productId);
				if (!product?.active) return null;
				const variants = await ctx.db
					.query("productVariants")
					.withIndex("by_product", (q) => q.eq("productId", product._id))
					.collect();
				return {
					productId: product._id,
					name: product.name,
					...listingOf(product),
					state: member.state,
					// This promotion's reviewed prices (what "Run again" and a
					// re-review start from), and each line as it stands now.
					prices: member.prices,
					// Still carrying our run? If not, the seller re-priced it by
					// hand since — the detail page says so instead of guessing.
					ours:
						member.runId !== undefined &&
						product.promo?.runId === member.runId,
					variants: variants
						.filter((vr) => vr.active)
						.sort((a, b) => a.sortOrder - b.sortOrder)
						.map(variantRow),
				};
			}),
		);
		return {
			promotion,
			queue,
			products: products.filter((p) => p !== null),
			pausedByPlan: !featuresForPlan(plan).promo,
		};
	},
});

/**
 * Everything the product picker needs in one read: each active product with
 * its lines, its categories, and — the part that drives disabled-with-reason —
 * whether it already sits on another open promotion or carries its own sale.
 * Same size as the dashboard's own catalogue read (`products.listAll`).
 */
export const pickerCatalog = query({
	args: {
		retailerId: v.id("retailers"),
		/** The promotion being edited, whose own products are not "elsewhere". */
		promotionId: v.optional(v.id("promotions")),
	},
	handler: async (ctx, { retailerId, promotionId }) => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "products",
			level: "read",
		});
		const now = Date.now();
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		products.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
		const categories = (
			await ctx.db
				.query("categories")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect()
		)
			.filter((c) => c.active)
			.sort((a, b) => a.sortOrder - b.sortOrder);
		const junctions = await ctx.db
			.query("productCategories")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		const categoryIdsOf = new Map<string, Id<"categories">[]>();
		for (const j of junctions) {
			const list = categoryIdsOf.get(j.productId) ?? [];
			list.push(j.categoryId);
			categoryIdsOf.set(j.productId, list);
		}
		const rows = await Promise.all(
			products.map(async (product) => {
				const variants = await ctx.db
					.query("productVariants")
					.withIndex("by_product", (q) => q.eq("productId", product._id))
					.collect();
				const elsewhere = await openMembershipOf(
					ctx,
					product._id,
					now,
					promotionId,
				);
				const inThis =
					promotionId !== undefined &&
					(await ctx.db
						.query("promotionMembers")
						.withIndex("by_product", (q) => q.eq("productId", product._id))
						.collect()
					).some(
						(m) =>
							m.promotionId === promotionId &&
							(m.state === "pending" || m.state === "applied"),
					);
				return {
					_id: product._id,
					name: product.name,
					sku: product.sku,
					...listingOf(product),
					categoryIds: categoryIdsOf.get(product._id) ?? [],
					variants: variants
						.filter((vr) => vr.active)
						.sort((a, b) => a.sortOrder - b.sortOrder)
						.map(variantRow),
					inThisPromotion: inThis,
					elsewhere: elsewhere
						? {
								promotionId: elsewhere.promotion._id,
								label: elsewhere.promotion.label,
								endsAt: elsewhere.promotion.endsAt,
							}
						: null,
					ownSale:
						!elsewhere && !inThis && hasOwnSale(product, now)
							? { label: product.promo?.label, endsAt: product.promo?.endsAt }
							: null,
				};
			}),
		);
		return {
			products: rows,
			categories: categories.map((c) => ({ _id: c._id, name: c.name })),
		};
	},
});

/** The open promotion a product belongs to — the product form's grouped
 * state ("Part of Happy Hour · Edit promotion"). */
export const forProduct = query({
	args: { productId: v.id("products") },
	handler: async (ctx, { productId }) => {
		const product = await ctx.db.get(productId);
		if (!product) return null;
		await requireRetailerAccess(ctx, product.retailerId, {
			area: "products",
			level: "read",
		});
		const open = await openMembershipOf(ctx, productId, Date.now());
		if (!open) return null;
		return {
			promotionId: open.promotion._id,
			label: open.promotion.label,
			percentOff: open.promotion.percentOff,
			startsAt: open.promotion.startsAt,
			endsAt: open.promotion.endsAt,
		};
	},
});

/** Exported for `products.update`: is this product held by a promotion? */
export async function productPromotion(
	ctx: QueryCtx,
	productId: Id<"products">,
): Promise<Doc<"promotions"> | null> {
	return (await openMembershipOf(ctx, productId, Date.now()))?.promotion ?? null;
}
