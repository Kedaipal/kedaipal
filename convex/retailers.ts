import { v } from "convex/values";

const localeOverridesValidator = v.object({
	confirm: v.optional(v.string()),
	packed: v.optional(v.string()),
	shipped: v.optional(v.string()),
	delivered: v.optional(v.string()),
	cancelled: v.optional(v.string()),
	unknownFallback: v.optional(v.string()),
});

const messageTemplatesValidator = v.object({
	en: v.optional(localeOverridesValidator),
	ms: v.optional(localeOverridesValidator),
});

// Per-retailer SHORT status labels (tracking timeline / dashboard). Six optional
// strings per locale, mirroring `statusLabels` on the schema. Sanitized +
// length-capped in `sanitizeStatusLabels`.
const statusLabelOverridesValidator = v.object({
	pending: v.optional(v.string()),
	confirmed: v.optional(v.string()),
	packed: v.optional(v.string()),
	shipped: v.optional(v.string()),
	delivered: v.optional(v.string()),
	cancelled: v.optional(v.string()),
});

const statusLabelsValidator = v.object({
	en: v.optional(statusLabelOverridesValidator),
	ms: v.optional(statusLabelOverridesValidator),
});

// Phase 2 custom stages. `id`/`sortOrder` optional on the wire — the server
// generates missing ids and renumbers sortOrder to the array (display) order,
// like sanitizePaymentMethods. Cap / monotonic-anchor / label rules enforced in
// sanitizeOrderStages via assertValidOrderStages.
const orderStagesValidator = v.array(
	v.object({
		id: v.optional(v.string()),
		anchor: v.union(
			v.literal("confirmed"),
			v.literal("packed"),
			v.literal("shipped"),
			v.literal("delivered"),
		),
		label: v.object({ en: v.string(), ms: v.optional(v.string()) }),
		description: v.optional(
			v.object({ en: v.optional(v.string()), ms: v.optional(v.string()) }),
		),
		notify: v.boolean(),
		sortOrder: v.optional(v.number()),
	}),
);

// Loose wire shape (id/sortOrder optional) before sanitize normalizes it.
type OrderStageInput = {
	id?: string;
	anchor: StageAnchor;
	label: { en: string; ms?: string };
	description?: { en?: string; ms?: string };
	notify: boolean;
	sortOrder?: number;
};

/**
 * Normalize a proposed stage list: trim labels/descriptions (dropping blank
 * locale fields), generate stable ids for new stages, renumber `sortOrder` to
 * the array (display) order, then enforce the config rules (cap, band,
 * monotonic anchors, label caps) via `assertValidOrderStages`. Empty array →
 * undefined, which makes the retailer fall back to synthesized default stages.
 * Throws a plain Error on a rule violation; the mutation wraps it in ConvexError.
 */
function sanitizeOrderStages(
	input: OrderStageInput[] | undefined,
): OrderStage[] | undefined {
	if (!input || input.length === 0) return undefined;
	const out: OrderStage[] = input.map((s, i) => {
		const en = (s.label?.en ?? "").trim();
		const ms = (s.label?.ms ?? "").trim();
		const descEn = (s.description?.en ?? "").trim();
		const descMs = (s.description?.ms ?? "").trim();
		const description =
			descEn || descMs
				? {
						...(descEn ? { en: descEn } : {}),
						...(descMs ? { ms: descMs } : {}),
					}
				: undefined;
		// Reuse a client-supplied stable id; mint one for a brand-new stage. Never
		// collides with synthesized "default:<anchor>" ids.
		const id = (s.id ?? "").trim() || crypto.randomUUID();
		return {
			id,
			anchor: s.anchor,
			label: { en, ...(ms ? { ms } : {}) },
			...(description ? { description } : {}),
			notify: Boolean(s.notify),
			sortOrder: i,
		};
	});
	assertValidOrderStages(out);
	return out;
}

const paymentInstructionsValidator = v.object({
	bankName: v.optional(v.string()),
	bankAccountName: v.optional(v.string()),
	bankAccountNumber: v.optional(v.string()),
	qrImageStorageId: v.optional(v.string()),
	note: v.optional(v.string()),
});

// Multi-method payment validator (matches schema.retailers.paymentMethods).
// `sortOrder` is optional on the wire — `sanitizePaymentMethods` re-numbers to
// the array order, so the client can just send methods in display order.
const paymentMethodsValidator = v.array(
	v.object({
		type: v.union(v.literal("bank"), v.literal("qr")),
		label: v.string(),
		bankName: v.optional(v.string()),
		bankAccountName: v.optional(v.string()),
		bankAccountNumber: v.optional(v.string()),
		qrImageStorageId: v.optional(v.string()),
		note: v.optional(v.string()),
		sortOrder: v.optional(v.number()),
	}),
);

const PAYMENT_FIELD_MAX = 120;
const PAYMENT_NOTE_MAX = 500;

type PaymentInstructionsShape = {
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
};

