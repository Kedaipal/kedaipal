// Kedaipal Credits balance notices (Credits T3, ClickUp z8r3fdf8hy,
// docs/credits.md#notices). The seller hears about their balance at the four
// moments that matter — running low (the last 20% of the month's credits,
// `lowCreditLine`), out of credits, still short after a monthly refresh, back
// above zero — plus 14 days before bought credits expire.
//
// Shape:
//  - The ledger's one write path (`applyEntry`) schedules `evaluate` a few
//    minutes after the balance crosses a line. `evaluate` reads the state AT
//    THAT MOMENT, so a burst that takes a store from 25 to −3 sends one
//    "you're out", never a "running low" followed by it.
//  - Dedupe lives on `creditAccounts.notices` ({periodKey, sent}): "low" once a
//    period, "locked" once per lock (carried across a month boundary so a lock
//    that spans the 1st isn't re-announced — "still_locked" says it instead).
//  - Every notice is an EMAIL (always) plus a WhatsApp utility template when
//    Meta has approved it and the seller has an alert number — the louder
//    second tap, like the past-due alert (never gated on `orderWaAlerts`: a
//    locked seller must hear it). No fallback: the email already went.
//  - Comped, admin-owned and missing-row stores are metered but never locked,
//    so they get no balance notices. A store on a custom grant gets no "low"
//    nudge (its allowance was negotiated) but does hear about a lock.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { billingPageUrl } from "./lib/billingUrl";
import { loadCreditAccount, projectedCredits } from "./credits";
import { storeOwnerIsAdmin } from "./lib/auth";
import { classifyPushFailure } from "./lib/confirmationPush";
import {
	creditBalancePhrase,
	type CreditEmailKey,
	renderCreditEmail,
} from "./lib/creditEmailCopy";
import {
	type CreditNoticeKind,
	type CreditUnlockRoute,
	creditLockExempt,
	storeIsMetered,
	creditUnlockRoute,
	dueCreditNotice,
	lowCreditLine,
} from "./lib/credits";
import { sendEmail } from "./lib/email";
import type { Locale } from "./lib/emailCopy";
import { resolveBillingGatewayCredentials } from "./lib/hitpayBilling";
import { pickLocale } from "./lib/locale";
import { MYT_OFFSET_MS } from "./lib/fulfilmentDate";
import { PLAN_CREDIT_GRANT } from "./lib/plans";
import { usagePeriodKey } from "./lib/usagePeriod";
import {
	creditsLockedTemplateName,
	creditsLowTemplateName,
	creditsUnlockedTemplateName,
	templateParam,
	WhatsAppSendError,
} from "./lib/whatsapp";
import { TEMPLATE_LANGUAGE } from "./lib/whatsappCopy";
import { makeGuardedSender } from "./wabaProtection";

/** How long before a lot expires the seller is told. */
const EXPIRY_NOTICE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;

const inRouteValidator = v.union(
	v.literal("topup"),
	v.literal("refresh"),
	v.literal("settle"),
	v.literal("upgrade"),
	v.literal("resume"),
	v.literal("adjust"),
	v.literal("refund"),
);

const noticeKindValidator = v.union(
	v.literal("low"),
	v.literal("locked"),
	v.literal("still_locked"),
	v.literal("unlocked"),
);

const EMAIL_KEY: Record<CreditNoticeKind, CreditEmailKey> = {
	low: "low",
	locked: "locked",
	still_locked: "stillLocked",
	unlocked: "unlocked",
};

/** Whether a store is never nudged about its balance: one that is metered but
 * never locked (sponsored), or one credits don't apply to at all (an admin's
 * own store — unmetered, so there is no balance to nudge about). */
function exempt(
	retailer: Doc<"retailers">,
	sub: Doc<"subscriptions"> | null,
): boolean {
	if (!storeIsMetered({ ownerIsAdmin: storeOwnerIsAdmin(retailer) }))
		return true;
	return creditLockExempt({
		status: sub?.status ?? null,
		comped: sub?.comped === true,
	});
}

