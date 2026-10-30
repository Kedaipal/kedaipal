// Vouchers — the seller's issue/void/list surface and the buyer's code check
// (ClickUp `z8r3fdr617`, docs/vouchers.md).
//
// REDEMPTION does not live here. It happens inside the three order-create
// doors, atomically with the order insert, through
// `convex/lib/voucherRedemption.ts` — see that file for why. This module is
// everything AROUND redemption: minting codes, withdrawing them, and the
// seller's and buyer's reads.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import { storeCurrencyOf } from "./lib/country";
import { rateLimiter } from "./lib/rateLimiter";
import { creditGateFor, forSeller } from "./creditLock";
import {
	liveSharedVoucher,
	resolveVoucherForOrder,
	storeCanUseVouchers,
} from "./lib/voucherRedemption";
import {
	generateVoucherCode,
	isVoucherExpired,
	normalizeSharedCode,
	resolveVoucherStatus,
	SHARED_USES_LISTED,
	sharedCodeError,
	sharedLimitsError,
	type VoucherKind,
	VOUCHER_BATCH_MAX,
	VOUCHER_NOTE_MAX,
	type VoucherRefusal,
	type VoucherStatus,
	type VoucherTerms,
	type VoucherUsage,
	voucherUsageOf,
	voucherValueError,
} from "./lib/vouchers";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";
import { isMytMidnight } from "./lib/fulfilmentDate";

/** Collision retries when minting. 2^40 codes against a store's handful means
 * a clash is vanishingly unlikely; this is the same belt-and-braces loop
 * `generateShortId` uses, and the only thing standing between a 1-in-10^12
 * event and a confusing duplicate-code bug years from now. */
const CODE_RETRIES = 5;

/** A voucher as the seller's list shows it. `status` is the RESOLVED one, so
 * the client never has to know that `expired` isn't stored. */
export type VoucherRow = {
	id: Id<"vouchers">;
	code: string;
	kind: VoucherKind;
	value: number;
	currency: string;
	status: VoucherStatus;
	expiresAt?: number;
	note?: string;
	batchId?: string;
	/** Set once spent — the order it paid for, so the row can link to it.
	 * Single-use only; a shared code's orders come from `listRedemptions`. */
	redeemedOrder?: { shortId: string; total: number };
	redeemedAt?: number;
	voidedAt?: number;
	voidReason?: string;
	createdAt: number;
	/** Resolved, never absent — the client should not know `single` is the
	 * unstored default. */
	usage: VoucherUsage;
	/** Shared only (`z8r3fducfm`). */
	maxRedemptions?: number;
	redeemedCount?: number;
	endsAt?: number;
};

/** What the list's filter chips count, so a tab can show its number and an
 * empty tab can say which one is empty. Resolved, so `expired` is real. */
export type VoucherCounts = Record<VoucherStatus, number>;

/**
 * One voucher as the seller's list shows it.
 *
 * PURE, and it takes the spent order's summary rather than fetching it. The
 * fetch and its redaction live in the caller, in the query's own body, for
 * two reasons: the T3.1 read sweep scans a query's body for the redaction
 * seam and cannot see through a helper, and more usefully, "this read touches
 * order data" is then visible at the surface that answers for it.
 */
function toRow(
	voucher: Doc<"vouchers">,
	now: number,
	/** Already through `forSeller` — never a raw order row. */
	redeemedOrder: { shortId: string; total: number } | undefined,
): VoucherRow {
	return {
		id: voucher._id,
		code: voucher.code,
		kind: voucher.kind,
		value: voucher.value,
		currency: voucher.currency,
		status: resolveVoucherStatus(voucher, now),
		expiresAt: voucher.expiresAt,
		note: voucher.note,
		batchId: voucher.batchId,
		redeemedOrder,
		redeemedAt: voucher.redeemedAt,
		voidedAt: voucher.voidedAt,
		voidReason: voucher.voidReason,
		createdAt: voucher.createdAt,
		usage: voucherUsageOf(voucher),
		maxRedemptions: voucher.maxRedemptions,
		redeemedCount: voucher.redeemedCount,
		endsAt: voucher.endsAt,
	};
}

