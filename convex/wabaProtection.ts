/**
 * WABA protection gateway (ClickUp 86expmgep) — the choke point every outbound
 * WhatsApp message passes through before it reaches Meta. Kedaipal runs a SINGLE
 * shared WhatsApp Business number for all retailers, so one bad actor can tank
 * the quality rating or trip per-number limits for EVERYONE. This module gates
 * sends on, in order:
 *
 *   1. Category — transactional order messages (the core promise) bypass ALL of
 *      the below; only non-transactional sends (session replies today, broadcast/
 *      templates later) are gated.
 *   2. Quality halt — Meta quality LOW pauses all non-transactional; MEDIUM/UNKNOWN
 *      pauses Marketing only.
 *   3. Global opt-out — a STOP to any retailer suppresses non-transactional sends
 *      to that phone across the whole shared number.
 *   4. Retailer kill switch — a paused retailer's non-transactional sends are blocked.
 *   5. Per-retailer caps — burst (30/5min) + tiered daily (50 first-30d / 200 / 500).
 *
 * Every attempt is logged to outboundMessageLog (sent / failed / blocked_*).
 * Blocked sends NEVER reach Meta. Usage: actions build a guarded sender via
 * makeGuardedSender(ctx, retailerId, category) and call .send(to, msg). See
 * docs/waba-protection.md.
 *
 * Transactional sends are DURABLY RETRIED on transient Meta failures (ClickUp
 * 86ey5dz0a) via @convex-dev/action-retrier: the guarded sender enqueues one
 * retried run (gating decided once, up front) and logs a single `pending` row
 * that onDeliverComplete patches to the terminal sent/failed. Gated categories
 * are never retried — replaying them would re-run canSend's side effects.
 * Ordered/fallback transactional sequences opt out ({ retry: false }) and get
 * bounded in-process retries instead, keeping await-with-throw semantics.
 */

import { runIdValidator, runResultValidator } from "@convex-dev/action-retrier";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { INLINE_RETRY, retrier } from "./lib/actionRetrier";
import { requireAdmin } from "./lib/auth";
import { getAdapter } from "./lib/channels/registry";
import type { OutboundMessage } from "./lib/channels/types";
import { outboundMessageValidator } from "./lib/channels/validators";
import { withInlineRetries } from "./lib/retry";
import { sendEmail } from "./lib/email";
import { rateLimiter } from "./lib/rateLimiter";
import { normalizeWaPhone } from "./lib/slug";
import { resolveAccess, loadSubscription } from "./subscriptions";
import {
	BURST_WINDOW_MS,
	DAY_MS,
	type MessageCategory,
	type QualityRating,
	isTransactional,
	qualityBlocks,
	resolveSendingLimits,
} from "./lib/wabaLimits";

const categoryValidator = v.union(
	v.literal("transactional"),
	v.literal("utility_template"),
	v.literal("marketing_template"),
	v.literal("session_message"),
);

/** A blocked outcome maps 1:1 to an outboundMessageLog status. */
type BlockedStatus =
	| "blocked_optout"
	| "blocked_capreached"
	| "blocked_quality"
	| "blocked_retailer_paused";

type SendDecision =
	| { allowed: true }
	| { allowed: false; status: BlockedStatus };

/** A drop-in replacement for the raw channel adapter's send, with guardrails. */
export type GuardedSender = {
	send(to: string, msg: OutboundMessage): Promise<void>;
};

/**
 * Build a guarded sender bound to a seller (or `null` for system replies to an
 * unknown inbound sender) and a message category. Every .send():
 *   - asks canSend whether this send is allowed (once — never per retry),
 *   - on block: logs the blocked_* row and RETURNS WITHOUT throwing (so a
 *     caller's catch/fallback doesn't re-send the same blocked message),
 *   - on allow, transactional (default): hands the Meta call to the durable
 *     action-retrier and resolves as soon as the run is enqueued — a transient
 *     Meta failure retries with backoff instead of dropping the message.
 *     `.send()` no longer throws on delivery failure here; the terminal
 *     outcome lands in outboundMessageLog via onDeliverComplete.
 *   - on allow, `{ retry: false }` transactional: hits Meta inline with
 *     bounded in-process retries, then logs sent / failed and rethrows on
 *     exhaustion — for ordered sequences and throw-driven fallbacks that need
 *     await semantics (sendPaymentMessage, image→text degradation).
 *   - on allow, gated categories: single inline attempt, no retries — the
 *     canSend decision (which consumes rate-limit tokens) must not be replayed.
 */