/**
 * A plan with more included orders, when moving up beats buying packs — named
 * in the running-low email (never in the WhatsApp template: utility only).
 * Starter → Pro is the one case where it's cleanly cheaper for the extra
 * orders; above that, packs are the honest answer until volume is steady.
 */
function upgradeHint(
	sub: Doc<"subscriptions"> | null,
	customGrant: boolean,
): { planName: string; included: number } | undefined {
	if (customGrant || sub?.status !== "active" || sub.plan !== "starter")
		return undefined;
	return { planName: "Pro", included: PLAN_CREDIT_GRANT.pro };
}

/**
 * Decide which notice (if any) the store is owed right now, record it, and
 * send it. Scheduled by the ledger a few minutes after a line is crossed.
 */
export const evaluate = internalMutation({
	args: { retailerId: v.id("retailers"), route: inRouteValidator },
	handler: async (
		ctx,
		{ retailerId, route: inRoute },
	): Promise<CreditNoticeKind | null> => {
		// The three balance notices run for real now that the gate is per order
		// (Credits T3.1). They were suppressed for one release by
		// `CREDIT_LOCK_ENABLED` while the store-wide lock sat switched off, and
		// nothing was written to `creditAccounts.notices` in that time — which
		// was the point: every store is announced to cleanly on this release
		// rather than carrying a dedupe marker for an email nobody received.
		//
		// What each one says changed with the rule. "You're out" is now "your
		// newest orders are waiting" — see `creditEmailCopy.ts` and
		// `creditLockMessage`, which share the sentence with the server refusal.
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		const account = await loadCreditAccount(ctx, retailerId);
		if (!account) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (exempt(retailer, sub)) return null;
		const now = Date.now();
		const projected = await projectedCredits(ctx, retailerId, account, now);
		if (!projected) return null;

		const periodKey = usagePeriodKey(now);
		const prev = account.notices;
		const samePeriod = prev?.periodKey === periodKey;
		const carriedLock = prev?.sent.includes("locked") === true;
		// A lock announced last month is still announced: carry the marker so
		// it isn't re-sent, and let the refresh say "still short" instead.
		const sent: string[] = samePeriod
			? [...(prev?.sent ?? [])]
			: carriedLock
				? ["locked"]
				: [];
		const kind = dueCreditNotice({
			total: projected.total,
			sent,
			refreshedWhileLocked: carriedLock && !samePeriod,
			customGrant: account.grantOverride !== undefined,
			lowLine: lowCreditLine(projected.periodGrant),
		});

		let nextSent = sent;
		if (kind === "unlocked")
			nextSent = sent.filter((k) => k !== "locked" && k !== "still_locked");
		// Announcing the lock also spends this period's "low" nudge — the
		// seller must never hear "running low" AFTER being told they're out.
		else if (kind === "locked")
			nextSent = [...new Set([...sent, "locked", "low"])];
		else if (kind) nextSent = [...sent, kind];
		if (!samePeriod || kind) {
			await ctx.db.patch(account._id, {
				notices: { periodKey, sent: nextSent },
			});
		}
		if (!kind) return null;

		const route = creditUnlockRoute(sub?.status ?? null);
		await ctx.scheduler.runAfter(0, internal.creditNotices.sendNoticeEmail, {
			retailerId,
			key: EMAIL_KEY[kind],
			balance: projected.total,
			route,
			upgrade:
				kind === "low"
					? upgradeHint(sub, account.grantOverride !== undefined)
					: undefined,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.creditNotices.sendNoticeWhatsApp,
			{ retailerId, kind, balance: projected.total },
		);
		await ctx.scheduler.runAfter(0, internal.ga4Events.sendKeyEvent, {
			event:
				kind === "low"
					? "credits_low_nudge_sent"
					: kind === "unlocked"
						? "credits_seller_unlocked"
						: "credits_seller_locked",
			retailerId,
			...(retailer.gaClientId !== undefined
				? { gaClientId: retailer.gaClientId }
				: {}),
			params:
				kind === "unlocked"
					? { route: inRoute }
					: kind === "low"
						? { orders_left: projected.total }
						: { balance: projected.total, still: kind === "still_locked" },
		});
		return kind;
	},
});

/** Everything a notice send needs, in one read. */
export const noticeContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		storeName: string;
		templateStoreName: string;
		notifyEmail: string | undefined;
		notifyWaPhone: string | undefined;
		locale: Locale;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return {
			storeName: retailer.storeName,
			// Meta-param hygiene: a store name with a tab or 4+ spaces is a
			// terminal template rejection, and the seller types it themselves.
			templateStoreName: templateParam(retailer.storeName, "your store"),
			notifyEmail: retailer.notifyEmail,
			notifyWaPhone: retailer.notifyWaPhone,
			locale: pickLocale(retailer.locale),
		};
	},
});

