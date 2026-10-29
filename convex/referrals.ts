/**
 * Seller referrals (z8r3fdetf5, docs/referrals.md) — who referred whom.
 *
 * T1 owns the RECORD: a `referrals` row written at signup when the store
 * behind the `/referral/<slug>` link can refer, the public invite the link's
 * page shows, the referee's own view of it, and the admin fix-up for a
 * referral the link didn't capture. The reward (credits for both sides when
 * the referee's first plan invoice is paid) is T2 (86ey82hke) and reads these
 * rows; the rules both share live in `lib/referral.ts`.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { addPurchasedCredits } from "./credits";
import {
	requireAdmin,
	requireRetailerAccess,
	resolveMyRetailerFor,
	storeOwnerIsAdmin,
} from "./lib/auth";
import { billingPageUrl } from "./lib/billingUrl";
import { sendEmail } from "./lib/email";
import { pickLocale } from "./lib/locale";
import {
	type ListedPlan,
	PURCHASED_CREDIT_LIFETIME_MONTHS,
	type Plan,
} from "./lib/plans";
import { sanitizeReferrerSlug } from "./lib/poweredBy";
import {
	type ReferrerIneligibleReason,
	type ReferrerStanding,
	looksLikeSelfReferral,
	referralHref,
	referralRefereeOffer,
	referralRewardCredits,
	referrerStanding,
} from "./lib/referral";
import {
	type ReferralEmailKind,
	renderReferralEmail,
} from "./lib/referralEmailCopy";
import { addMonthsMyt } from "./lib/usagePeriod";
import {
	referralRefereeTemplateName,
	referralReferrerTemplateName,
	templateParam,
	WhatsAppSendError,
} from "./lib/whatsapp";
import { TEMPLATE_LANGUAGE } from "./lib/whatsappCopy";
import { classifyPushFailure } from "./lib/confirmationPush";
import { makeGuardedSender } from "./wabaProtection";
import { isUnclaimed } from "./lib/unclaimedStore";
import { loadSubscription } from "./subscriptions";

type AnyCtx = QueryCtx | MutationCtx;

/** Whether `retailer` can refer right now, from its subscription row. */
export async function standingOf(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
): Promise<ReferrerStanding> {
	const sub = await loadSubscription(ctx, retailer._id);
	return referrerStanding({
		status: sub?.status ?? null,
		comped: sub?.comped === true,
		ownerIsAdmin: storeOwnerIsAdmin(retailer),
		unclaimed: isUnclaimed(retailer),
	});
}

/**
 * The store a referral link names. Shape-checked first (a value that isn't a
 * slug can't name a store), then the CURRENT slug, then a renamed store's
 * parked old slug — so a link shared before a rename keeps working for as
 * long as the old slug is parked (the storefront's own redirect window).
 */
export async function findReferrerBySlug(
	ctx: AnyCtx,
	raw: string | undefined,
): Promise<Doc<"retailers"> | null> {
	const slug = sanitizeReferrerSlug(raw);
	if (!slug) return null;
	const current = await ctx.db
		.query("retailers")
		.withIndex("by_slug", (q) => q.eq("slug", slug))
		.first();
	if (current) return current;
	const parked = await ctx.db
		.query("slugHistory")
		.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
		.first();
	if (!parked || parked.expiresAt <= Date.now()) return null;
	return await ctx.db.get(parked.retailerId);
}

/** The referral row for a referee, if any. One per referee by construction. */
export async function referralForReferee(
	ctx: AnyCtx,
	refereeId: Id<"retailers">,
): Promise<Doc<"referrals"> | null> {
	return await ctx.db
		.query("referrals")
		.withIndex("by_referee", (q) => q.eq("refereeId", refereeId))
		.first();
}

/**
 * Whether the store has paid a PLAN invoice — the referral reward's trigger
 * (T2). Past it, the referral can no longer be set or changed: the moment it
 * paid out for (or didn't) is gone. A hold invoice can only follow a paid
 * plan invoice, so any paid row answers; the kind check keeps that honest.
 */
