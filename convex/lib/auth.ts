// Admin authorization for billing. v1 uses an ENV ALLOWLIST, not a Clerk role —
// no RBAC exists in the codebase (auth is uniformly `identity.subject`, strict
// 1:1 user↔retailer). `ADMIN_USER_IDS` is a comma-separated list of Clerk
// subjects. Graduates to Clerk `publicMetadata.role` later — not v1. Server check
// is mandatory; client hiding is cosmetic. See docs/manual-subscription.md.

import { ConvexError } from "convex/values";

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