function sanitizePaymentInstructions(
	input: PaymentInstructionsShape,
): PaymentInstructionsShape | undefined {
	const out: PaymentInstructionsShape = {};
	const trimField = (key: keyof PaymentInstructionsShape, max: number) => {
		const raw = input[key];
		if (raw === undefined) return;
		const trimmed = raw.trim();
		if (trimmed.length === 0) return; // empty → reset
		if (trimmed.length > max) {
			throw new ConvexError(`Payment field "${key}" exceeds ${max} characters`);
		}
		out[key] = trimmed;
	};
	trimField("bankName", PAYMENT_FIELD_MAX);
	trimField("bankAccountName", PAYMENT_FIELD_MAX);
	trimField("bankAccountNumber", PAYMENT_FIELD_MAX);
	trimField("qrImageStorageId", PAYMENT_FIELD_MAX);
	trimField("note", PAYMENT_NOTE_MAX);
	return Object.keys(out).length > 0 ? out : undefined;
}
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { rateLimiter } from "./lib/rateLimiter";
import {
	capsForPlan,
	DAY_MS,
	FOUNDING_TRIAL_DAYS,
	TRIAL_DAYS,
} from "./lib/plans";
import {
	type AccessState,
	assertSubscriptionActive,
	loadSubscription,
	resolveAccess,
} from "./subscriptions";
import {
	assertSupportedCurrency,
	DEFAULT_CURRENCY,
	type SupportedCurrency,
} from "./lib/currency";
import { requireAdmin } from "./lib/auth";
import {
	assertValidEmail,
	assertValidSlug,
	assertValidStoreName,
	assertValidWaPhone,
} from "./lib/slug";
import {
	AUP_VERSION,
	PRIVACY_VERSION,
	TERMS_VERSION,
} from "./lib/legal";
import {
	collectQrStorageIds,
	type PaymentMethod,
	resolvePaymentMethods,
	sanitizePaymentMethods,
} from "./lib/payment";
import {
	assertValidOrderStages,
	ORDER_STATUS_KEYS,
	type OrderStage,
	type StageAnchor,
	STATUS_LABEL_MAX_LENGTH,
	type StatusLabelMap,
	type StatusLabels,
} from "./lib/orderStatus";

/** Trim and bound a best-effort client IP before persisting. */
function sanitizeAcceptanceIp(ip: string | undefined): string | undefined {
	if (ip === undefined) return undefined;
	const trimmed = ip.trim();
	if (trimmed.length === 0) return undefined;
	// IPv6 max textual length is 45 chars; clamp generously to avoid storing junk.
	return trimmed.slice(0, 64);
}

const SLUG_HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export type Locale = "en" | "ms";
export const DEFAULT_LOCALE: Locale = "en";

type LocaleOverrides = {
	confirm?: string;
	packed?: string;
	shipped?: string;
	delivered?: string;
	cancelled?: string;
	unknownFallback?: string;
};

type MessageTemplatesShape = {
	en?: LocaleOverrides;
	ms?: LocaleOverrides;
};

const TEMPLATE_MAX_LENGTH = 1000;