/**
 * The seller's voucher list.
 *
 * Reads the whole store's vouchers on the `by_retailer_created` index and
 * resolves status in memory rather than range-scanning `by_retailer_status`,
 * for one reason: `expired` is not a stored status, so the expired set can only
 * be found by judging the clock against the `active` rows anyway — and the
 * counts have to cover all four states for the filter chips regardless. A
 * store's voucher count is bounded by what a human issues (tens to low
 * hundreds), which is why this is allowed to be a full tenant scan where the
 * order inbox would never be; if a store ever runs giveaways at a scale that
 * makes this hot, the move is a paginated list, not a cleverer index.
 *
 * Returns the WHOLE book, unfiltered, and the client filters and groups it
 * (`src/lib/voucher-groups.ts`). Two reasons, both structural rather than
 * preference: a BATCH parent has to state what became of the whole run while
 * a filter shows one of its children, which needs the unfiltered rows in
 * hand; and the status chips then switch with no round trip. The scan is the
 * same either way — `expired` is judged at read time, so even a filtered
 * query had to walk everything.
 *
 * READ grant, and deliberately NOT Pro-gated: a store that downgrades keeps
 * seeing the codes it already issued (decided 8 Oct 2026) — the alternative
 * hides outstanding promises the seller still has to honour.
 */
export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		vouchers: VoucherRow[];
		counts: VoucherCounts;
		/**
		 * The store is below the plan that carries vouchers, so none of these
		 * codes can be redeemed right now (`z8r3fdr617`).
		 *
		 * The list has to be told, because the rows stay `active` — which is
		 * TRUE of the voucher and misleading on screen: without this the
		 * seller reads "Active", their buyer is refused, and the seller
		 * rightly blames us. A constraint is surfaced, never enforced
		 * silently.
		 */
		paused: boolean;
	}> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "vouchers",
			level: "read",
		});
		const now = Date.now();
		const all = await ctx.db
			.query("vouchers")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.collect();

		const counts: VoucherCounts = {
			active: 0,
			redeemed: 0,
			voided: 0,
			expired: 0,
		};
		for (const voucher of all) counts[resolveVoucherStatus(voucher, now)]++;

		// A spent voucher names the order it went to, which makes this a seller
		// read of ORDER data under the T3.1 rule ("a gated order is
		// invisible"). Every row goes through `forSeller`, so the allowlist
		// governs structurally: the two fields taken here are both on
		// `GATED_ORDER_FIELDS` and leak nothing today, but the next field added
		// would be picked off a REDACTED row rather than a raw one. Excusing
		// this read instead would state a safety it doesn't check — the exact
		// failure `creditLockCoverage.test.ts` exists to prevent.
		//
		// The gate is resolved ONCE for the page: it is a property of the
		// store, not of a row.
		const gate = await creditGateFor(ctx, retailerId, now);
		const vouchers = await Promise.all(
			all.map(async (vo) => {
				const raw = vo.redeemedOrderId
					? await ctx.db.get(vo.redeemedOrderId)
					: null;
				const order = raw ? forSeller(gate, raw) : null;
				return toRow(
					vo,
					now,
					order ? { shortId: order.shortId, total: order.total } : undefined,
				);
			}),
		);
		return {
			vouchers,
			counts,
			paused: !(await storeCanUseVouchers(ctx, retailerId)),
		};
	},
});


/**
 * Is this code good, and what is it worth? The buyer's storefront field, the
 * `?voucher=` link's on-load check and the counter panel all ask this.
 *
 * A MUTATION rather than a query, deliberately. A voucher code is the only
 * guessable secret the storefront accepts, so the check has to consume
 * rate-limiter budget — and the limiter can only be spent from a mutation.
 * It writes nothing else; the name says what it does, and spending a token IS
 * the side effect. (A free query here would be an unmetered oracle for
 * guessing codes, which is precisely what docs/vouchers.md's guard rail
 * forbids.)
 *
 * Returns a refusal as DATA, never a throw: a bad code is an ordinary thing
 * for a buyer to have, and it must not read as an error on the page.
 */
