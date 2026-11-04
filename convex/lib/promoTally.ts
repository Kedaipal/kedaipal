// Flash-sale units (z8r3fdcw72, 86eyjv002). The storefront's "12 of 30 left",
// the seller's products-list badge and every order door's cap refusal all
// read ONE number — `promoUnitsTaken`, the run's `promoRunUnits` counter — so
// the number a buyer saw and the number the gate enforced can never disagree.
//
// No lock table: Convex mutations are OCC transactions, and a door that reads
// the counter row and a seam that writes it put that row in both carts' read
// AND write sets, so two carts racing for the last sale unit serialise and
// the loser gets the price-changed refusal.
//
// `tallyPromoUnits` — the original count, a collect of the store's orders in
// the sale window — is now the DEFINITION the counter is held equal to: it
// mints a counter for a kept run, backs the backfill/drift check, and answers
// for a run from before the table. It is no longer called on any hot path:
// measured on dev (Phase 1, 2 Nov), it took a busy store's whole catalogue
// over the 16 MiB read limit and left a 7-product flash cart at 15.8 MiB.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** An order still holding its flash units. `cancelled` is the ONLY release —
 * mirrors `eventSeats.holdsSeats` / `bookingAvailability.holdsCapacity`
 * deliberately: same question, same answer. */
export function holdsPromoUnits(status: Doc<"orders">["status"]): boolean {
	return status !== "cancelled";
}

/**
 * Units already sold under one promo run. Bounded read: `by_retailer` across
 * the run's window — from `startsAt` (sanitizePromo guarantees a capped promo
 * has one) to `endsAt` where there is one — so the scan covers one seller's
 * orders inside the sale. Bounded, but it grows with the store's order volume
 * — ~2.5 KB an order — so it is never a hot-path read: everything that asks
 * "how many are left" calls `promoUnitsTaken`. Kept for minting a kept run,
 * the backfill/drift check, and runs from before the counter existed.
 *
 * The right-hand bound is free correctness-wise: an order created after the
 * window shut cannot carry this run's `promoRunId`, because the doors won't
 * price at the sale price any more. Without it the range stayed open and a
 * sale that is still "live" kept re-reading an order history that grows for
 * as long as the shop trades.
 *
 * Counts `items[].quantity` where the line's frozen `promoRunId` matches:
 * product-level, summed across variants (the cap's mental model), and only
 * lines that actually SOLD at the sale price count against it — a line
 * bought at list during the sale (cap already hit, or added pre-start)
 * carries no runId and never consumes a unit.
 */
export async function tallyPromoUnits(
	ctx: QueryCtx | MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		productId: Id<"products">;
		runId: string;
		startsAt: number;
		/** Absent for an open-ended sale — see the note on the caller. */
		endsAt?: number;
	},
): Promise<number> {
	const inWindow = await ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) => {
			const from = q
				.eq("retailerId", args.retailerId)
				.gte("_creationTime", args.startsAt);
			return args.endsAt === undefined
				? from
				: from.lte("_creationTime", args.endsAt);
		})
		.collect();

	let taken = 0;
	for (const order of inWindow) {
		if (!holdsPromoUnits(order.status)) continue;
		for (const item of order.items) {
			if (item.promoRunId !== args.runId) continue;
			if (item.productId !== args.productId) continue;
			taken += item.quantity;
		}
	}
	return taken;
}

/**
 * Sale units a cart is about to consume for one product — the same rule the
 * tally applies (the `seatsRequested` posture): only lines that actually
 * priced at the sale price (promoRunId stamped) consume units, so a variant
 * the seller never filled a promo price for rides the same cart without
 * touching the pool.
 */
export function promoUnitsRequested(
	items: ReadonlyArray<{
		productId: Id<"products">;
		quantity: number;
		promoRunId?: string;
	}>,
	productId: Id<"products">,
): number {
	return items
		.filter(
			(item) => item.productId === productId && item.promoRunId !== undefined,
		)
		.reduce((sum, item) => sum + item.quantity, 0);
}