export function makeGuardedSender(
	ctx: ActionCtx,
	retailerId: Id<"retailers"> | null,
	category: MessageCategory,
	opts?: { retry?: boolean },
): GuardedSender {
	const adapter = getAdapter("whatsapp");
	const durable = isTransactional(category) && (opts?.retry ?? true);
	return {
		async send(to: string, msg: OutboundMessage): Promise<void> {
			if (durable) {
				// One mutation decides gating, enqueues the retried run, and writes
				// the pending audit row atomically.
				await ctx.runMutation(internal.wabaProtection.enqueueTransactionalSend, {
					retailerId: retailerId ?? undefined,
					toWaPhone: to,
					message: msg,
				});
				return;
			}
			const decision = await ctx.runMutation(internal.wabaProtection.canSend, {
				retailerId: retailerId ?? undefined,
				toPhone: to,
				category,
			});
			if (!decision.allowed) {
				await ctx.runMutation(internal.wabaProtection.logSend, {
					retailerId: retailerId ?? undefined,
					toWaPhone: to,
					category,
					status: decision.status,
				});
				console.warn("WA send blocked by guardrail", {
					retailerId,
					category,
					status: decision.status,
				});
				return;
			}
			try {
				if (isTransactional(category)) {
					// retry:false — still ride out a transient blip, just in-process so
					// the caller's await/throw contract holds.
					await withInlineRetries(() => adapter.send(to, msg), INLINE_RETRY);
				} else {
					await adapter.send(to, msg);
				}
				await ctx.runMutation(internal.wabaProtection.logSend, {
					retailerId: retailerId ?? undefined,
					toWaPhone: to,
					category,
					status: "sent",
				});
			} catch (err) {
				await ctx.runMutation(internal.wabaProtection.logSend, {
					retailerId: retailerId ?? undefined,
					toWaPhone: to,
					category,
					status: "failed",
					errorCode: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}
		},
	};
}

/** Latest observed quality rating for the shared number (HIGH if never observed). */
async function latestQuality(ctx: MutationCtx): Promise<QualityRating> {
	const row = await ctx.db
		.query("wabaHealth")
		.withIndex("by_observed")
		.order("desc")
		.first();
	return (row?.qualityRating ?? "HIGH") as QualityRating;
}

/** Whether a phone currently holds an active (non-reactivated) global opt-out.
 * Matches on the canonical (digits-only) form so formatting differences between
 * Meta's inbound `from` and a stored `customer.waPhone`/`retailer.waPhone` can't
 * let a STOP silently fail to suppress. */
async function isOptedOut(ctx: MutationCtx, waPhone: string): Promise<boolean> {
	const latest = await ctx.db
		.query("optOuts")
		.withIndex("by_phone", (q) => q.eq("waPhone", normalizeWaPhone(waPhone)))
		.order("desc")
		.first();
	return !!latest && latest.reactivatedAt === undefined;
}

/**
 * Decide whether a single outbound message may be sent. Consumes rate-limit
 * tokens as a side effect for non-transactional sends (so calling it IS the
 * reservation). Shared by the canSend mutation (inline sends) and
 * enqueueTransactionalSend (durably-retried sends) so both paths pass the one
 * gateway — and gating always runs exactly once per message, never per retry.
 */
async function decideSend(
	ctx: MutationCtx,
	{
		retailerId,
		toPhone,
		category,
	}: {
		retailerId?: Id<"retailers">;
		toPhone: string;
		category: MessageCategory;
	},
): Promise<SendDecision> {
	// Transactional order messages are the core promise — never gated here.
	if (isTransactional(category)) return { allowed: true };

	// 1. Quality halt (shared across all retailers).
	const quality = await latestQuality(ctx);
	if (qualityBlocks(quality, category)) {
		return { allowed: false, status: "blocked_quality" };
	}

	// 2. Global opt-out.
	if (await isOptedOut(ctx, toPhone)) {
		return { allowed: false, status: "blocked_optout" };
	}

	// 3. Retailer kill switch + 4. caps (only when attributable to a retailer).
	const retailer = retailerId ? await ctx.db.get(retailerId) : null;
	if (retailer) {
		const limitsRow = await ctx.db
			.query("retailerSendingLimits")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (limitsRow?.pausedAt) {
			return { allowed: false, status: "blocked_retailer_paused" };
		}
		const sub = await loadSubscription(ctx, retailer._id);
		const { dailyCap, burstCap5min } = resolveSendingLimits({
			plan: resolveAccess(sub).plan,
			accountCreatedAt: retailer.createdAt,
			now: Date.now(),
			dailyCapOverride: limitsRow?.dailyCap,
			burstCapOverride: limitsRow?.burstCap5min,
		});
		const burst = await rateLimiter.limit(ctx, "wabaBurst", {
			key: retailer._id,
			throws: false,
			config: { kind: "fixed window", rate: burstCap5min, period: BURST_WINDOW_MS },
		});
		if (!burst.ok) return { allowed: false, status: "blocked_capreached" };
		const daily = await rateLimiter.limit(ctx, "wabaDaily", {
			key: retailer._id,
			throws: false,
			config: { kind: "fixed window", rate: dailyCap, period: DAY_MS },
		});
		if (!daily.ok) return { allowed: false, status: "blocked_capreached" };
	}

	return { allowed: true };
}

export const canSend = internalMutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		toPhone: v.string(),
		category: categoryValidator,
	},
	handler: (ctx, args): Promise<SendDecision> => decideSend(ctx, args),
});