const emailKeyValidator = v.union(
	v.literal("low"),
	v.literal("locked"),
	v.literal("stillLocked"),
	v.literal("unlocked"),
	v.literal("expiring"),
);

const unlockRouteValidator = v.union(
	v.literal("topup"),
	v.literal("pick_plan"),
	v.literal("pay_invoice"),
	v.literal("resume"),
	v.literal("subscribe"),
);

/** The email half — always sent (billing notices go to `notifyEmail` whatever
 * the seller's order-alert settings; a lock is not opt-out-able). */
export const sendNoticeEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: emailKeyValidator,
		balance: v.number(),
		route: unlockRouteValidator,
		upgrade: v.optional(
			v.object({ planName: v.string(), included: v.number() }),
		),
		expiring: v.optional(
			v.object({ credits: v.number(), expiresAt: v.number() }),
		),
	},
	handler: async (ctx, args): Promise<void> => {
		const meta = await ctx.runQuery(internal.creditNotices.noticeContext, {
			retailerId: args.retailerId,
		});
		if (!meta?.notifyEmail) return;
		const topUpAvailable =
			resolveBillingGatewayCredentials(process.env) !== null;
		// When a top-up is the way back, the email's button opens the pack
		// picker itself (T2's `topup=1`) — one tap, not a hunt through Billing.
		const opensPicker =
			topUpAvailable &&
			args.route === "topup" &&
			(args.key === "low" ||
				args.key === "locked" ||
				args.key === "stillLocked");
		const rendered = renderCreditEmail(meta.locale, args.key, {
			storeName: meta.storeName,
			billingUrl: billingPageUrl(opensPicker ? "topup=1" : undefined),
			route: args.route as CreditUnlockRoute,
			balance: args.balance,
			topUpAvailable,
			upgrade: args.upgrade,
			expiring: args.expiring
				? {
						credits: args.expiring.credits,
						onFormatted: formatDate(args.expiring.expiresAt, meta.locale),
					}
				: undefined,
		});
		try {
			await sendEmail(
				meta.notifyEmail,
				rendered.subject,
				rendered.html,
				rendered.text,
			);
		} catch (err) {
			console.error("[credits] notice email failed", {
				retailerId: args.retailerId,
				key: args.key,
				err,
			});
		}
	},
});

/** The WhatsApp half — the approved utility template for the notice, when
 * Meta has approved it (env set) and the seller has an alert number. */