export const checkCode = mutation({
	args: { retailerId: v.id("retailers"), code: v.string() },
	handler: async (
		ctx,
		{ retailerId, code },
	): Promise<
		| { ok: true; code: string; terms: VoucherTerms }
		| { ok: false; refusal: VoucherRefusal; usedOnOrder?: string }
	> => {
		await rateLimiter.limit(ctx, "voucherCheck", {
			key: retailerId,
			throws: true,
		});
		const resolved = await resolveVoucherForOrder(ctx, {
			retailerId,
			code,
			now: Date.now(),
		});
		if (!resolved.ok)
			return {
				ok: false,
				refusal: resolved.refusal,
				usedOnOrder: resolved.usedOnOrder,
			};
		// The CODE comes back canonical so the field can correct what was typed
		// in place — the buyer sees `KP-7F3K-Q2WM`, not `kp7f3kq2wm`. The sen
		// figure is NOT computed here: the client knows the basket and computes
		// it with the same shared helper the server uses, so there is no
		// round-trip on every quantity change.
		return { ok: true, code: resolved.voucher.code, terms: resolved.terms };
	},
});

/**
 * Is this word free for a new SHARED code? (`z8r3fducfm`)
 *
 * The issue form's live "available / already running" line, so a seller
 * never types a whole form around a code the server will then refuse. Asks
 * the SAME `liveSharedVoucher` the resolve path and the create mutation ask,
 * so the three can't disagree about what "taken" means: a word is taken only
 * while a live shared code holds it — an ended one's word may be reused.
 *
 * `vouchers: read` suffices: it answers a yes/no about the store's own codes
 * and touches no order. Not rate-limited — authenticated, and a seller
 * probing their own book learns nothing they couldn't read off the list.
 */
export const sharedCodeAvailable = query({
	args: { retailerId: v.id("retailers"), code: v.string() },
	handler: async (
		ctx,
		{ retailerId, code },
	): Promise<{ available: boolean; code: string | null }> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "vouchers",
			level: "read",
		});
		const canonical = normalizeSharedCode(code);
		if (canonical === null || sharedCodeError(code) !== null)
			return { available: false, code: canonical };
		const live = await liveSharedVoucher(ctx, retailerId, canonical, Date.now());
		return {
			available: live === null || !isLive(live, Date.now()),
			code: canonical,
		};
	},
});

/** Is this row still spendable — the one predicate "taken" is built on. */
function isLive(voucher: Doc<"vouchers">, now: number): boolean {
	return resolveVoucherStatus(voucher, now) === "active";
}

/**
 * Mint one voucher, a batch of them, or one SHARED code.
 *
 * Pro-gated (issuing is the paid capability) and `vouchers: write` — a grant
 * the owner hands out deliberately, because this is the one seller action that
 * gives money away. A batch shares a `batchId` so the list can show, share and
 * void the run as a unit; a single voucher gets none, which is what "was this
 * part of a run?" reads off.
 *
 * A shared code (`usage: "shared"`, `z8r3fducfm`) is ONE row with a seller-
 * named `code` and at least one of `maxRedemptions` / `endsAt`. It takes no
 * `count` (it IS the many) and no `expiresAt` (it ends at an instant, not a
 * day) — passing either is a client bug and is refused rather than guessed at.
 */