// ---------------------------------------------------------------------------
// Durable retry for transactional sends (ClickUp 86ey5dz0a) — see the module
// header and docs/waba-protection.md. The retry unit is ONE Meta delivery:
// gating and audit-logging live outside the retried action, so replaying it
// can only ever repeat the HTTP call that just failed.
// ---------------------------------------------------------------------------

/**
 * Gate → enqueue → log, in one transaction. Called by the guarded sender's
 * durable path. The pending row and the retrier run commit together, so
 * onDeliverComplete can never fire against a missing row, and a crash here
 * leaves neither an orphan run nor an orphan row.
 */
export const enqueueTransactionalSend = internalMutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		toWaPhone: v.string(),
		message: outboundMessageValidator,
	},
	handler: async (ctx, { retailerId, toWaPhone, message }): Promise<void> => {
		// decideSend always allows transactional today; kept so a future policy
		// change (e.g. a global hard-kill) automatically covers retried sends too.
		const decision = await decideSend(ctx, {
			retailerId,
			toPhone: toWaPhone,
			category: "transactional",
		});
		if (!decision.allowed) {
			await ctx.db.insert("outboundMessageLog", {
				retailerId,
				toWaPhone,
				category: "transactional",
				status: decision.status,
				sentAt: Date.now(),
			});
			return;
		}
		const runId = await retrier.run(
			ctx,
			internal.wabaProtection.deliverTransactional,
			{ toPhone: toWaPhone, message },
			{ onComplete: internal.wabaProtection.onDeliverComplete },
		);
		await ctx.db.insert("outboundMessageLog", {
			retailerId,
			toWaPhone,
			category: "transactional",
			status: "pending",
			runId,
			sentAt: Date.now(),
		});
	},
});

/**
 * The retried unit: exactly one Meta HTTP delivery, nothing else. The ONLY
 * throw path is the provider call itself — logging happens in
 * onDeliverComplete after the run settles — so a "Meta accepted it but a later
 * step failed" state cannot exist here, and a retry can never double-send.
 */
export const deliverTransactional = internalAction({
	args: { toPhone: v.string(), message: outboundMessageValidator },
	handler: async (_ctx, { toPhone, message }): Promise<void> => {
		await getAdapter("whatsapp").send(toPhone, message);
	},
});

/**
 * action-retrier onComplete hook: patch the run's pending audit row to its
 * terminal status. Success → `sent`; exhausted retries → ONE `failed` row with
 * the last error (never a row per attempt). `canceled` only happens via a
 * manual retrier.cancel, which nothing calls today.
 */
export const onDeliverComplete = internalMutation({
	args: { runId: runIdValidator, result: runResultValidator },
	handler: async (ctx, { runId, result }): Promise<void> => {
		const row = await ctx.db
			.query("outboundMessageLog")
			.withIndex("by_run", (q) => q.eq("runId", runId))
			.first();
		if (!row) {
			console.warn("WA retried send completed but no pending log row", {
				runId,
				result: result.type,
			});
			return;
		}
		if (result.type === "success") {
			await ctx.db.patch(row._id, { status: "sent" });
		} else {
			await ctx.db.patch(row._id, {
				status: "failed",
				errorCode: result.type === "failed" ? result.error : "canceled",
			});
			console.error("WA transactional send exhausted retries", {
				runId,
				retailerId: row.retailerId,
				errorCode: result.type === "failed" ? result.error : "canceled",
			});
		}
	},
});