// ── The units counter (86eyjv002) ──────────────────────────────────────────
//
// `tallyPromoUnits` is exact but it COLLECTS the store's orders across the
// sale window, once per capped product. In the public catalogue the read set
// covered the store's order range, so every new order — on any product —
// re-ran `products.list` and the category page for every open storefront tab;
// and in every reader the cost grew with capped products × orders in the
// window until it hit the 16 MiB read limit (store down; cart refused).
//
// So every reader uses `promoRunUnits` instead: one row per (product, run),
// held equal to the tally —
//   - MINTED equal (`ensurePromoRunCounter`, at promo save, or by the
//     backfill for a run from before the table): 0 for a run id the save just
//     minted (no order can carry it), the tally otherwise — a cap added to an
//     uncapped run that already sold keeps its runId and so its pool;
//   - KEPT equal at the two seams every order path already calls
//     (`subscriptionUsage.recordOrderCreated` / `recordOrderCancelled`), plus
//     the one path that drops a line without cancelling the order (a
//     declined custom line, `orders.declineMockupItem`).
// The counter IS the gate now (doors included), so a seam that missed it would
// let a sale over- or under-sell: `promoRunUnits.test.ts` pins counter ≡ tally
// across create / cancel / expire / hard-delete / drop, mutation-tests every
// seam, and fails if any Convex function but the backfill calls the tally.

type PromoProduct = Pick<Doc<"products">, "_id" | "retailerId" | "promo">;

/** The counter row for one run, or null (a run from before the table). */
export async function loadPromoRunUnits(
	ctx: QueryCtx | MutationCtx,
	productId: Id<"products">,
	runId: string,
): Promise<Doc<"promoRunUnits"> | null> {
	return ctx.db
		.query("promoRunUnits")
		.withIndex("by_product_run", (q) =>
			q.eq("productId", productId).eq("runId", runId),
		)
		.unique();
}

function tallyArgs(product: PromoProduct & { promo: NonNullable<PromoProduct["promo"]> }) {
	return {
		retailerId: product.retailerId,
		productId: product._id,
		runId: product.promo.runId,
		startsAt: product.promo.startsAt ?? 0,
		endsAt: product.promo.endsAt,
	};
}

/**
 * Sale units taken under the product's CURRENT run — the catalogue's read.
 * One point read; a run with no row yet (live before this table shipped)
 * falls back to the tally so it stays right until the backfill mints it.
 */
export async function promoUnitsTaken(
	ctx: QueryCtx | MutationCtx,
	product: PromoProduct & { promo: NonNullable<PromoProduct["promo"]> },
): Promise<number> {
	const row = await loadPromoRunUnits(ctx, product._id, product.promo.runId);
	if (row !== null) return row.units;
	return tallyPromoUnits(ctx, tallyArgs(product));
}

/**
 * Mint the counter for a CAPPED run that has none. Idempotent: an existing row
 * is already being kept equal.
 *
 * `previousRunId` is the run the product carried BEFORE this write (undefined
 * for a new product), or `"unknown"` where the caller can't say. A run id that
 * differs from it was minted by this very save (`sanitizePromo`), so no order
 * can carry it yet: the row starts at 0 with NO read — which is what keeps a
 * bulk promotion's apply batch inside one transaction's read budget. A KEPT
 * run (a cap or label edit on the same window) is minted from the tally,
 * never 0: a cap added to a running uncapped promo keeps its pool and its
 * sales. Returns whether it minted.
 */
export async function ensurePromoRunCounter(
	ctx: MutationCtx,
	product: PromoProduct,
	now: number,
	previousRunId: string | undefined | "unknown",
): Promise<boolean> {
	const promo = product.promo;
	if (promo === undefined || promo.unitCap === undefined) return false;
	if ((await loadPromoRunUnits(ctx, product._id, promo.runId)) !== null)
		return false;
	const freshRun = previousRunId !== "unknown" && previousRunId !== promo.runId;
	await ctx.db.insert("promoRunUnits", {
		retailerId: product.retailerId,
		productId: product._id,
		runId: promo.runId,
		units: freshRun
			? 0
			: await tallyPromoUnits(ctx, tallyArgs({ ...product, promo })),
		updatedAt: now,
	});
	return true;
}

