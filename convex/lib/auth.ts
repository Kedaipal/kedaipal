// Authorization core.
//
// Three callers can operate a store (86exr91r4, docs/team-members.md):
//  - the OWNER — `retailers.userId`, exactly one per store;
//  - a MEMBER — an `retailerMembers` row with status "active", holding
//    per-area grants (convex/lib/permissions.ts), deny-by-default;
//  - a Kedaipal ADMIN — the `ADMIN_USER_IDS` env allowlist (white-glove
//    act-as; see docs/admin-console.md). Admins bypass grants by design and
//    their writes are traced via `adminAuditLog`, never via member attribution.
//
// EVERY store-scoped function goes through `requireRetailerAccess` and MUST
// state what it needs (`AccessRequirement` is a required argument) — a new
// Convex function that forgets to declare its access does not compile. That
// one seam is why adding an area later is a registry line, not a sweep.

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	hasPermission,
	type PermissionArea,
	type PermissionLevel,
} from "./permissions";

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

export type RetailerRole = "owner" | "member" | "admin";

/**
 * The result of a retailer-access check: the retailer doc, WHO the caller is
 * to this store (`role`), whether an admin is operating a store they don't
 * own ("act-as" / white-glove), and the caller's Clerk subject.
 *
 * `membership` is set only for role "member" — attribution and the Team tab
 * read the display name from it.
 */
export type RetailerAccess = {
	retailer: Doc<"retailers">;
	role: RetailerRole;
	/** True only when an admin is acting on a store they do NOT own. */
	actingAsAdmin: boolean;
	/** Clerk subject of the caller — the actor to attribute writes to. */
	userId: string;
	/** The caller's active membership row (role === "member" only). */
	membership?: Doc<"retailerMembers">;
};

/**
 * What a function needs from the caller. REQUIRED on every gate call so the
 * access decision is written where the function is — never implied:
 *
 *  - `{ area, level }` — the normal case. Owner and admin always pass; a
 *    member needs that grant (write implies read).
 *  - `{ ownerOnly: true }` — surfaces a member must NEVER reach, whatever
 *    their grants: team management, slug rename, account deletion, consent,
 *    plan changes. Admins still pass (white-glove acts for the owner).
 *  - `{ anyMember: true }` — the few reads every teammate needs regardless of
 *    grants: the store payload itself (`getMyRetailer`), the Team list they
 *    appear on, leaving the team.
 */
export type AccessRequirement =
	| { ownerOnly: true }
	| { anyMember: true }
	| { area: PermissionArea; level: PermissionLevel };

/** The caller's active membership row on this store, if any. A user has at
 * most one active membership (one-store-per-login, enforced at accept), so
 * the `by_user` scan is a handful of rows at most. */
async function activeMembership(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	userId: string,
): Promise<Doc<"retailerMembers"> | null> {
	const rows = await ctx.db
		.query("retailerMembers")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	return (
		rows.find((m) => m.status === "active" && m.retailerId === retailerId) ??
		null
	);
}

/**
 * Central access gate for a retailer's dashboard data — the ONLY place that
 * decides owner vs member vs admin. Resolution order: owner → admin → member.
 * (An allow-listed admin who is also somehow a member counts as admin: their
 * writes belong in `adminAuditLog`, not the order timeline.)
 *
 * Throws `Forbidden` (not "Not authorized") on the deny path to match the
 * pre-existing owner-check semantics the dashboard + tests rely on. A plain
 * owner sees identical behavior to before — the member branch is additive and
 * bounded by the caller's declared requirement.
 *
 * Read-safe: works in both QueryCtx and MutationCtx and never writes.
 */
export async function requireRetailerAccess(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	requirement: AccessRequirement,
): Promise<RetailerAccess> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	const access = await resolveAccessForIdentity(
		ctx,
		retailer,
		identity.subject,
		requirement,
	);
	if (access) return access;
	// WHO is being refused decides what they are told. A TEAMMATE hitting a
	// grant they don't hold is an ordinary, expected event — the most common
	// refusal this feature creates — so it must read as copy, not as a crash:
	// a bare `throw new Error` reaches the client as "Server Error … at
	// requireRetailerAccess (convex/lib/auth.ts:145)", stack trace and all
	// (seen in the 25 Sep Chrome test). A ConvexError carries the sentence
	// instead. A caller with NO relationship to the store still gets the
	// generic refusal — naming the area would confirm the store exists and
	// describe its setup to a stranger.
	const membership = await activeMembership(ctx, retailer._id, identity.subject);
	if (!membership) throw new Error("Forbidden");
	throw new ConvexError(refusalMessage(requirement));
}

/** The sentence a teammate reads when a grant is missing. Names the area and
 * the way forward — the owner is the only one who can change it. */