/** Append one row to the outbound audit log. */
export const logSend = internalMutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		toWaPhone: v.string(),
		category: categoryValidator,
		status: v.union(
			v.literal("sent"),
			v.literal("delivered"),
			v.literal("read"),
			v.literal("failed"),
			v.literal("blocked_optout"),
			v.literal("blocked_capreached"),
			v.literal("blocked_quality"),
			v.literal("blocked_retailer_paused"),
		),
		templateName: v.optional(v.string()),
		errorCode: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		await ctx.db.insert("outboundMessageLog", {
			retailerId: args.retailerId,
			toWaPhone: args.toWaPhone,
			category: args.category,
			templateName: args.templateName,
			status: args.status,
			errorCode: args.errorCode,
			sentAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Kill switch — operated via the Convex CLI / dashboard until the Admin Console
// (ClickUp 86ey25er1) ships its UI:
//   npx convex run wabaProtection:pauseRetailer '{"retailerId":"<id>","reason":"spam"}'
//   npx convex run wabaProtection:resumeRetailer '{"retailerId":"<id>"}'
// ---------------------------------------------------------------------------

/** Upsert the retailer's sending-limits row (created lazily). */
async function upsertLimits(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	patch: Record<string, unknown>,
): Promise<void> {
	const row = await ctx.db
		.query("retailerSendingLimits")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
	if (row) {
		await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
	} else {
		await ctx.db.insert("retailerSendingLimits", {
			retailerId,
			updatedAt: Date.now(),
			...patch,
		});
	}
}

/** Pause core — shared by the CLI internal mutation and the admin UI mutation. */
async function doPause(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	reason: string | undefined,
	pausedByUserId: string | undefined,
): Promise<void> {
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error(`Retailer not found: ${retailerId}`);
	await upsertLimits(ctx, retailerId, {
		pausedAt: Date.now(),
		pauseReason: reason,
		pausedByUserId,
	});
	console.warn("WABA: retailer outbound PAUSED", {
		retailerId,
		storeName: retailer.storeName,
		reason,
	});
	// Tell the retailer their non-transactional sends are paused (order
	// confirmations still flow). Fire-and-forget.
	await ctx.scheduler.runAfter(0, internal.wabaProtection.notifyRetailerPaused, {
		retailerId,
		reason,
	});
}

/** Resume core — shared by the CLI internal mutation and the admin UI mutation. */
async function doResume(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error(`Retailer not found: ${retailerId}`);
	await upsertLimits(ctx, retailerId, {
		pausedAt: undefined,
		pauseReason: undefined,
		pausedByUserId: undefined,
	});
	console.warn("WABA: retailer outbound RESUMED", {
		retailerId,
		storeName: retailer.storeName,
	});
}

export const pauseRetailer = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		reason: v.optional(v.string()),
		pausedByUserId: v.optional(v.string()),
	},
	handler: async (ctx, { retailerId, reason, pausedByUserId }): Promise<void> => {
		await doPause(ctx, retailerId, reason, pausedByUserId);
	},
});

export const resumeRetailer = internalMutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		await doResume(ctx, retailerId);
	},
});

// --- Admin UI (Clerk-allowlisted) — backs /app/admin/waba -------------------

/** Cap on per-vendor log rows scanned for the at-a-glance stats. */
const VENDOR_STATS_SCAN_CAP = 300;

/**
 * List/search vendors with current pause status + at-a-glance 30-day stats
 * (sent / blocked / opt-outs-triggered) so an admin can eyeball who's misbehaving
 * without drilling in. All derived from data we already log — no Meta needed.
 *
 * PERF: stats are computed on demand — one global `optOuts` scan + a capped,
 * indexed per-vendor scan of `outboundMessageLog` (only for the ≤200 shown). Fine
 * at current vendor counts; before scaling to hundreds of high-volume vendors,
 * move to denormalized rolling counters (see docs/waba-protection.md). Counts max
 * out at the scan cap (shown as "N+").
 */