/** Sale units per (product, run) on these lines — the tally's own rule:
 * only lines stamped with a run consumed a unit. */
function unitsByRun(
	items: ReadonlyArray<{
		productId: Id<"products">;
		quantity: number;
		promoRunId?: string;
	}>,
): Map<string, { productId: Id<"products">; runId: string; units: number }> {
	const groups = new Map<
		string,
		{ productId: Id<"products">; runId: string; units: number }
	>();
	for (const item of items) {
		if (item.promoRunId === undefined) continue;
		const key = `${item.productId}:${item.promoRunId}`;
		const group = groups.get(key) ?? {
			productId: item.productId,
			runId: item.promoRunId,
			units: 0,
		};
		group.units += item.quantity;
		groups.set(key, group);
	}
	return groups;
}

/**
 * Would the tally count this order under `runId` right now? The counter only
 * ever moves for an order the tally would count — the product's CURRENT run,
 * created inside that run's window — so the two stay equal by construction:
 *  - a dead run (re-run or removed since) is never read again, so its row is
 *    left where it is;
 *  - an order outside the window is invisible to the tally. That isn't
 *    theoretical: adding a cap to a running UNCAPPED sale keeps its runId but
 *    stamps `startsAt = now`, so the run's earlier sales fall out of the
 *    window — cancelling one of them must not move the counter either.
 */
async function tallyCounts(
	ctx: MutationCtx,
	productId: Id<"products">,
	runId: string,
	orderCreatedAt: number,
): Promise<Doc<"products"> | null> {
	const product = await ctx.db.get(productId);
	const promo = product?.promo;
	if (!product || promo?.runId !== runId) return null;
	if (orderCreatedAt < (promo.startsAt ?? 0)) return null;
	if (promo.endsAt !== undefined && orderCreatedAt > promo.endsAt) return null;
	return product;
}

/**
 * A new order's sale units join its runs' counters. Call AFTER the insert.
 * A run with NO row is left alone: it is a run from before this table (every
 * run saved since is minted at save), the catalogue tallies it meanwhile, and
 * the backfill mints it. Minting here would tally the window a SECOND time
 * inside the order door, which already tallied it — measured, a busy store's
 * multi-product flash cart sits close enough to the 16 MiB read limit that
 * doubling it would fail the buyer's checkout (Phase 1, 2 Nov).
 */
export async function countPromoUnitsForNewOrder(
	ctx: MutationCtx,
	order: Pick<Doc<"orders">, "items" | "_creationTime">,
	now: number,
): Promise<void> {
	for (const group of unitsByRun(order.items).values()) {
		const counted = await tallyCounts(
			ctx,
			group.productId,
			group.runId,
			order._creationTime,
		);
		if (counted === null) continue;
		const row = await loadPromoRunUnits(ctx, group.productId, group.runId);
		if (row === null) continue;
		await ctx.db.patch(row._id, {
			units: row.units + group.units,
			updatedAt: now,
		});
	}
}

/**
 * Give `items`' sale units back — `items` being the order's lines on the
 * FIRST move into cancelled (the `recordOrderCancelled` seam, which also
 * serves hard delete and the unpaid-flash expiry), or the lines dropped from
 * a live order. Not floored: a negative would mean a seam double-released,
 * and hiding that behind a zero is how a counter drifts silently
 * (`promoUnitsLeft` clamps the display). No row = nothing to keep equal; a
 * later mint recounts from the orders.
 */
export async function releasePromoUnits(
	ctx: MutationCtx,
	order: Pick<Doc<"orders">, "_creationTime">,
	items: Doc<"orders">["items"],
	now: number,
): Promise<void> {
	for (const group of unitsByRun(items).values()) {
		const counted = await tallyCounts(
			ctx,
			group.productId,
			group.runId,
			order._creationTime,
		);
		if (counted === null) continue;
		const row = await loadPromoRunUnits(ctx, group.productId, group.runId);
		if (row === null) continue;
		await ctx.db.patch(row._id, {
			units: row.units - group.units,
			updatedAt: now,
		});
	}
}