function sanitizeOverrides(
	input: LocaleOverrides | undefined,
): LocaleOverrides | undefined {
	if (!input) return undefined;
	const out: LocaleOverrides = {};
	for (const key of [
		"confirm",
		"packed",
		"shipped",
		"delivered",
		"cancelled",
		"unknownFallback",
	] as const) {
		const raw = input[key];
		if (raw === undefined) continue;
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue; // empty → reset to default
		if (trimmed.length > TEMPLATE_MAX_LENGTH) {
			throw new ConvexError(
				`Template "${key}" exceeds ${TEMPLATE_MAX_LENGTH} characters`,
			);
		}
		out[key] = trimmed;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeMessageTemplates(
	input: MessageTemplatesShape,
): MessageTemplatesShape | undefined {
	const en = sanitizeOverrides(input.en);
	const ms = sanitizeOverrides(input.ms);
	const out: MessageTemplatesShape = {};
	if (en) out.en = en;
	if (ms) out.ms = ms;
	return Object.keys(out).length > 0 ? out : undefined;
}

// Trim each status label, treat empty/whitespace as unset (so a seller can't
// blank a stage to ""), and enforce the per-label char cap server-side — not
// just in CSS — so an over-long / emoji-stuffed label can't break the pills.
function sanitizeStatusLabelOverrides(
	input: StatusLabelMap | undefined,
): StatusLabelMap | undefined {
	if (!input) return undefined;
	const out: StatusLabelMap = {};
	for (const key of ORDER_STATUS_KEYS) {
		const raw = input[key];
		if (raw === undefined) continue;
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue; // empty → reset to default
		if (trimmed.length > STATUS_LABEL_MAX_LENGTH) {
			throw new ConvexError(
				`Status label "${key}" exceeds ${STATUS_LABEL_MAX_LENGTH} characters`,
			);
		}
		out[key] = trimmed;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStatusLabels(input: StatusLabels): StatusLabels | undefined {
	const en = sanitizeStatusLabelOverrides(input.en);
	const ms = sanitizeStatusLabelOverrides(input.ms);
	const out: StatusLabels = {};
	if (en) out.en = en;
	if (ms) out.ms = ms;
	return Object.keys(out).length > 0 ? out : undefined;
}

type RetailerPublic = {
	_id: Id<"retailers">;
	slug: string;
	storeName: string;
	waPhone?: string;
	notifyEmail?: string;
	checkoutPhone?: string;
	logoStorageId?: string;
	logoUrl?: string;
	currency: SupportedCurrency;
	locale: Locale;
	messageTemplates?: MessageTemplatesShape;
	// Per-retailer SHORT status labels (tracking timeline / dashboard). Omitted
	// keys fall back to defaults at render time via convex/lib/orderStatus.ts.
	statusLabels?: StatusLabels;
	// Phase 2 custom stages (ordered). Undefined => the resolver synthesizes the
	// default stages from statusLabels. Surfaced for the settings stage editor.
	orderStages?: OrderStage[];
	// Resolved payment methods (legacy-aware) with each QR storage id turned into
	// a viewable URL — what the settings UI renders + edits. Omitted from the
	// public storefront payload (only `getMyRetailer` populates it).
	paymentMethods?: Array<PaymentMethod & { qrImageUrl?: string }>;
	// Whether the retailer is offering self-collect on the storefront. Storefront
	// hides the self-collect option entirely when false (regardless of pickup
	// location count). Undefined treated as false.
	offerSelfCollect?: boolean;
	// Whether the retailer has opened the Pickup settings tab at least once.
	// Drives checklist step-4 dismissal — set to true on first tab visit by
	// `markPickupSetupSeen`.
	pickupSetupSeen?: boolean;
	// Accepted legal-doc versions, surfaced so the dashboard can detect a
	// version bump and prompt re-acceptance. Acceptance timestamps and IP are
	// intentionally not exposed to the client.
	termsVersion?: string;
	privacyVersion?: string;
	aupVersion?: string;
	// Whether the optional "WhatsApp Business greeting message" onboarding step
	// has been marked done/skipped. Drives the setup checklist on the dashboard.
	onboardingGreetingSetup?: boolean;
	// Subscription/entitlement summary — drives the nav tier pill + soft-lock UI.
	// Populated only by the OWNER read (`getMyRetailer`); deliberately omitted from
	// the public storefront payload (`getRetailerBySlug`) so subscription state
	// never leaks to shoppers. Fail-safe: a retailer missing a subscription row
	// resolves to comped full access (see resolveAccess). See docs/manual-subscription.md.
	subscription?: AccessState;
	// Denormalized Founding Member flags (badge / ribbon) — public-safe.
	isFoundingMember?: boolean;
	foundingMemberRank?: number;
};

async function loadRetailerForUser(
	ctx: QueryCtx,
	userId: string,
): Promise<RetailerPublic | null> {
	const row = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();
	if (!row) return null;
	const resolvedMethods = resolvePaymentMethods(row);
	const paymentMethods: Array<PaymentMethod & { qrImageUrl?: string }> = [];
	for (const m of resolvedMethods) {
		let qrImageUrl: string | undefined;
		if (m.type === "qr" && m.qrImageStorageId) {
			const url = await ctx.storage.getUrl(m.qrImageStorageId);
			qrImageUrl = url ?? undefined;
		}
		paymentMethods.push({ ...m, qrImageUrl });
	}
	let logoUrl: string | undefined;
	if (row.logoStorageId) {
		const url = await ctx.storage.getUrl(row.logoStorageId);
		logoUrl = url ?? undefined;
	}
	const sub = await loadSubscription(ctx, row._id);
	if (!sub) {
		console.warn(
			`[retailers] no subscription row for retailer ${row._id} — failing open (comped full access)`,
		);
	}
	return {
		_id: row._id,
		slug: row.slug,
		storeName: row.storeName,
		waPhone: row.waPhone,
		notifyEmail: row.notifyEmail,
		logoStorageId: row.logoStorageId,
		logoUrl,
		currency: (row.currency as SupportedCurrency) ?? DEFAULT_CURRENCY,
		locale: row.locale ?? DEFAULT_LOCALE,
		messageTemplates: row.messageTemplates as MessageTemplatesShape | undefined,
		statusLabels: row.statusLabels as StatusLabels | undefined,
		orderStages: row.orderStages as OrderStage[] | undefined,
		paymentMethods,
		offerSelfCollect: row.offerSelfCollect,
		pickupSetupSeen: row.pickupSetupSeen,
		termsVersion: row.termsVersion,
		privacyVersion: row.privacyVersion,
		aupVersion: row.aupVersion,
		onboardingGreetingSetup: row.onboardingGreetingSetup,
		subscription: resolveAccess(sub),
		isFoundingMember: row.isFoundingMember,
		foundingMemberRank: row.foundingMemberRank,
	};
}

async function requireUserId(ctx: QueryCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity.subject;
}

/**
 * Returns the signed-in user's retailer, or null if they have not completed
 * onboarding yet. Used by `/app` and `/onboarding` route guards.
 */
export const getMyRetailer = query({
	args: {},
	handler: async (ctx): Promise<RetailerPublic | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return loadRetailerForUser(ctx, identity.subject);
	},
});

/**
 * Public lookup of a retailer by slug. Also checks `slugHistory` to produce
 * a 301 redirect target if the slug was recently renamed.
 */
export const getRetailerBySlug = query({
	args: { slug: v.string() },
	handler: async (
		ctx,
		{ slug },
	): Promise<
		| { status: "ok"; retailer: RetailerPublic }
		| { status: "redirect"; to: string }
		| { status: "notFound" }
	> => {
		const normalized = slug.trim().toLowerCase();
		if (normalized.length === 0) return { status: "notFound" };

		const active = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", normalized))
			.first();
		if (active) {
			let logoUrl: string | undefined;
			if (active.logoStorageId) {
				const url = await ctx.storage.getUrl(active.logoStorageId);
				logoUrl = url ?? undefined;
			}
			return {
				status: "ok",
				retailer: {
					_id: active._id,
					slug: active.slug,
					storeName: active.storeName,
					waPhone: active.waPhone,
					checkoutPhone: process.env.WHATSAPP_CHECKOUT_PHONE ?? active.waPhone,
					logoStorageId: active.logoStorageId,
					logoUrl,
					currency:
						(active.currency as SupportedCurrency) ?? DEFAULT_CURRENCY,
					locale: active.locale ?? DEFAULT_LOCALE,
					messageTemplates: active.messageTemplates as
						| MessageTemplatesShape
						| undefined,
					offerSelfCollect: active.offerSelfCollect,
					// Founding badge is public-safe; subscription state is NOT included.
					isFoundingMember: active.isFoundingMember,
					foundingMemberRank: active.foundingMemberRank,
					// paymentInstructions intentionally omitted from the public
					// storefront payload — only revealed in the WhatsApp confirm
					// reply after the shopper commits to an order.
				},
			};
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", normalized))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			const target = await ctx.db.get(historyRow.retailerId);
			if (target) return { status: "redirect", to: target.slug };
		}

		return { status: "notFound" };
	},
});

/**
 * Check slug availability for live form feedback. Returns the same shape as
 * `getRetailerBySlug` but from the perspective of "can the current user claim
 * this slug?" — so owner-reclaim paths return `available`.
 */
export const checkSlugAvailability = query({
	args: { slug: v.string() },
	handler: async (
		ctx,
		{ slug },
	): Promise<
		{ status: "available" } | { status: "taken" } | { status: "invalid"; reason: string }
	> => {
		let normalized: string;
		try {
			normalized = assertValidSlug(slug);
		} catch (err) {
			return { status: "invalid", reason: (err as Error).message };
		}

		const identity = await ctx.auth.getUserIdentity();
		const currentUserId = identity?.subject ?? null;

		const active = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", normalized))
			.first();
		if (active) {
			if (currentUserId && active.userId === currentUserId) {
				return { status: "available" };
			}
			return { status: "taken" };
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", normalized))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			if (currentUserId) {
				const historyOwner = await ctx.db.get(historyRow.retailerId);
				if (historyOwner && historyOwner.userId === currentUserId) {
					return { status: "available" };
				}
			}
			return { status: "taken" };
		}

		return { status: "available" };
	},
});

/**
 * Admin pre-check for "onboard a client": is a store already registered to this
 * email? We're strictly 1 login : 1 store and Clerk enforces one account per
 * email, so a duplicate email means the invite link would dead-end (the client
 * would land back in their existing store). Surfacing it up front saves a wasted
 * invite. We check our own `notifyEmail` (the right question — "already owns a
 * store" — not merely "exists in Clerk"); it's stored normalized so equality is
 * exact. notifyEmail is editable, so this is a strong heuristic, not a hard
 * guarantee — the real 1:1 gate still lives in `createRetailer`. Admin-only to
 * avoid leaking whether an email is registered. See docs/vendor-identity.md.
 */
export const checkEmailHasStore = query({
	args: { email: v.string() },
	handler: async (
		ctx,
		{ email },
	): Promise<{ exists: boolean; storeName?: string; slug?: string }> => {
		await requireAdmin(ctx);
		let normalized: string;
		try {
			normalized = assertValidEmail(email);
		} catch {
			// Not a valid email yet (still typing) — nothing to warn about.
			return { exists: false };
		}
		const existing = await ctx.db
			.query("retailers")
			.withIndex("by_notify_email", (q) => q.eq("notifyEmail", normalized))
			.first();
		if (!existing) return { exists: false };
		return { exists: true, storeName: existing.storeName, slug: existing.slug };
	},
});

/**
 * Create the signed-in user's retailer. Enforces strict 1:1 user↔retailer.
 *
 * Race-safe: Convex mutations are serializable, so the read-then-insert pattern
 * cannot lose to a concurrent writer.
 */
/**
 * Create the retailer's subscription in the SAME transaction as the retailer
 * insert. Public path → `trialing` (14d, Pro caps). Founding path → `active` +
 * a pending Pro invoice (with `dueDate`) so the rank can claim on first paid.
 */
async function createSubscriptionForRetailer(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	intent: "public" | "founding",
	now: number,
): Promise<void> {
	const caps = capsForPlan("pro"); // trial + founding both grant Pro-level access
	if (intent === "founding") {
		// Founding-10 perk: 1 month free (vs the standard 14-day trial), then a paid
		// Pro plan. `foundingIntent` flags the store so the conversion invoice
		// auto-applies the founding discount + claims the rank. No invoice yet —
		// Arif issues it at conversion (and picks monthly or annual then).
		await ctx.db.insert("subscriptions", {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			status: "trialing",
			trialEndsAt: now + FOUNDING_TRIAL_DAYS * DAY_MS,
			foundingIntent: true,
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			createdAt: now,
			updatedAt: now,
		});
		return;
	}
	// Public funnel: 14-day no-card trial granting Pro-level access. Tier is
	// chosen at conversion, not signup; `plan` holds the trialed tier (pro).
	await ctx.db.insert("subscriptions", {
		retailerId,
		plan: "pro",
		billingCycle: "monthly",
		status: "trialing",
		trialEndsAt: now + TRIAL_DAYS * DAY_MS,
		orderCap: caps.orderCap,
		userCap: caps.userCap,
		broadcastQuota: caps.broadcastQuota,
		createdAt: now,
		updatedAt: now,
	});
}

export const createRetailer = mutation({
	args: {
		storeName: v.string(),
		slug: v.string(),
		waPhone: v.optional(v.string()),
		// Best-effort client IP captured at the consent moment. Optional —
		// onboarding never blocks if IP lookup fails.
		acceptanceIp: v.optional(v.string()),
		// Signup path. "public" (default) → 14-day trial. "founding" → no trial,
		// active + pending Pro invoice from day one (Founding-10 intercept onboard).
		// The real rank gate is admin mark-paid + the 10-slot cap, so this is not a
		// privileged arg in v1. See docs/manual-subscription.md.
		intent: v.optional(v.union(v.literal("public"), v.literal("founding"))),
	},
	handler: async (ctx, args): Promise<{ slug: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const userId = identity.subject;
		let storeName: string;
		let slug: string;
		let waPhone: string | undefined;
		try { storeName = assertValidStoreName(args.storeName); } catch (err) { throw new ConvexError((err as Error).message); }
		try { slug = assertValidSlug(args.slug); } catch (err) { throw new ConvexError((err as Error).message); }
		if (args.waPhone && args.waPhone.trim().length > 0) {
			try { waPhone = assertValidWaPhone(args.waPhone); } catch (err) { throw new ConvexError((err as Error).message); }
		}

		// Prefill notifyEmail from Clerk identity if available. Swallow validation
		// errors so a malformed Clerk email never blocks onboarding — the retailer
		// can fix it via settings later.
		let notifyEmail: string | undefined;
		const identityEmail =
			typeof identity.email === "string" ? identity.email : undefined;
		if (identityEmail && identityEmail.trim().length > 0) {
			try {
				notifyEmail = assertValidEmail(identityEmail);
			} catch {
				notifyEmail = undefined;
			}
		}

		const existing = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (existing) {
			throw new ConvexError("You already have a store. Each account can own one retailer.");
		}

		const collision = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (collision) throw new ConvexError("That slug is taken");

		// Slug history collision (someone else's rename, still within TTL)
		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			throw new ConvexError("That slug is temporarily reserved");
		}
		if (historyRow) {
			// Expired but not yet purged — remove inline.
			await ctx.db.delete(historyRow._id);
		}

		const now = Date.now();
		// Consent is implied: the onboarding UI gates submission on a required,
		// not-pre-checked "I agree" checkbox. Stamp the server-side current
		// versions (never client-supplied) for tamper resistance.
		const acceptanceIp = sanitizeAcceptanceIp(args.acceptanceIp);
		const retailerId = await ctx.db.insert("retailers", {
			userId,
			slug,
			storeName,
			waPhone,
			notifyEmail,
			currency: DEFAULT_CURRENCY,
			channel: "whatsapp",
			// Default self-collect ON so new retailers discover the pickup feature
			// in the onboarding checklist. They can toggle it off from Settings →
			// Pickup; that visit also dismisses checklist step 4 (via
			// markPickupSetupSeen).
			offerSelfCollect: true,
			termsAcceptedAt: now,
			termsVersion: TERMS_VERSION,
			privacyAcceptedAt: now,
			privacyVersion: PRIVACY_VERSION,
			aupAcceptedAt: now,
			aupVersion: AUP_VERSION,
			acceptanceIp,
			createdAt: now,
			updatedAt: now,
		});

		// Create the subscription (+ founding invoice) in the same transaction, so
		// a retailer always has a subscription row. See createSubscriptionForRetailer.
		await createSubscriptionForRetailer(
			ctx,
			retailerId,
			args.intent ?? "public",
			now,
		);

		return { slug };
	},
});

/**
 * Update retailer profile fields (store name, WhatsApp number).
 * Slug renames go through `renameSlug` which has its own history bookkeeping.
 */
export const updateSettings = mutation({
	args: {
		storeName: v.optional(v.string()),
		waPhone: v.optional(v.string()),
		notifyEmail: v.optional(v.string()),
		currency: v.optional(v.string()),
		locale: v.optional(v.union(v.literal("en"), v.literal("ms"))),
		messageTemplates: v.optional(messageTemplatesValidator),
		statusLabels: v.optional(statusLabelsValidator),
		orderStages: v.optional(orderStagesValidator),
		paymentInstructions: v.optional(paymentInstructionsValidator),
		// Multi-method payment config. When provided, supersedes (and clears) the
		// legacy single `paymentInstructions` object on this retailer.
		paymentMethods: v.optional(paymentMethodsValidator),
		// Empty string clears the logo. Undefined means "no change".
		logoStorageId: v.optional(v.string()),
		offerSelfCollect: v.optional(v.boolean()),
	},
	handler: async (ctx, args): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");
		// Soft-lock: a past_due seller can't edit store settings (growth-write).
		await assertSubscriptionActive(ctx, retailer._id);

		const patch: Partial<{
			storeName: string;
			waPhone: string | undefined;
			notifyEmail: string | undefined;
			logoStorageId: string | undefined;
			currency: SupportedCurrency;
			locale: Locale;
			messageTemplates: MessageTemplatesShape | undefined;
			statusLabels: StatusLabels | undefined;
			orderStages: OrderStage[] | undefined;
			paymentInstructions: PaymentInstructionsShape | undefined;
			paymentMethods: PaymentMethod[] | undefined;
			offerSelfCollect: boolean;
			updatedAt: number;
		}> = { updatedAt: Date.now() };

		if (args.storeName !== undefined) {
			try { patch.storeName = assertValidStoreName(args.storeName); } catch (err) { throw new ConvexError((err as Error).message); }
		}
		if (args.waPhone !== undefined) {
			if (args.waPhone.trim().length > 0) {
				try { patch.waPhone = assertValidWaPhone(args.waPhone); } catch (err) { throw new ConvexError((err as Error).message); }
			} else {
				patch.waPhone = undefined;
			}
		}
		if (args.notifyEmail !== undefined) {
			if (args.notifyEmail.trim().length > 0) {
				try { patch.notifyEmail = assertValidEmail(args.notifyEmail); } catch (err) { throw new ConvexError((err as Error).message); }
			} else {
				patch.notifyEmail = undefined;
			}
		}
		if (args.currency !== undefined) {
			try { patch.currency = assertSupportedCurrency(args.currency); } catch (err) { throw new ConvexError((err as Error).message); }
		}
		if (args.locale !== undefined) {
			patch.locale = args.locale;
		}
		if (args.messageTemplates !== undefined) {
			patch.messageTemplates = sanitizeMessageTemplates(args.messageTemplates);
		}
		if (args.statusLabels !== undefined) {
			patch.statusLabels = sanitizeStatusLabels(args.statusLabels);
		}
		if (args.orderStages !== undefined) {
			try {
				patch.orderStages = sanitizeOrderStages(args.orderStages);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		if (args.paymentInstructions !== undefined) {
			patch.paymentInstructions = sanitizePaymentInstructions(
				args.paymentInstructions,
			);
		}
		if (args.paymentMethods !== undefined) {
			// Re-number sortOrder to the array (display) order, then sanitize.
			const sanitized = sanitizePaymentMethods(
				args.paymentMethods.map((m, i) => ({ ...m, sortOrder: i })),
			);
			// Garbage-collect orphaned QR blobs: any QR image previously stored
			// (in the array OR the legacy object) that the new set no longer
			// references — covers replace, "Remove QR", and method deletion.
			// Best-effort; a missing/already-deleted blob must not abort the save.
			const nextQr = new Set(
				(sanitized ?? [])
					.filter((m) => m.type === "qr" && m.qrImageStorageId)
					.map((m) => m.qrImageStorageId as string),
			);
			for (const prevId of collectQrStorageIds(retailer)) {
				if (nextQr.has(prevId)) continue;
				try {
					await ctx.storage.delete(prevId as Id<"_storage">);
				} catch {
					// already gone — ignore
				}
			}
			patch.paymentMethods = sanitized;
			// Saving via the multi-method UI migrates this retailer off the legacy
			// single object — clear it so reads don't double-count.
			patch.paymentInstructions = undefined;
		}
		if (args.logoStorageId !== undefined) {
			const trimmed = args.logoStorageId.trim();
			patch.logoStorageId = trimmed.length > 0 ? trimmed : undefined;
		}
		if (args.offerSelfCollect !== undefined) {
			patch.offerSelfCollect = args.offerSelfCollect;
		}

		await ctx.db.patch(retailer._id, patch);
		return { ok: true };
	},
});

/**
 * Re-stamp the signed-in retailer's legal consent to the current document
 * versions. Called by the dashboard re-acceptance banner after a version bump.
 * Like createRetailer, versions are taken server-side (never client-supplied).
 */
export const recordConsentAcceptance = mutation({
	args: {
		acceptanceIp: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");

		const now = Date.now();
		await ctx.db.patch(retailer._id, {
			termsAcceptedAt: now,
			termsVersion: TERMS_VERSION,
			privacyAcceptedAt: now,
			privacyVersion: PRIVACY_VERSION,
			aupAcceptedAt: now,
			aupVersion: AUP_VERSION,
			acceptanceIp: sanitizeAcceptanceIp(args.acceptanceIp),
			updatedAt: now,
		});
		return { ok: true };
	},
});

/**
 * Idempotent: mark the signed-in retailer as having visited the Pickup
 * settings tab at least once. Drives the dashboard checklist's step-4
 * dismissal so a seller who deliberately skips self-collect isn't nagged.
 * No-op if already true.
 */
export const markPickupSetupSeen = mutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { updated: false };
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return { updated: false };
		if (retailer.pickupSetupSeen === true) return { updated: false };
		await ctx.db.patch(retailer._id, {
			pickupSetupSeen: true,
			updatedAt: Date.now(),
		});
		return { updated: true };
	},
});