export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		kind: v.union(v.literal("fixed"), v.literal("percent")),
		/** `fixed`: minor units. `percent`: whole percent, 1–100. */
		value: v.number(),
		/** MYT midnight of the last day it works. Omit for no expiry. */
		expiresAt: v.optional(v.number()),
		note: v.optional(v.string()),
		/** How many to mint. Omit or 1 = a single voucher (no batch id). */
		count: v.optional(v.number()),
		/** Omit = `single`. */
		usage: v.optional(v.union(v.literal("single"), v.literal("shared"))),
		/** Shared only: the word buyers type. Required for a shared code. */
		code: v.optional(v.string()),
		/** Shared only: total uses across all buyers. */
		maxRedemptions: v.optional(v.number()),
		/** Shared only: exact end instant (ms). */
		endsAt: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			retailerId,
			kind,
			value,
			expiresAt,
			note,
			count,
			usage = "single",
			code,
			maxRedemptions,
			endsAt,
		},
	): Promise<{ vouchers: VoucherRow[]; batchId?: string }> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "vouchers",
			level: "write",
		});
		// Keyed by the CALLER, not the store: minting is an authenticated seller
		// action, so one person bulk-issuing must not throttle a colleague.
		const userId = access.userId;
		await rateLimiter.limit(ctx, "voucherIssue", { key: userId, throws: true });
		// Lapsed store = view-only; admin act-as bypasses (white-glove).
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, retailerId);
			await assertPlanFeature(ctx, retailerId, "vouchers");
		}

		const valueError = voucherValueError({ kind, value });
		if (valueError !== null) throw new ConvexError(valueError);

		if (usage === "shared") {
			const row = await insertSharedCode(ctx, {
				retailerId,
				kind,
				value,
				currency: storeCurrencyOf(access.retailer),
				code,
				maxRedemptions,
				endsAt,
				count,
				expiresAt,
				note,
				createdByUserId: access.role === "admin" ? undefined : userId,
			});
			await logAdminAction(ctx, access, "vouchers.create", retailerId);
			return { vouchers: [toRow(row, row.createdAt, undefined)] };
		}

		const howMany = count ?? 1;
		if (!Number.isInteger(howMany) || howMany < 1)
			throw new ConvexError("Choose how many vouchers to create");
		if (howMany > VOUCHER_BATCH_MAX)
			throw new ConvexError(
				`At most ${VOUCHER_BATCH_MAX} vouchers at a time — create another batch after this one.`,
			);

		const now = Date.now();
		if (expiresAt !== undefined) {
			// Same calendar-day convention as a fulfilment date, so the picker,
			// the formatter and the expiry rule all speak one language.
			if (!isMytMidnight(expiresAt))
				throw new ConvexError("Pick an expiry date");
			// A voucher dies at the END of its day, so today is still valid.
			if (!isVoucherDateInFuture(expiresAt, now))
				throw new ConvexError("That expiry date has already passed");
		}

		const retailer = access.retailer;
		const currency = storeCurrencyOf(retailer);
		const cleanNote = note?.trim().slice(0, VOUCHER_NOTE_MAX) || undefined;
		// One id for the whole run; absent on a single voucher.
		const batchId = howMany > 1 ? `vb_${now.toString(36)}_${userId.slice(-6)}` : undefined;

		const created: Doc<"vouchers">[] = [];
		for (let i = 0; i < howMany; i++) {
			const id = await insertWithUniqueCode(ctx, {
				retailerId,
				kind,
				value,
				currency,
				expiresAt,
				note: cleanNote,
				batchId,
				createdByUserId: access.role === "admin" ? undefined : userId,
				now,
			});
			const row = await ctx.db.get(id);
			if (row) created.push(row);
		}

		await logAdminAction(ctx, access, "vouchers.create", retailerId);
		return {
			// Freshly minted rows are `active` and carry no order, so there is
			// nothing here for the gate to redact.
			vouchers: created.map((vo) => toRow(vo, now, undefined)),
			batchId,
		};
	},
});

/** Is this MYT-midnight day today or later? A voucher works all through its
 * expiry day, so today is a legitimate (if brief) expiry — asked THROUGH
 * `isVoucherExpired` so the create guard and the redemption rule can never
 * disagree about which days are usable. */
function isVoucherDateInFuture(expiresAt: number, now: number): boolean {
	return !isVoucherExpired(expiresAt, now);
}

/**
 * Validate and insert ONE shared code (`z8r3fducfm`). Every refusal here is
 * the SAME sentence the issue form shows beside its disabled button
 * (`sharedCodeError`, `sharedLimitsError`), so the form never offers what the
 * server turns down. The uniqueness check is the one rule the client can't
 * run alone, and it reads through `liveSharedVoucher` — the resolve path's
 * own lookup — so "taken" here means exactly "a buyer typing it now would
 * spend that other row".
 */
async function insertSharedCode(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		kind: VoucherKind;
		value: number;
		currency: string;
		code?: string;
		maxRedemptions?: number;
		endsAt?: number;
		count?: number;
		expiresAt?: number;
		note?: string;
		createdByUserId?: string;
	},
): Promise<Doc<"vouchers">> {
	// Arguments that belong to the OTHER usage are client bugs, not choices.
	if (args.count !== undefined && args.count !== 1)
		throw new ConvexError(
			"A shared code is one code — set how many orders can use it instead.",
		);
	if (args.expiresAt !== undefined)
		throw new ConvexError("A shared code ends at a time, not on a day.");

	const codeError = sharedCodeError(args.code ?? "");
	if (codeError !== null) throw new ConvexError(codeError);
	const code = normalizeSharedCode(args.code ?? "");
	if (code === null) throw new ConvexError(sharedCodeError("") ?? "Type a code");

	const now = Date.now();
	const limits = { maxRedemptions: args.maxRedemptions, endsAt: args.endsAt };
	const limitsError = sharedLimitsError(limits, now);
	if (limitsError !== null) throw new ConvexError(limitsError);

	const live = await liveSharedVoucher(ctx, args.retailerId, code, now);
	if (live !== null && isLive(live, now))
		throw new ConvexError(
			`${code} is already running — void it or let it end before reusing the word.`,
		);

	const id = await ctx.db.insert("vouchers", {
		retailerId: args.retailerId,
		code,
		kind: args.kind,
		value: args.value,
		currency: args.currency,
		status: "active",
		usage: "shared",
		maxRedemptions: args.maxRedemptions,
		redeemedCount: 0,
		endsAt: args.endsAt,
		note: args.note?.trim().slice(0, VOUCHER_NOTE_MAX) || undefined,
		createdByUserId: args.createdByUserId,
		createdAt: now,
		updatedAt: now,
	});
	const row = await ctx.db.get(id);
	if (!row) throw new ConvexError("Couldn't create the code, please try again");
	return row;
}