export async function hasPaidPlanInvoice(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	const invoices = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.collect();
	return invoices.some(
		(inv) => inv.status === "paid" && (inv.kind ?? "plan") === "plan",
	);
}

/**
 * At signup (`retailers.createRetailer`): resolve the referral link the
 * seller arrived with to the store that can refer RIGHT NOW. `null` when the
 * link names nobody, names a store that can't refer (trial, lapsed, paused,
 * unclaimed), or names the new store itself — and then nothing is recorded,
 * because nothing was promised: the invite page only shows the offer for a
 * store that can refer.
 *
 * Resolved BEFORE the new store is inserted (so its own fresh slug can never
 * answer), recorded after (`insertReferral`).
 */
export async function resolveSignupReferrer(
	ctx: MutationCtx,
	raw: string | undefined,
): Promise<Doc<"retailers"> | null> {
	const referrer = await findReferrerBySlug(ctx, raw);
	if (!referrer) return null;
	const standing = await standingOf(ctx, referrer);
	return standing.canRefer ? referrer : null;
}

/** Write a referee's referral row. The caller guarantees there is none yet. */
export async function insertReferral(
	ctx: MutationCtx,
	args: {
		refereeId: Id<"retailers">;
		referrerId: Id<"retailers">;
		via: Doc<"referrals">["via"];
		recordedBy: string;
		now: number;
	},
): Promise<Id<"referrals">> {
	if (args.refereeId === args.referrerId)
		throw new ConvexError("A store can't refer itself.");
	return await ctx.db.insert("referrals", {
		refereeId: args.refereeId,
		referrerId: args.referrerId,
		via: args.via,
		recordedBy: args.recordedBy,
		createdAt: args.now,
	});
}

// ---------------------------------------------------------------------------
// Public: the invite a referral link's page shows
// ---------------------------------------------------------------------------

export type ReferralInvite = {
	/** The referrer's CURRENT slug — what the cookie keeps, so a link shared
	 * before a rename is remembered by the name that resolves today. */
	slug: string;
	storeName: string;
	/** Bonus credits the referee gets when they pay their first invoice, per
	 * tier they might start on. */
	offer: Record<ListedPlan, number>;
};

/**
 * Public, no auth: who is inviting the visitor of `/referral/<slug>`, and
 * what they are offered. `null` when the link names nobody OR a store that
 * can't refer right now — the page then renders the plain landing and
 * promises nothing. Returns the store's public name and slug only; WHY a
 * store can't refer (trial, lapsed, …) is its private billing state and is
 * never said here.
 */
export const invite = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<ReferralInvite | null> => {
		const referrer = await findReferrerBySlug(ctx, slug);
		if (!referrer) return null;
		const standing = await standingOf(ctx, referrer);
		if (!standing.canRefer) return null;
		return {
			slug: referrer.slug,
			storeName: referrer.storeName,
			offer: referralRefereeOffer(),
		};
	},
});

// ---------------------------------------------------------------------------
// Seller: the referee's own view (plan picker / billing tab)
// ---------------------------------------------------------------------------

export type MyReferral = {
	/** The referrer's current name; `null` when that store has since been
	 * deleted (the referral — and the referee's reward — stands). */
	referrerName: string | null;
	offer: Record<ListedPlan, number>;
	/** Whether the referee has already paid their first plan invoice — the
	 * moment the reward lands (T2). */
	firstInvoicePaid: boolean;
	/** The bonus that landed, once it has (T2). */
	reward: { credits: number; at: number } | null;
};

/**
 * The caller's store as a REFEREE: who referred it and what it gets when it
 * starts its plan. Billing:read, like the rest of the billing tab it renders
 * in; `retailerId` is the admin act-as path (`myInvoices`' shape). `null` =
 * not referred (or no access).
 */