/**
 * Mark the optional "WhatsApp Business greeting message" onboarding step as
 * done. Called by the dashboard setup checklist for both "Mark as done" and
 * "Skip for now" — either way the step is persisted as complete so it collapses
 * across sessions and the checklist can reach all-done. No-op aside from the
 * flag: the greeting itself is configured by the seller in the WhatsApp app.
 */
export const markGreetingSetupDone = mutation({
	args: {},
	handler: async (ctx): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");

		await ctx.db.patch(retailer._id, {
			onboardingGreetingSetup: true,
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/**
 * Idempotent self-heal: if the signed-in user's retailer has no notifyEmail
 * yet, copy it from the Clerk identity email. Called once from the dashboard
 * on first load so retailers created before notifyEmail existed get
 * auto-populated without manual settings work.
 *
 * Returns whether a backfill happened so the caller can avoid re-firing.
 */
export const ensureNotifyEmailFromIdentity = mutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { updated: false };
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return { updated: false };
		if (retailer.notifyEmail && retailer.notifyEmail.trim().length > 0) {
			return { updated: false };
		}
		const identityEmail =
			typeof identity.email === "string" ? identity.email : undefined;
		if (!identityEmail || identityEmail.trim().length === 0) {
			return { updated: false };
		}
		let normalized: string;
		try {
			normalized = assertValidEmail(identityEmail);
		} catch {
			return { updated: false };
		}
		await ctx.db.patch(retailer._id, {
			notifyEmail: normalized,
			updatedAt: Date.now(),
		});
		return { updated: true };
	},
});

/**
 * Rename the signed-in user's slug. Old slug is parked in `slugHistory` for
 * 90 days so previously shared WhatsApp links 301-redirect to the new slug.
 * Owner-reclaim: if the new slug is one of this retailer's own historical
 * slugs, the history row is deleted so the link chain terminates cleanly.
 */
export const renameSlug = mutation({
	args: { newSlug: v.string() },
	handler: async (ctx, { newSlug }): Promise<{ slug: string }> => {
		const userId = await requireUserId(ctx);
		let slug: string;
		try { slug = assertValidSlug(newSlug); } catch (err) { throw new ConvexError((err as Error).message); }

		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to rename");

		if (retailer.slug === slug) return { slug }; // no-op

		const collision = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (collision && collision._id !== retailer._id) {
			throw new ConvexError("That slug is taken");
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
			.first();
		if (historyRow) {
			const historyOwner = await ctx.db.get(historyRow.retailerId);
			if (!historyOwner || historyOwner._id !== retailer._id) {
				if (historyRow.expiresAt > Date.now()) {
					throw new ConvexError("That slug is temporarily reserved");
				}
				await ctx.db.delete(historyRow._id);
			} else {
				// Owner reclaim — remove stale history row.
				await ctx.db.delete(historyRow._id);
			}
		}

		const now = Date.now();
		await ctx.db.insert("slugHistory", {
			oldSlug: retailer.slug,
			retailerId: retailer._id,
			expiresAt: now + SLUG_HISTORY_TTL_MS,
		});
		await ctx.db.patch(retailer._id, { slug, updatedAt: now });

		return { slug };
	},
});

/**
 * Generate a one-shot upload URL for the retailer's store logo.
 * The frontend POSTs the file here, then stores the returned `storageId`
 * via `updateSettings({ logoStorageId })`.
 */
export const generateLogoUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Generate a one-shot upload URL for a payment-method QR image. The frontend
 * POSTs the file here, then stores the returned `storageId` on a `qr` method and
 * saves the array via `updateSettings({ paymentMethods })`.
 */
export const generatePaymentQrUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * One-time backfill: migrate retailers from the legacy single
 * `paymentInstructions` object to the `paymentMethods` array, then clear the
 * legacy field. Idempotent — skips rows already on `paymentMethods` or with no
 * legacy data. Run in dev:  npx convex run retailers:backfillPaymentMethods
 */
export const backfillPaymentMethods = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ migrated: number; skipped: number }> => {
		const rows = await ctx.db.query("retailers").collect();
		let migrated = 0;
		let skipped = 0;
		for (const row of rows) {
			// Already migrated, or nothing to migrate.
			if (row.paymentMethods && row.paymentMethods.length > 0) {
				skipped++;
				continue;
			}
			const methods = resolvePaymentMethods(row); // legacy-derived here
			if (methods.length === 0) {
				skipped++;
				continue;
			}
			await ctx.db.patch(row._id, {
				paymentMethods: methods,
				paymentInstructions: undefined,
				updatedAt: Date.now(),
			});
			migrated++;
		}
		return { migrated, skipped };
	},
});

