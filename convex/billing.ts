// Global Kedaipal payment details (retailers pay Kedaipal). Admin-editable via
// /app/admin/billing — the boss changes bank details / swaps the DuitNow QR
// without a deploy. Stored as a singleton `billingConfig` row; the QR image lives
// in Convex storage. The WA number is NOT here — it reuses WHATSAPP_CHECKOUT_PHONE
// (shared with checkout). See docs/manual-subscription.md.

import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { isAdmin, requireAdmin } from "./lib/auth";

const MAX_FIELD = 120;

function clean(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const t = value.trim();
	if (t.length === 0) return undefined;
	if (t.length > MAX_FIELD)
		throw new ConvexError(`Field exceeds ${MAX_FIELD} characters`);
	return t;
}

async function loadConfig(ctx: QueryCtx): Promise<Doc<"billingConfig"> | null> {
	return ctx.db.query("billingConfig").first();
}

/**
 * Retailer-facing payment instructions for the billing page. Reads the global
 * config + resolves the QR to a URL + the WA number from env. Auth-gated (a
 * signed-in retailer). Returns empty-ish when nothing is configured — the UI
 * shows a "message us for details" fallback.
 */
export const paymentInstructions = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		whatsappPhone?: string;
		bankName?: string;
		bankAccountName?: string;
		bankAccountNumber?: string;
		duitnowId?: string;
		qrUrl?: string;
	} | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const cfg = await loadConfig(ctx);
		let qrUrl: string | undefined;
		if (cfg?.qrImageStorageId) {
			const url = await ctx.storage.getUrl(cfg.qrImageStorageId);
			qrUrl = url ?? undefined;
		}
		const waPhone = process.env.WHATSAPP_CHECKOUT_PHONE;
		return {
			whatsappPhone:
				waPhone && waPhone.trim().length > 0 ? waPhone.trim() : undefined,
			bankName: cfg?.bankName,
			bankAccountName: cfg?.bankAccountName,
			bankAccountNumber: cfg?.bankAccountNumber,
			duitnowId: cfg?.duitnowId,
			qrUrl,
		};
	},
});

/** Whether the caller is an admin — drives client-side hiding of the admin route
 * (the server check on each admin function is the real gate). */
export const amIAdmin = query({
	args: {},
	handler: async (ctx): Promise<boolean> => isAdmin(ctx),
});

/** Admin: the editable config + resolved QR URL for the admin edit form. */
export const getBillingConfig = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		bankName?: string;
		bankAccountName?: string;
		bankAccountNumber?: string;
		duitnowId?: string;
		qrImageStorageId?: string;
		qrUrl?: string;
	}> => {
		await requireAdmin(ctx);
		const cfg = await loadConfig(ctx);
		let qrUrl: string | undefined;
		if (cfg?.qrImageStorageId) {
			const url = await ctx.storage.getUrl(cfg.qrImageStorageId);
			qrUrl = url ?? undefined;
		}
		return {
			bankName: cfg?.bankName,
			bankAccountName: cfg?.bankAccountName,
			bankAccountNumber: cfg?.bankAccountNumber,
			duitnowId: cfg?.duitnowId,
			qrImageStorageId: cfg?.qrImageStorageId,
			qrUrl,
		};
	},
});

/** Admin: mint a one-shot upload URL for the DuitNow QR image. */
export const generateQrUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		await requireAdmin(ctx);
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Admin: upsert the singleton payment config. Each field is independently
 * settable; pass `qrImageStorageId: null` to remove the QR. Undefined = no change.
 */
export const updateBillingConfig = mutation({
	args: {
		bankName: v.optional(v.string()),
		bankAccountName: v.optional(v.string()),
		bankAccountNumber: v.optional(v.string()),
		duitnowId: v.optional(v.string()),
		qrImageStorageId: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, args): Promise<void> => {
		const admin = await requireAdmin(ctx);
		const now = Date.now();
		const existing = await loadConfig(ctx);

		const patch: Partial<Doc<"billingConfig">> = {
			updatedAt: now,
			updatedBy: admin,
		};
		if (args.bankName !== undefined) patch.bankName = clean(args.bankName);
		if (args.bankAccountName !== undefined)
			patch.bankAccountName = clean(args.bankAccountName);
		if (args.bankAccountNumber !== undefined)
			patch.bankAccountNumber = clean(args.bankAccountNumber);
		if (args.duitnowId !== undefined) patch.duitnowId = clean(args.duitnowId);
		if (args.qrImageStorageId !== undefined) {
			// Free the previous QR blob when replacing/removing it.
			const prevId = existing?.qrImageStorageId;
			const nextId = args.qrImageStorageId ?? undefined;
			if (prevId && prevId !== nextId) {
				await ctx.storage.delete(prevId);
			}
			patch.qrImageStorageId = nextId;
		}

		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("billingConfig", {
				updatedAt: now,
				updatedBy: admin,
				bankName: patch.bankName,
				bankAccountName: patch.bankAccountName,
				bankAccountNumber: patch.bankAccountNumber,
				duitnowId: patch.duitnowId,
				qrImageStorageId: patch.qrImageStorageId,
			});
		}
	},
});