export const adminListVendors = query({
	args: { search: v.optional(v.string()) },
	handler: async (ctx, { search }) => {
		await requireAdmin(ctx);
		const [retailers, limits] = await Promise.all([
			ctx.db.query("retailers").collect(),
			ctx.db.query("retailerSendingLimits").collect(),
		]);
		const byRetailer = new Map(limits.map((l) => [l.retailerId, l]));
		const term = (search ?? "").trim().toLowerCase();
		const shown = retailers
			.filter(
				(r) =>
					!term ||
					r.storeName.toLowerCase().includes(term) ||
					r.slug.toLowerCase().includes(term),
			)
			.map((r) => {
				const l = byRetailer.get(r._id);
				return {
					_id: r._id,
					storeName: r.storeName,
					slug: r.slug,
					paused: !!l?.pausedAt,
					pausedAt: l?.pausedAt,
					pauseReason: l?.pauseReason,
				};
			})
			.sort(
				(a, b) =>
					Number(b.paused) - Number(a.paused) ||
					a.storeName.localeCompare(b.storeName),
			)
			.slice(0, 200);

		const cutoff = Date.now() - 30 * DAY_MS;

		// Opt-outs this vendor triggered in the last 30d — one scan of the global
		// (small) opt-out list, bucketed by the triggering retailer.
		const optOuts = await ctx.db.query("optOuts").collect();
		const optOutsByVendor = new Map<string, number>();
		for (const o of optOuts) {
			if (o.createdAt >= cutoff && o.triggeredByRetailerId) {
				const k = o.triggeredByRetailerId;
				optOutsByVendor.set(k, (optOutsByVendor.get(k) ?? 0) + 1);
			}
		}

		// Per-vendor sent/blocked counts (30d, capped), via the by_retailer_sent index.
		return Promise.all(
			shown.map(async (v) => {
				const logs = await ctx.db
					.query("outboundMessageLog")
					.withIndex("by_retailer_sent", (q) =>
						q.eq("retailerId", v._id).gte("sentAt", cutoff),
					)
					.order("desc")
					.take(VENDOR_STATS_SCAN_CAP);
				let sent = 0;
				let blocked = 0;
				for (const l of logs) {
					if (l.status === "sent" || l.status === "delivered" || l.status === "read")
						sent++;
					else if (l.status.startsWith("blocked_")) blocked++;
				}
				return {
					...v,
					sent30d: sent,
					blocked30d: blocked,
					optOuts30d: optOutsByVendor.get(v._id) ?? 0,
					statsCapped: logs.length === VENDOR_STATS_SCAN_CAP,
				};
			}),
		);
	},
});

/** Latest WABA health snapshot for the admin banner — null until Meta health
 * webhooks are subscribed (graceful: the UI then shows "not receiving updates"). */
export const adminGetWabaHealth = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return ctx.db
			.query("wabaHealth")
			.withIndex("by_observed")
			.order("desc")
			.first();
	},
});

export const adminPauseRetailer = mutation({
	args: { retailerId: v.id("retailers"), reason: v.string() },
	handler: async (ctx, { retailerId, reason }): Promise<void> => {
		const adminId = await requireAdmin(ctx);
		const trimmed = reason.trim();
		if (!trimmed) throw new Error("A reason is required to pause a vendor");
		await doPause(ctx, retailerId, trimmed, adminId);
	},
});

export const adminResumeRetailer = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		await requireAdmin(ctx);
		await doResume(ctx, retailerId);
	},
});

// ---------------------------------------------------------------------------
// Global opt-out (STOP/BERHENTI/UNSUB → out, START/MULA → in). Called from
// handleInbound. The list is GLOBAL across the shared number.
// ---------------------------------------------------------------------------

export const registerOptOut = internalMutation({
	args: {
		waPhone: v.string(),
		source: v.union(
			v.literal("stop_keyword"),
			v.literal("berhenti_keyword"),
			v.literal("unsub_keyword"),
			v.literal("manual_admin"),
			v.literal("meta_complaint"),
		),
		triggeredByRetailerId: v.optional(v.id("retailers")),
	},
	handler: async (ctx, { waPhone, source, triggeredByRetailerId }): Promise<void> => {
		const phone = normalizeWaPhone(waPhone);
		if (await isOptedOut(ctx, phone)) return; // idempotent — already opted out
		await ctx.db.insert("optOuts", {
			waPhone: phone,
			source,
			triggeredByRetailerId,
			createdAt: Date.now(),
		});
		console.warn("WABA: global opt-out registered", { waPhone: phone, source });
	},
});

export const reactivateOptIn = internalMutation({
	args: { waPhone: v.string() },
	handler: async (ctx, { waPhone }): Promise<void> => {
		const phone = normalizeWaPhone(waPhone);
		const latest = await ctx.db
			.query("optOuts")
			.withIndex("by_phone", (q) => q.eq("waPhone", phone))
			.order("desc")
			.first();
		if (latest && latest.reactivatedAt === undefined) {
			await ctx.db.patch(latest._id, { reactivatedAt: Date.now() });
			console.warn("WABA: global opt-in (re-activated)", { waPhone: phone });
		}
	},
});