export const mine = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<MyReferral | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = retailerId
			? await requireRetailerAccess(ctx, retailerId, {
					area: "billing",
					level: "read",
				})
			: await resolveMyRetailerFor(ctx, { area: "billing", level: "read" });
		const retailer = access?.retailer ?? null;
		if (!retailer) return null;
		const row = await referralForReferee(ctx, retailer._id);
		if (!row) return null;
		const referrer = await ctx.db.get(row.referrerId);
		return {
			referrerName: referrer?.storeName ?? null,
			offer: referralRefereeOffer(),
			firstInvoicePaid: await hasPaidPlanInvoice(ctx, retailer._id),
			reward:
				row.rewardedAt !== undefined && row.refereeCredits !== undefined
					? { credits: row.refereeCredits, at: row.rewardedAt }
					: null,
		};
	},
});

// ---------------------------------------------------------------------------
// Admin: put right a referral the link didn't capture
// ---------------------------------------------------------------------------

/** What an admin reads when a referrer can't refer — the one author. */
const INELIGIBLE_COPY: Record<ReferrerIneligibleReason, string> = {
	trial: "is still on its free trial — a store refers once its plan is paid",
	paused: "is on an Off-Season Hold, so its referrals are paused",
	lapsed: "has no active plan (past due or cancelled)",
	unclaimed: "hasn't been claimed by its owner yet",
	no_plan: "has no subscription",
};

/** Refuse once the referee has paid its first plan invoice: the reward
 * moment has passed, and a change now could only mislead the ledger. */
async function assertReferralEditable(
	ctx: MutationCtx,
	refereeId: Id<"retailers">,
): Promise<void> {
	if (await hasPaidPlanInvoice(ctx, refereeId))
		throw new ConvexError(
			"This store has already paid its first invoice, so its referral can no longer change. Use a credits adjustment if a reward was missed.",
		);
}

/**
 * Admin: record (or change) who referred a store — for a referral the link
 * didn't capture (the seller signed up in another browser, or the intro was
 * made off-link). Same rules as the link: the referrer must be able to refer
 * now, a store can't refer itself, and the referee must not have paid its
 * first plan invoice yet. Audited.
 */
export const adminSetReferrer = mutation({
	args: { refereeId: v.id("retailers"), referrerSlug: v.string() },
	handler: async (ctx, { refereeId, referrerSlug }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const referee = await ctx.db.get(refereeId);
		if (!referee) throw new ConvexError("Store not found");
		await assertReferralEditable(ctx, refereeId);
		const referrer = await findReferrerBySlug(ctx, referrerSlug);
		if (!referrer)
			throw new ConvexError(
				`No store has the link kedaipal.com/${referrerSlug.trim()}.`,
			);
		if (referrer._id === refereeId)
			throw new ConvexError("A store can't refer itself.");
		const standing = await standingOf(ctx, referrer);
		if (!standing.canRefer)
			throw new ConvexError(
				`${referrer.storeName} can't refer right now: it ${INELIGIBLE_COPY[standing.reason]}.`,
			);
		const now = Date.now();
		const existing = await referralForReferee(ctx, refereeId);
		if (existing) {
			if (existing.referrerId === referrer._id) return;
			await ctx.db.patch(existing._id, {
				referrerId: referrer._id,
				via: "admin",
				recordedBy: adminUserId,
				createdAt: now,
			});
		} else {
			await insertReferral(ctx, {
				refereeId,
				referrerId: referrer._id,
				via: "admin",
				recordedBy: adminUserId,
				now,
			});
		}
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId: refereeId,
			action: "referrals.adminSetReferrer",
			targetId: referrer._id,
			ts: now,
		});
	},
});

/** Admin: remove a store's referral (recorded by mistake). Same editability
 * rule as setting one; idempotent, so a double-click logs nothing twice. */