function refusalMessage(requirement: AccessRequirement): string {
	if ("ownerOnly" in requirement)
		return "Only the store owner can do this — ask them to make the change.";
	if ("area" in requirement) {
		const label = AREA_LABEL[requirement.area];
		return requirement.level === "write"
			? `You don't have permission to change ${label} — ask the store owner for edit access from Settings → Team.`
			: `You don't have access to ${label} — ask the store owner to grant it from Settings → Team.`;
	}
	return "You don't have access to this store.";
}

/** Human names for the areas, for refusal copy. Kept beside the gate (the
 * server must not import the client's copy module); `permissions.test.ts`
 * pins that every area has one. */
const AREA_LABEL: Record<PermissionArea, string> = {
	orders: "orders",
	products: "products",
	customers: "customers",
	bookings: "bookings",
	insights: "business insights",
	exports: "data export",
	store_settings: "store settings",
	fulfilment: "fulfilment settings",
	payments_settings: "payment details",
	integrations: "integrations",
	billing: "billing",
};

/**
 * `requireRetailerAccess` that answers `null` instead of throwing on a denied
 * or unauthenticated caller. For reads inside screens a member legitimately
 * sees where a missing grant must render as a LOCKED state, never crash the
 * tab (e.g. the courier account section inside Settings → Fulfilment). Still
 * throws "Retailer not found" — a dangling id is a bug, not a lock.
 */
export async function tryRetailerAccess(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	requirement: AccessRequirement,
): Promise<RetailerAccess | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	return resolveAccessForIdentity(ctx, retailer, identity.subject, requirement);
}

async function resolveAccessForIdentity(
	ctx: QueryCtx | MutationCtx,
	retailer: Doc<"retailers">,
	subject: string,
	requirement: AccessRequirement,
): Promise<RetailerAccess | null> {
	if (retailer.userId === subject) {
		return { retailer, role: "owner", actingAsAdmin: false, userId: subject };
	}
	if (adminUserIds().includes(subject)) {
		return { retailer, role: "admin", actingAsAdmin: true, userId: subject };
	}
	const membership = await activeMembership(ctx, retailer._id, subject);
	if (!membership) return null;
	if ("ownerOnly" in requirement) return null;
	if (
		"area" in requirement &&
		!hasPermission(membership.permissions, requirement.area, requirement.level)
	) {
		return null;
	}
	return {
		retailer,
		role: "member",
		actingAsAdmin: false,
		userId: subject,
		membership,
	};
}

/**
 * The store the signed-in caller OPERATES — their own store when they own
 * one, else the store of their active membership. This is the resolver behind
 * every zero-arg "my store" read (`getMyRetailer`, counter checkout, claim
 * links…) that used to mean "the store I own"; with team members those now
 * mean "the store I work in".
 *
 * Deliberately NOT permission-checked — it answers WHICH store, and the
 * caller's per-surface requirement is enforced where the data is read. A
 * storeless admin stays storeless here (the admin console, not membership,
 * is how admins reach other stores). Returns null when signed out or when the
 * caller has no store relationship (client routes that to /onboarding).
 */
export async function resolveMyRetailer(
	ctx: QueryCtx | MutationCtx,
): Promise<RetailerAccess | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	const own = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.first();
	if (own) {
		return {
			retailer: own,
			role: "owner",
			actingAsAdmin: false,
			userId: identity.subject,
		};
	}
	const memberships = await ctx.db
		.query("retailerMembers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.collect();
	const active = memberships.find((m) => m.status === "active");
	if (!active) return null;
	const retailer = await ctx.db.get(active.retailerId);
	if (!retailer) return null;
	return {
		retailer,
		role: "member",
		actingAsAdmin: false,
		userId: identity.subject,
		membership: active,
	};
}

/**
 * `resolveMyRetailer`, then check `requirement` against that store — the
 * zero-arg reads whose ANSWER depends on a grant (e.g. the billing tab's
 * queries: an owner sees them, a member needs billing:read, everyone else gets
 * null and the tab renders locked).
 */
export async function resolveMyRetailerFor(
	ctx: QueryCtx | MutationCtx,
	requirement: AccessRequirement,
): Promise<RetailerAccess | null> {
	const my = await resolveMyRetailer(ctx);
	if (!my) return null;
	return tryRetailerAccess(ctx, my.retailer._id, requirement);
}

/**
 * Record an `adminAuditLog` row for a write, but ONLY when it was performed by an
 * admin acting on a store they don't own (`access.actingAsAdmin`). A no-op for
 * ordinary owner AND member writes — members are attributed on the data itself
 * (`orderEvents.actorUserId`), not in the admin audit trail.
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