// ---------------------------------------------------------------------------
// WABA health — fed by Meta webhooks (convex/http.ts), read by canSend.
// ---------------------------------------------------------------------------

export const recordWabaHealth = internalMutation({
	args: {
		qualityRating: v.union(
			v.literal("HIGH"),
			v.literal("MEDIUM"),
			v.literal("LOW"),
			v.literal("UNKNOWN"),
		),
		messagingTier: v.number(),
		notes: v.optional(v.string()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ shouldAlert: boolean; summary: string }> => {
		await ctx.db.insert("wabaHealth", { ...args, observedAt: Date.now() });
		// Alert ops on anything below HIGH.
		const shouldAlert = args.qualityRating !== "HIGH";
		const summary = `quality=${args.qualityRating} tier=${args.messagingTier} ${args.notes ?? ""}`;
		return { shouldAlert, summary };
	},
});

/**
 * Email a WABA-health alert to ops. Recipient is ADMIN_ALERT_EMAIL, falling back
 * to EMAIL_FROM so it works with no new config. Never throws into the webhook
 * handler. Scheduled when recordWabaHealth reports `shouldAlert`.
 */
export const sendWabaAlert = internalAction({
	args: { summary: v.string() },
	handler: async (_ctx, { summary }): Promise<void> => {
		const to = process.env.ADMIN_ALERT_EMAIL ?? process.env.EMAIL_FROM;
		console.error(`WABA ALERT: shared-number health changed — ${summary}`);
		if (!to) {
			console.error("WABA alert email skipped: no ADMIN_ALERT_EMAIL / EMAIL_FROM");
			return;
		}
		const body = `The shared WhatsApp number's health changed.\n\n${summary}\n\nLOW pauses all non-transactional sends platform-wide until it recovers; MEDIUM pauses Marketing only. Check Meta Business Manager → WhatsApp Manager → Phone numbers.`;
		try {
			await sendEmail(to, "[Kedaipal] WABA health alert", `<pre>${body}</pre>`, body);
		} catch (err) {
			console.error("WABA alert email failed", err);
		}
	},
});

/** Notify a retailer their outbound is paused (non-transactional only). */
export const notifyRetailerPaused = internalAction({
	args: { retailerId: v.id("retailers"), reason: v.optional(v.string()) },
	handler: async (ctx, { retailerId, reason }): Promise<void> => {
		const email = await ctx.runQuery(
			internal.wabaProtection.getRetailerNotifyEmail,
			{ retailerId },
		);
		if (!email) return;
		const body = `Your store's WhatsApp broadcast/marketing sends have been paused${
			reason ? ` (reason: ${reason})` : ""
		}. Your customers' order confirmations and status updates are NOT affected and continue as normal. This usually protects our shared WhatsApp number's quality. Please contact Kedaipal support to resolve it.`;
		try {
			await sendEmail(
				email,
				"[Kedaipal] Your WhatsApp sending is paused",
				`<p>${body}</p>`,
				body,
			);
		} catch (err) {
			console.error("WABA retailer-paused email failed", err);
		}
	},
});

export const getRetailerNotifyEmail = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<string | null> => {
		const r = await ctx.db.get(retailerId);
		return r?.notifyEmail ?? null;
	},
});

// ---------------------------------------------------------------------------
// Read helpers — visibility via CLI / dashboard until the Admin Console ships:
//   npx convex run wabaProtection:getWabaHealth
//   npx convex run wabaProtection:listRecentOutbound '{"retailerId":"<id>"}'
// ---------------------------------------------------------------------------

export const getWabaHealth = internalQuery({
	args: {},
	handler: async (ctx) =>
		ctx.db.query("wabaHealth").withIndex("by_observed").order("desc").first(),
});

export const listRecentOutbound = internalQuery({
	args: {
		retailerId: v.optional(v.id("retailers")),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { retailerId, limit }) => {
		const take = Math.min(limit ?? 50, 200);
		if (retailerId) {
			return ctx.db
				.query("outboundMessageLog")
				.withIndex("by_retailer_sent", (q) => q.eq("retailerId", retailerId))
				.order("desc")
				.take(take);
		}
		return ctx.db.query("outboundMessageLog").order("desc").take(take);
	},
});