export const adminClearReferral = mutation({
	args: { refereeId: v.id("retailers") },
	handler: async (ctx, { refereeId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const existing = await referralForReferee(ctx, refereeId);
		if (!existing) return;
		await assertReferralEditable(ctx, refereeId);
		await ctx.db.delete(existing._id);
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId: refereeId,
			action: "referrals.adminClearReferral",
			targetId: existing.referrerId,
			ts: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// T2 (86ey82hke): the reward, at the referee's first paid plan invoice
// ---------------------------------------------------------------------------

/**
 * Scheduled by `invoices.settleInvoicePaid` — the ONE settle path every rail
 * (Pay-now webhook, auto-charge, admin mark-paid) funnels into — when a
 * store's FIRST plan invoice is paid. Lands both sides' bonus credits in the
 * purchased bucket (12-month lots) and stamps the referral row in ONE
 * transaction of its own (`grantForFirstInvoice`), so the stamp IS the
 * idempotency guard — a second run finds `rewardedAt` and does nothing — and
 * a throw anywhere in here rolls back every write together. It runs in its
 * own mutation rather than inside the settle for exactly that reason: a
 * caught error inside the settle would have swallowed a HALF-done grant
 * (referee credited, row unstamped, never retried), and an uncaught one
 * would have failed the payment over a bonus. Scheduled from the settle, it
 * can do neither (PR #393 review).
 *
 * Both halves are sized by the tier the REFEREE paid for (Zaki, 20 Oct 2026):
 * 30% of a month of its list grant — Pro 60 / Starter 30 — to each side. The
 * referrer's own plan doesn't enter it, so bringing in a Pro store pays more
 * than bringing in a Starter: the incentive tracks the revenue. The referrer
 * half is withheld when they are unmetered (comped or Kedaipal-owned —
 * already unlimited), deleted, or the same person as the referee
 * (`looksLikeSelfReferral`); the row says which. Whether they could still
 * refer TODAY doesn't matter: the referral was valid when it was made, and
 * that was the promise.
 *
 * No referral row ⇒ nothing (most stores). Returns what happened, for tests.
 */
export async function grantReferralRewards(
	ctx: MutationCtx,
	args: { refereeId: Id<"retailers">; paidPlan: Plan; now: number },
): Promise<Doc<"referrals"> | null> {
	const row = await referralForReferee(ctx, args.refereeId);
	if (!row || row.rewardedAt !== undefined) return null;
	const referee = await ctx.db.get(args.refereeId);
	if (!referee) return null;
	const referrer = await ctx.db.get(row.referrerId);

	const credits = referralRewardCredits(args.paidPlan);
	const landed = await addPurchasedCredits(ctx, {
		retailerId: args.refereeId,
		credits,
		source: "referral",
		type: "grant",
		reason: "referral_referee",
		refId: row._id,
		refLabel: referrer?.storeName,
		createdBy: "system",
		now: args.now,
	});

	let referrerCredits: number | undefined;
	let referrerOutcome: NonNullable<Doc<"referrals">["referrerOutcome"]>;
	if (!referrer) {
		referrerOutcome = "deleted";
	} else if (
		looksLikeSelfReferral({
			refereeEmails: [referee.notifyEmail],
			refereePhone: referee.waPhone ?? referee.notifyWaPhone,
			referrerEmails: [referrer.notifyEmail],
			referrerPhone: referrer.waPhone ?? referrer.notifyWaPhone,
		})
	) {
		referrerOutcome = "self";
	} else {
		const sub = await loadSubscription(ctx, referrer._id);
		if (sub?.comped === true || storeOwnerIsAdmin(referrer)) {
			referrerOutcome = "unmetered";
		} else {
			const granted = await addPurchasedCredits(ctx, {
				retailerId: referrer._id,
				credits,
				source: "referral",
				type: "grant",
				reason: "referral_referrer",
				refId: row._id,
				refLabel: referee.storeName,
				createdBy: "system",
				now: args.now,
			});
			referrerOutcome = granted ? "granted" : "unmetered";
			if (granted) referrerCredits = credits;
		}
	}

	const patch = {
		rewardedAt: args.now,
		...(landed ? { refereeCredits: credits } : {}),
		...(referrerCredits !== undefined ? { referrerCredits } : {}),
		referrerOutcome,
	};
	await ctx.db.patch(row._id, patch);

	const expiresAt = addMonthsMyt(args.now, PURCHASED_CREDIT_LIFETIME_MONTHS);
	const tell = async (
		to: Id<"retailers">,
		kind: ReferralEmailKind,
		otherStoreId: Id<"retailers">,
		amount: number,
	) => {
		const payload = { to, kind, otherStoreId, credits: amount, expiresAt };
		await ctx.scheduler.runAfter(0, internal.referrals.sendRewardEmail, payload);
		// The WhatsApp half sends only once Meta has approved the template
		// (env set) — until then the email carries it. Same shape as the
		// credit balance notices.
		await ctx.scheduler.runAfter(0, internal.referrals.sendRewardWhatsApp, {
			to,
			kind,
			otherStoreId,
			credits: amount,
		});
	};
	if (landed) await tell(args.refereeId, "referee", row.referrerId, credits);
	if (referrerCredits !== undefined)
		await tell(row.referrerId, "referrer", args.refereeId, referrerCredits);
	console.info("[referral] rewarded", {
		referralId: row._id,
		refereeCredits: landed ? credits : 0,
		referrerOutcome,
	});
	return { ...row, ...patch };
}

/** The transaction the settle schedules (see `grantReferralRewards`). A
 * store with no referral row returns at once — most stores. */
export const grantForFirstInvoice = internalMutation({
	args: {
		refereeId: v.id("retailers"),
		paidPlan: v.union(
			v.literal("starter"),
			v.literal("pro"),
			v.literal("enterprise"),
		),
	},
	handler: async (ctx, { refereeId, paidPlan }): Promise<void> => {
		await grantReferralRewards(ctx, { refereeId, paidPlan, now: Date.now() });
	},
});

export const rewardEmailContext = internalQuery({
	args: { to: v.id("retailers"), otherStoreId: v.id("retailers") },
	handler: async (ctx, { to, otherStoreId }) => {
		const store = await ctx.db.get(to);
		if (!store) return null;
		const other = await ctx.db.get(otherStoreId);
		return {
			storeName: store.storeName,
			// Meta-param hygiene: a store name with a tab or 4+ spaces is a
			// terminal template rejection, and the seller types it themselves.
			templateStoreName: templateParam(store.storeName, "your store"),
			slug: store.slug,
			notifyEmail: store.notifyEmail,
			notifyWaPhone: store.notifyWaPhone,
			locale: pickLocale(store.locale),
			otherStoreName: other?.storeName ?? null,
			templateOtherStoreName: templateParam(
				other?.storeName ?? "",
				"a Kedaipal seller",
			),
		};
	},
});

/** The reward email — to the seller's `notifyEmail`, in their locale. A
 * failure is logged, never retried into a second email: the credits and the
 * Credit activity row already say it. */
export const sendRewardEmail = internalAction({
	args: {
		to: v.id("retailers"),
		kind: v.union(v.literal("referee"), v.literal("referrer")),
		otherStoreId: v.id("retailers"),
		credits: v.number(),
		expiresAt: v.number(),
	},
	handler: async (ctx, args): Promise<void> => {
		const meta = await ctx.runQuery(internal.referrals.rewardEmailContext, {
			to: args.to,
			otherStoreId: args.otherStoreId,
		});
		if (!meta?.notifyEmail) return;
		const kind: ReferralEmailKind = args.kind;
		const rendered = renderReferralEmail(meta.locale, kind, {
			storeName: meta.storeName,
			otherStoreName: meta.otherStoreName,
			credits: args.credits,
			expiresAt: args.expiresAt,
			billingUrl: billingPageUrl(),
			referralLink: kind === "referrer" ? referralHref(meta.slug) : undefined,
		});
		try {
			await sendEmail(
				meta.notifyEmail,
				rendered.subject,
				rendered.html,
				rendered.text,
			);
		} catch (err) {
			console.error("[referral] reward email failed", { ...args, err });
		}
	},
});

/**
 * The WhatsApp half of the reward notice — the approved utility template for
 * the side, when Meta has approved it (env set) and the seller has an alert
 * number. Gated by the WABA gateway like every seller template; a transient
 * send failure retries on the push-failure schedule, a terminal one is logged
 * (the email already went). Params: store, credits, the other store.
 */
export const sendRewardWhatsApp = internalAction({
	args: {
		to: v.id("retailers"),
		kind: v.union(v.literal("referee"), v.literal("referrer")),
		otherStoreId: v.id("retailers"),
		credits: v.number(),
		attempt: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<void> => {
		const attempt = args.attempt ?? 1;
		const templateName =
			args.kind === "referrer"
				? referralReferrerTemplateName()
				: referralRefereeTemplateName();
		if (!templateName) return; // not approved yet — the email carries it
		const meta = await ctx.runQuery(internal.referrals.rewardEmailContext, {
			to: args.to,
			otherStoreId: args.otherStoreId,
		});
		if (!meta?.notifyWaPhone) return;
		const wa = makeGuardedSender(ctx, args.to, "utility_template");
		try {
			const receipt = await wa.send(meta.notifyWaPhone, {
				kind: "template",
				templateName,
				languageCode: TEMPLATE_LANGUAGE[meta.locale],
				bodyParams: [
					meta.templateStoreName,
					String(args.credits),
					meta.templateOtherStoreName,
				],
				// Registered button URL: https://kedaipal.com/app/settings?tab={{1}}
				urlButtonParam: "billing",
			});
			if (receipt?.blocked) {
				console.warn("[referral] reward WhatsApp suppressed by gateway", {
					to: args.to,
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
			console.error("[referral] reward WhatsApp failed", {
				to: args.to,
				kind: args.kind,
				attempt,
				outcome,
				err,
			});
			if (outcome.retry) {
				await ctx.scheduler.runAfter(
					outcome.delayMs,
					internal.referrals.sendRewardWhatsApp,
					{ ...args, attempt: attempt + 1 },
				);
			}
		}
	},
});

// ---------------------------------------------------------------------------
// T3 (z8r3fdfp97): the "Refer a kedai" card
// ---------------------------------------------------------------------------

/** How many of a referrer's rows the card counts. A seller with more than
 * this many referrals is a partner conversation, not a card. */
const STATS_CAP = 500;

export type MyReferralCard = {
	slug: string;
	link: string;
	/** The store's own name — the share message opens with it. */
	storeName: string;
	/** Whether this store's link counts right now, and why not. */
	standing: ReferrerStanding;
	/** The bonus, per tier the REFEREE starts on — the same number lands on
	 * each side, so this is also what THIS store earns (when `earns`). */
	offer: Record<ListedPlan, number>;
	/** Whether this store earns the referrer half — false for a comped or
	 * Kedaipal-owned store (already unlimited). */
	earns: boolean;
	signedUp: number;
	/** Referees who paid their first invoice (the reward moment). */
	started: number;
	/** Credits this store has earned from referrals so far. */
	creditsEarned: number;
	/** The count hit STATS_CAP. */
	capped: boolean;
	/** Referees who signed up and haven't paid their first invoice yet — the
	 * reward WAITING on them. The state that gets a card opened. */
	pending: number;
	/** The newest of those, for the Home teaser's one line ("Che Ta signed
	 * up 3 days ago · 60 waiting"). A referee's store name is public — it is
	 * their storefront's — so any member may read it. `storeName` is null
	 * for a store since deleted. */
	latestPending: { storeName: string | null; createdAt: number } | null;
};

/**
 * The caller's store as a REFERRER, for the Home card. Any member may read it:
 * the link is public and the counts are counts — no referee is named. `null`
 * when signed out or storeless.
 */
export const myCard = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<MyReferralCard | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = retailerId
			? await requireRetailerAccess(ctx, retailerId, { anyMember: true })
			: await resolveMyRetailerFor(ctx, { anyMember: true });
		const retailer = access?.retailer ?? null;
		if (!retailer) return null;
		const standing = await standingOf(ctx, retailer);
		// Newest first, so the first unrewarded row IS the latest pending one.
		const rows = await ctx.db
			.query("referrals")
			.withIndex("by_referrer_created", (q) => q.eq("referrerId", retailer._id))
			.order("desc")
			.take(STATS_CAP);
		let started = 0;
		let creditsEarned = 0;
		let latestPending: MyReferralCard["latestPending"] = null;
		for (const r of rows) {
			if (r.rewardedAt !== undefined) {
				started += 1;
			} else if (latestPending === null) {
				const referee = await ctx.db.get(r.refereeId);
				latestPending = {
					storeName: referee?.storeName ?? null,
					createdAt: r.createdAt,
				};
			}
			creditsEarned += r.referrerCredits ?? 0;
		}
		return {
			slug: retailer.slug,
			link: referralHref(retailer.slug),
			storeName: retailer.storeName,
			standing,
			offer: referralRefereeOffer(),
			earns: standing.canRefer && standing.earnsReward,
			signedUp: rows.length,
			started,
			creditsEarned,
			capped: rows.length >= STATS_CAP,
			pending: rows.length - started,
			latestPending,
		};
	},
});

// ---------------------------------------------------------------------------
// Refer & earn page (28 Oct 2026 push): one row per referee
// ---------------------------------------------------------------------------

export type MyReferralRow = {
	id: Id<"referrals">;
	/** The referee's store name — public (it is their storefront's). `null`
	 * when that store has since been deleted. */
	storeName: string | null;
	/** The referee's public WhatsApp number (the one their storefront shows),
	 * so the referrer can nudge a kedai that signed up but hasn't started —
	 * a word from a friend converts where an email from us doesn't. */
	waPhone: string | null;
	createdAt: number;
	/** `started` once the referee paid their first plan invoice (the reward
	 * moment); `signed_up` while the reward waits on them. */
	status: "signed_up" | "started";
	rewardedAt: number | null;
	/** What THIS store received for the row — 0 when nothing did
	 * (`referrerOutcome` says why), and while the reward waits. */
	referrerCredits: number;
	referrerOutcome: Doc<"referrals">["referrerOutcome"] | null;
};

/**
 * The caller's referees, newest first, for the Refer & earn page's list.
 * Credits:read — the rows say what the store EARNED, which is credits-area
 * data (the Home card stays any-member: counts, no earnings per row). An
 * admin acting as the store passes `retailerId`. `null` when signed out or
 * storeless; a member without the grant is refused by the access layer and
 * the page shows the NeedsAccessNote in the list's place.
 */
export const myReferrals = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ rows: MyReferralRow[]; capped: boolean } | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = retailerId
			? await requireRetailerAccess(ctx, retailerId, {
					area: "credits",
					level: "read",
				})
			: await resolveMyRetailerFor(ctx, { area: "credits", level: "read" });
		const retailer = access?.retailer ?? null;
		if (!retailer) return null;
		const rows = await ctx.db
			.query("referrals")
			.withIndex("by_referrer_created", (q) => q.eq("referrerId", retailer._id))
			.order("desc")
			.take(STATS_CAP);
		const out: MyReferralRow[] = [];
		for (const r of rows) {
			const referee = await ctx.db.get(r.refereeId);
			out.push({
				id: r._id,
				storeName: referee?.storeName ?? null,
				waPhone: referee?.waPhone ?? null,
				createdAt: r.createdAt,
				status: r.rewardedAt !== undefined ? "started" : "signed_up",
				rewardedAt: r.rewardedAt ?? null,
				referrerCredits: r.referrerCredits ?? 0,
				referrerOutcome: r.referrerOutcome ?? null,
			});
		}
		return { rows: out, capped: rows.length >= STATS_CAP };
	},
});
