// Admin authorization for billing. v1 uses an ENV ALLOWLIST, not a Clerk role —
// no RBAC exists in the codebase (auth is uniformly `identity.subject`, strict
// 1:1 user↔retailer). `ADMIN_USER_IDS` is a comma-separated list of Clerk
// subjects. Graduates to Clerk `publicMetadata.role` later — not v1. Server check
// is mandatory; client hiding is cosmetic. See docs/manual-subscription.md.

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Minimal ctx shape — both QueryCtx and MutationCtx satisfy it, so the same
// helper guards admin queries and mutations.
type AuthCtx = {
	auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

/** Parsed allowlist (trimmed, non-empty). Empty when the env var is unset — in
 * which case NO ONE is an admin (fails closed). */
export function adminUserIds(): string[] {
	return (process.env.ADMIN_USER_IDS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export async function isAdmin(ctx: AuthCtx): Promise<boolean> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return false;
	return adminUserIds().includes(identity.subject);
}

/**
 * Throw unless the caller is an allow-listed admin. Returns the admin's Clerk
 * subject (used to stamp `markedPaidBy`). Use at the top of every admin
 * query/mutation. Generic `ConvexError` so the client never learns who the
 * admins are.
 */
export async function requireAdmin(ctx: AuthCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("Not authenticated");
	if (!adminUserIds().includes(identity.subject))
		throw new ConvexError("Not authorized");
	return identity.subject;
}

/**
 * The result of a retailer-access check: the retailer doc, whether the caller is
 * an allow-listed admin operating on a store they do NOT own ("act-as" /
 * white-glove), and the caller's Clerk subject (the actor to attribute writes to).
 */
export type RetailerAccess = {
	retailer: Doc<"retailers">;
	/** True only when an admin is acting on a store they don't personally own. */
	actingAsAdmin: boolean;
	/** Clerk subject of the caller — the actor stamped on admin audit rows. */
	userId: string;
};

/**
 * Central owner-OR-admin access gate for a retailer's dashboard data. Replaces
 * the scattered `retailer.userId !== identity.subject` owner-only checks so a
 * Kedaipal admin can operate any seller's store during white-glove onboarding
 * (see docs/admin-console.md), while every other caller is still denied.
 *
 * Throws `Forbidden` (not "Not authorized") on the deny path to match the
 * pre-existing owner-check semantics the dashboard + tests rely on. A plain
 * owner sees identical behavior to before — the admin branch is purely additive.
 *
 * Read-safe: works in both QueryCtx and MutationCtx and never writes. For
 * mutations that must leave an audit trail, use `requireRetailerAccessForWrite`.
 */
export async function requireRetailerAccess(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<RetailerAccess> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId === identity.subject)
		return { retailer, actingAsAdmin: false, userId: identity.subject };
	if (adminUserIds().includes(identity.subject))
		return { retailer, actingAsAdmin: true, userId: identity.subject };
	throw new Error("Forbidden");
}

/**
 * Record an `adminAuditLog` row for a write, but ONLY when it was performed by an
 * admin acting on a store they don't own (`access.actingAsAdmin`). A no-op for
 * ordinary owner writes — they're the norm, not the exception we need to trace.
 * Call this after a successful admin-capable mutation so every white-glove edit
 * is attributable to a person.
 *
 * `action` is a stable dotted label (e.g. "products.create"); `targetId` is the
 * affected doc id when known (updates/deletes/post-insert creates).
 *
 * For IRREVERSIBLE erasures use `logDestructiveAdminAction` — those are traced
 * regardless of ownership.
 */
export async function logAdminAction(
	ctx: MutationCtx,
	access: RetailerAccess,
	action: string,
	targetId?: string,
): Promise<void> {
	if (!access.actingAsAdmin) return;
	await insertAuditRow(ctx, access, action, targetId);
}

/**
 * Like `logAdminAction`, but records the row even when the admin OWNS the store.
 * Reserved for irreversible erasures (`orders.hardDelete`, `orders.bulkDeleteOrders`).
 *
 * The owner-write no-op is the right default for ordinary edits — they're routine
 * and recoverable — but a permanent record deletion must always answer "who did
 * this?", and the deleted row is not around to ask. These mutations are gated on
 * admin membership (`isAdmin`), so an own-store call is still an admin acting;
 * it just didn't arrive through act-as. ClickUp `86eyhz189`.
 */
export async function logDestructiveAdminAction(
	ctx: MutationCtx,
	access: RetailerAccess,
	action: string,
	targetId?: string,
): Promise<void> {
	await insertAuditRow(ctx, access, action, targetId);
}

/**
 * Audit a GLOBAL admin action — one with no store in scope (e.g. the manual
 * WABA opt-out, which suppresses sends across every retailer on the shared
 * number). `retailerId` stays unset, so per-store audit views simply don't
 * list these. Never put full PII in `targetId` — the audit log has no
 * retention; callers pass a last-4 phone hint and the acted-on row itself
 * holds the full value.
 */
export async function logGlobalAdminAction(
	ctx: MutationCtx,
	adminUserId: string,
	action: string,
	targetId?: string,
): Promise<void> {
	await ctx.db.insert("adminAuditLog", {
		adminUserId,
		action,
		targetId,
		ts: Date.now(),
	});
}

async function insertAuditRow(
	ctx: MutationCtx,
	access: RetailerAccess,
	action: string,
	targetId: string | undefined,
): Promise<void> {
	await ctx.db.insert("adminAuditLog", {
		adminUserId: access.userId,
		retailerId: access.retailer._id,
		action,
		targetId,
		ts: Date.now(),
	});
}