/**
 * The orders that spent a SHARED code (`z8r3fducfm`) — "who used SALE345",
 * the question the count on the row can't answer. Newest first.
 *
 * A seller read of ORDER data, so every row goes through `forSeller`: a
 * gated order (T3.1) is invisible here as everywhere, and a hard-deleted one
 * is dropped rather than shown as a blank. `vouchers: read` — the same grant
 * that shows the list the count sits on.
 */
export const listRedemptions = query({
	args: { voucherId: v.id("vouchers") },
	handler: async (
		ctx,
		{ voucherId },
	): Promise<{
		orders: Array<{ shortId: string; total: number; redeemedAt: number }>;
		/** More uses exist than were listed — the dialog says it is showing the
		 * latest `SHARED_USES_LISTED`, so the "waiting on credits" arithmetic
		 * (count minus rows) is never applied to a cut-off list. */
		limited: boolean;
	}> => {
		const voucher = await ctx.db.get(voucherId);
		if (!voucher) return { orders: [], limited: false };
		await requireRetailerAccess(ctx, voucher.retailerId, {
			area: "vouchers",
			level: "read",
		});
		const rows = await ctx.db
			.query("voucherRedemptions")
			.withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
			.order("desc")
			// One past the limit, so `limited` is exact rather than a guess from
			// the count (which a hand-back can lower after the read).
			.take(SHARED_USES_LISTED + 1);
		const limited = rows.length > SHARED_USES_LISTED;
		const gate = await creditGateFor(ctx, voucher.retailerId, Date.now());
		const out: Array<{ shortId: string; total: number; redeemedAt: number }> = [];
		for (const row of rows.slice(0, SHARED_USES_LISTED)) {
			const raw = await ctx.db.get(row.orderId);
			if (!raw) continue;
			const order = forSeller(gate, raw);
			if (!order) continue;
			out.push({
				shortId: order.shortId,
				total: order.total,
				redeemedAt: row.createdAt,
			});
		}
		return { orders: out, limited };
	},
});

async function insertWithUniqueCode(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		kind: VoucherKind;
		value: number;
		currency: string;
		expiresAt?: number;
		note?: string;
		batchId?: string;
		createdByUserId?: string;
		now: number;
	},
): Promise<Id<"vouchers">> {
	for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
		const code = generateVoucherCode();
		const clash = await ctx.db
			.query("vouchers")
			.withIndex("by_code", (q) => q.eq("code", code))
			.first();
		if (clash) continue;
		return await ctx.db.insert("vouchers", {
			retailerId: args.retailerId,
			code,
			kind: args.kind,
			value: args.value,
			currency: args.currency,
			expiresAt: args.expiresAt,
			status: "active",
			note: args.note,
			batchId: args.batchId,
			createdByUserId: args.createdByUserId,
			createdAt: args.now,
			updatedAt: args.now,
		});
	}
	throw new ConvexError("Couldn't generate a voucher code, please try again");
}

/**
 * Withdraw a voucher. Soft — the row and its history stay, the code simply
 * stops redeeming (there is no hard delete in v1, so a seller can always
 * answer "what happened to the code I sent you?").
 *
 * NOT Pro-gated, on purpose: a downgraded store must still be able to
 * withdraw the promises it made on Pro. Same posture as every other feature's
 * "disabling stays un-gated" rule.
 *
 * A REDEEMED voucher can't be voided — it has already been spent, and the
 * order it paid for is the record. Voiding one would imply the discount could
 * be clawed back off a placed order, which it can't.
 */
