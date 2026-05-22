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

const paymentInstructionsValidator = v.object({
	bankName: v.optional(v.string()),
	bankAccountName: v.optional(v.string()),
	bankAccountNumber: v.optional(v.string()),
	qrImageStorageId: v.optional(v.string()),
	note: v.optional(v.string()),
});

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
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { rateLimiter } from "./lib/rateLimiter";
import {
	assertSupportedCurrency,
	DEFAULT_CURRENCY,
	type SupportedCurrency,
} from "./lib/currency";
import {
	assertValidEmail,
	assertValidSlug,
	assertValidStoreName,
	assertValidWaPhone,
} from "./lib/slug";

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
	paymentInstructions?: PaymentInstructionsShape;
	paymentQrImageUrl?: string;
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
	const paymentInstructions = row.paymentInstructions as
		| PaymentInstructionsShape
		| undefined;
	let paymentQrImageUrl: string | undefined;
	if (paymentInstructions?.qrImageStorageId) {
		const url = await ctx.storage.getUrl(paymentInstructions.qrImageStorageId);
		paymentQrImageUrl = url ?? undefined;
	}
	let logoUrl: string | undefined;
	if (row.logoStorageId) {
		const url = await ctx.storage.getUrl(row.logoStorageId);
		logoUrl = url ?? undefined;
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
		paymentInstructions,
		paymentQrImageUrl,
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
 * Create the signed-in user's retailer. Enforces strict 1:1 user↔retailer.
 *
 * Race-safe: Convex mutations are serializable, so the read-then-insert pattern
 * cannot lose to a concurrent writer.
 */
export const createRetailer = mutation({
	args: {
		storeName: v.string(),
		slug: v.string(),
		waPhone: v.optional(v.string()),
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
		await ctx.db.insert("retailers", {
			userId,
			slug,
			storeName,
			waPhone,
			notifyEmail,
			currency: DEFAULT_CURRENCY,
			channel: "whatsapp",
			createdAt: now,
			updatedAt: now,
		});

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
		paymentInstructions: v.optional(paymentInstructionsValidator),
		// Empty string clears the logo. Undefined means "no change".
		logoStorageId: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");

		const patch: Partial<{
			storeName: string;
			waPhone: string | undefined;
			notifyEmail: string | undefined;
			logoStorageId: string | undefined;
			currency: SupportedCurrency;
			locale: Locale;
			messageTemplates: MessageTemplatesShape | undefined;
			paymentInstructions: PaymentInstructionsShape | undefined;
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
		if (args.paymentInstructions !== undefined) {
			patch.paymentInstructions = sanitizePaymentInstructions(
				args.paymentInstructions,
			);
		}
		if (args.logoStorageId !== undefined) {
			const trimmed = args.logoStorageId.trim();
			patch.logoStorageId = trimmed.length > 0 ? trimmed : undefined;
		}

		await ctx.db.patch(retailer._id, patch);
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
 * Generate a one-shot upload URL for the retailer's payment QR image.
 * The frontend POSTs the file to this URL, then stores the returned
 * `storageId` via `updateSettings({ paymentInstructions: { qrImageStorageId } })`.
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