export const sendNoticeWhatsApp = internalAction({
	args: {
		retailerId: v.id("retailers"),
		kind: noticeKindValidator,
		balance: v.number(),
		attempt: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<void> => {
		const attempt = args.attempt ?? 1;
		const templateName =
			args.kind === "low"
				? creditsLowTemplateName()
				: args.kind === "unlocked"
					? creditsUnlockedTemplateName()
					: creditsLockedTemplateName();
		if (!templateName) return; // not approved yet — the email carries it
		const meta = await ctx.runQuery(internal.creditNotices.noticeContext, {
			retailerId: args.retailerId,
		});
		if (!meta?.notifyWaPhone) return;
		const secondParam =
			args.kind === "locked" || args.kind === "still_locked"
				? creditBalancePhrase(args.balance, meta.locale)
				: String(Math.max(0, args.balance));
		const wa = makeGuardedSender(ctx, args.retailerId, "utility_template");
		try {
			const receipt = await wa.send(meta.notifyWaPhone, {
				kind: "template",
				templateName,
				languageCode: TEMPLATE_LANGUAGE[meta.locale],
				bodyParams: [meta.templateStoreName, secondParam],
				// Registered button URL: https://kedaipal.com/app/settings?tab={{1}}
				// — the same approved shape as billing_past_due_utility.
				urlButtonParam: "billing",
			});
			if (receipt?.blocked) {
				console.warn("[credits] notice WhatsApp suppressed by gateway", {
					retailerId: args.retailerId,
					kind: args.kind,
					status: receipt.blocked,
				});
			}
		} catch (err) {
			const outcome = classifyPushFailure(
				err instanceof WhatsAppSendError
					? {
							httpStatus: err.httpStatus,
							metaCode: err.metaCode,
							responded: err.responded,
						}
					: { responded: true },
				attempt,
			);
			console.error("[credits] notice WhatsApp failed", {
				retailerId: args.retailerId,
				kind: args.kind,
				attempt,
				outcome,
				err,
			});
			if (outcome.retry) {
				await ctx.scheduler.runAfter(
					outcome.delayMs,
					internal.creditNotices.sendNoticeWhatsApp,
					{ ...args, attempt: attempt + 1 },
				);
			}
		}
	},
});

/**
 * Daily (crons.ts, 00:15 MYT): tell each store 14 days before any of its
 * bought credits expire — once per lot, grouped into one email per store. So
 * credits never vanish unannounced ("where did they go?" is a missing piece
 * of UI, not a surprise). Informational, so exempt stores are told too.
 */
export const internalExpiryNotices = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ stores: number }> => {
		const now = Date.now();
		const due = await ctx.db
			.query("creditLots")
			.withIndex("by_open_expiry", (q) =>
				q.eq("open", true).lte("expiresAt", now + EXPIRY_NOTICE_WINDOW_MS),
			)
			.take(SWEEP_BATCH * 5);
		const byStore = new Map<
			Id<"retailers">,
			{ credits: number; expiresAt: number; lots: Id<"creditLots">[] }
		>();
		for (const lot of due) {
			if (lot.expiryNoticeAt !== undefined || lot.expiresAt <= now) continue;
			const entry = byStore.get(lot.retailerId) ?? {
				credits: 0,
				expiresAt: lot.expiresAt,
				lots: [],
			};
			entry.credits += lot.remaining;
			entry.expiresAt = Math.min(entry.expiresAt, lot.expiresAt);
			entry.lots.push(lot._id);
			byStore.set(lot.retailerId, entry);
			if (byStore.size >= SWEEP_BATCH) break;
		}
		for (const [retailerId, entry] of byStore) {
			for (const lotId of entry.lots)
				await ctx.db.patch(lotId, { expiryNoticeAt: now });
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			const projected = await projectedCredits(
				ctx,
				retailerId,
				await loadCreditAccount(ctx, retailerId),
				now,
			);
			await ctx.scheduler.runAfter(0, internal.creditNotices.sendNoticeEmail, {
				retailerId,
				key: "expiring",
				balance: projected?.total ?? 0,
				route: creditUnlockRoute(sub?.status ?? null),
				expiring: { credits: entry.credits, expiresAt: entry.expiresAt },
			});
		}
		return { stores: byStore.size };
	},
});

const MONTHS: Record<Locale, string[]> = {
	en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
	ms: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
	zh: [],
};

/** "12 Oct 2026" / "12 Okt 2026" / "2026年10月12日" on the MYT calendar. */
function formatDate(ms: number, locale: Locale): string {
	const d = new Date(ms + MYT_OFFSET_MS);
	const day = d.getUTCDate();
	const month = d.getUTCMonth();
	const year = d.getUTCFullYear();
	if (locale === "zh") return `${year}年${month + 1}月${day}日`;
	return `${day} ${MONTHS[locale][month]} ${year}`;
}