export const voidVoucher = mutation({
	args: { voucherId: v.id("vouchers"), reason: v.optional(v.string()) },
	handler: async (ctx, { voucherId, reason }): Promise<void> => {
		const voucher = await ctx.db.get(voucherId);
		if (!voucher) throw new ConvexError("Voucher not found");
		const access = await requireRetailerAccess(ctx, voucher.retailerId, {
			area: "vouchers",
			level: "write",
		});
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, voucher.retailerId);
		if (voucher.status === "redeemed")
			throw new ConvexError(
				"This voucher has already been used — void can't undo a placed order.",
			);
		if (voucher.status === "voided") return; // idempotent

		const now = Date.now();
		await ctx.db.patch(voucherId, {
			status: "voided",
			voidedAt: now,
			voidReason: reason?.trim().slice(0, VOUCHER_NOTE_MAX) || undefined,
			updatedAt: now,
		});
		await logAdminAction(ctx, access, "vouchers.voidVoucher", voucherId);
	},
});

/**
 * Rename a batch — the ONE bulk "update" a run of codes actually needs.
 *
 * A voucher's VALUE is immutable once issued (a code already in a buyer's
 * hand must not change what it is worth), so the only thing a seller can
 * usefully change in bulk is what the run is CALLED. That name is what makes
 * a list of twenty look-alike codes readable three months later, and a seller
 * who skipped it at issue time has no other way back to it.
 *
 * The name lives on each row's `note` rather than in a batches table: there
 * is no such table, a batch is at most `VOUCHER_BATCH_MAX` rows, and keeping
 * it denormalised means the list needs no join. Renaming patches them all in
 * one transaction, including spent and voided rows — the name describes the
 * RUN, so a history row that dropped out of it would orphan itself in the UI.
 */
export const renameBatch = mutation({
	args: {
		retailerId: v.id("retailers"),
		batchId: v.string(),
		/** Empty clears the name — the group then falls back to its size and
		 * date, which is still a stable thing to point at. */
		note: v.string(),
	},
	handler: async (ctx, { retailerId, batchId, note }): Promise<number> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "vouchers",
			level: "write",
		});
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);

		const rows = (
			await ctx.db
				.query("vouchers")
				.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
				.collect()
		).filter((vo) => vo.batchId === batchId);
		if (rows.length === 0) throw new ConvexError("That batch no longer exists");

		const now = Date.now();
		const clean = note.trim().slice(0, VOUCHER_NOTE_MAX) || undefined;
		for (const row of rows)
			await ctx.db.patch(row._id, { note: clean, updatedAt: now });
		await logAdminAction(ctx, access, "vouchers.renameBatch", retailerId);
		return rows.length;
	},
});

/**
 * Void every still-spendable voucher in a batch — the bulk affordance a run of
 * 20 codes needs (printing a sheet and then calling the whole run off is the
 * realistic mistake). Skips what it can't do rather than refusing: a batch
 * part-spent is the normal case, and a refusal would leave the seller voiding
 * 17 codes by hand.
 */
export const voidBatch = mutation({
	args: {
		retailerId: v.id("retailers"),
		batchId: v.string(),
		reason: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ retailerId, batchId, reason },
	): Promise<{ voided: number; skippedRedeemed: number }> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "vouchers",
			level: "write",
		});
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);

		const rows = (
			await ctx.db
				.query("vouchers")
				.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
				.collect()
		).filter((vo) => vo.batchId === batchId);
		if (rows.length === 0) throw new ConvexError("That batch no longer exists");

		const now = Date.now();
		const cleanReason = reason?.trim().slice(0, VOUCHER_NOTE_MAX) || undefined;
		let voided = 0;
		let skippedRedeemed = 0;
		for (const row of rows) {
			if (row.status === "redeemed") {
				skippedRedeemed++;
				continue;
			}
			if (row.status === "voided") continue;
			await ctx.db.patch(row._id, {
				status: "voided",
				voidedAt: now,
				voidReason: cleanReason,
				updatedAt: now,
			});
			voided++;
		}
		await logAdminAction(ctx, access, "vouchers.voidBatch", retailerId);
		return { voided, skippedRedeemed };
	},
});