/**
 * Daily cron entry point. Deletes `slugHistory` rows whose TTL has elapsed.
 */
/**
 * Public query returning all active retailer slugs and their last-modified
 * timestamp — used to generate /sitemap.xml.
 */
export const listSlugsForSitemap = query({
	args: {},
	handler: async (ctx): Promise<Array<{ slug: string; updatedAt: number }>> => {
		const rows = await ctx.db.query("retailers").collect();
		return rows.map((r) => ({ slug: r.slug, updatedAt: r._creationTime }));
	},
});

export const internalPurgeExpiredSlugHistory = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const rows = await ctx.db.query("slugHistory").collect();
		let purged = 0;
		for (const row of rows) {
			if (row.expiresAt <= now) {
				await ctx.db.delete(row._id);
				purged += 1;
			}
		}
		return { purged };
	},
});

type DeleteUserResult =
	| { deleted: false }
	| {
			deleted: true;
			retailerId: Id<"retailers">;
			counts: { orders: number; products: number; customers: number };
	  };

/**
 * Hard-delete a user and every tenant artifact they own, keyed by Clerk
 * subject (`userId`). Cascades through orders (+ their orderEvents and payment
 * proof files), products (+ their image files), customers, and parked
 * slugHistory rows, then removes the retailer's logo / payment-QR blobs and the
 * retailer row itself. Runs as a single ACID mutation, so it's all-or-nothing.
 *
 * Internal-only: there is no shopper/retailer-facing path to this. Invoke it
 * from a Clerk "user.deleted" webhook handler, a GDPR erasure job, or the
 * Convex dashboard.
 *
 * Idempotent — returns `{ deleted: false }` when the user has no retailer.
 *
 * NOTE: deletion is bounded by the tenant's data volume. A single Convex
 * mutation has read/write-set limits, so a Scale-tier retailer with very large
 * order history could exceed them. If that becomes real, split this into a
 * paginated batch driven by `ctx.scheduler`. The slugHistory scan is a full
 * table read (no by-retailer index) but that table is small and TTL-pruned.
 */
export const deleteUser = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, { userId }): Promise<DeleteUserResult> => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) return { deleted: false };
		const retailerId = retailer._id;

		// Best-effort: a missing/already-deleted blob must not abort the cascade.
		const deleteFile = async (storageId: string | undefined): Promise<void> => {
			if (!storageId) return;
			try {
				await ctx.storage.delete(storageId as Id<"_storage">);
			} catch {
				// blob already gone — ignore
			}
		};

		// Orders → their events + payment proof files.
		const orders = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		for (const order of orders) {
			const events = await ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order._id))
				.collect();
			for (const event of events) await ctx.db.delete(event._id);
			await deleteFile(order.paymentProofStorageId);
			await ctx.db.delete(order._id);
		}

		// Products → their image files.
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		for (const product of products) {
			for (const imageId of product.imageStorageIds) await deleteFile(imageId);
			await ctx.db.delete(product._id);
		}

		// Customers.
		const customers = await ctx.db
			.query("customers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		for (const customer of customers) await ctx.db.delete(customer._id);

		// Parked slug-history rows (no by-retailer index; small, TTL-pruned table).
		const history = await ctx.db.query("slugHistory").collect();
		for (const row of history) {
			if (row.retailerId === retailerId) await ctx.db.delete(row._id);
		}

		// Retailer-level storage, then the retailer row. Delete every QR image —
		// across the methods array AND the legacy single object.
		await deleteFile(retailer.logoStorageId);
		for (const qrId of collectQrStorageIds(retailer)) await deleteFile(qrId);
		await ctx.db.delete(retailerId);

		return {
			deleted: true,
			retailerId,
			counts: {
				orders: orders.length,
				products: products.length,
				customers: customers.length,
			},
		};
	},
});
