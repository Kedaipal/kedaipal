// Team members (ClickUp 86exr91r4, docs/team-members.md): the invite
// lifecycle, membership reads, and the team emails.
//
// Shape of the feature: the OWNER (retailers.userId) invites helpers by email
// from Settings → Team, choosing per-area grants up front
// (convex/lib/permissions.ts). The invitee accepts on /join/<token> — or from
// the onboarding banner if they signed up directly — with their own Clerk
// account, whose verified email must equal the invited email. Access is
// re-resolved on every request through requireRetailerAccess, so removal and
// grant edits take effect on the member's next call, no session to invalidate.
//
// ONE STORE PER LOGIN (v1): a login either owns a store or holds one active
// membership, never both, never two. Ending a store relationship is always an
// explicit act on the thing being left — leaving a team is one confirm;
// leaving a STORE means deleting it first. Accepting an invite never cancels
// a subscription as a side effect, which is why an owner's accept is refused
// with an explanation instead of a takeover flow.
//
// Invite tokens: 32 random bytes (hex) in the URL, sha256 AT REST (a DB read
// must not mint access — see convex/lib/sha256.ts for why not crypto.subtle).
// The hash is KEPT after accept so a re-clicked link can honestly say "this
// invite was already used" instead of pretending it never existed. A token is
// useless without also controlling the invited inbox's Clerk account.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	adminUserIds,
	logAdminAction,
	requireRetailerAccess,
} from "./lib/auth";
import { sendEmail } from "./lib/email";
import {
	type Locale,
	renderTeamEmail,
	type TeamEmailKey,
	type TeamEmailVars,
} from "./lib/emailCopy";
import { DEFAULT_LOCALE } from "./lib/locale";
import {
	type MemberPermissions,
	memberPermissionsValidator,
	sanitizePermissions,
} from "./lib/permissions";
import { isUnlimited } from "./lib/plans";
import { memberSeatLimit, seatRows } from "./lib/seats";
import { sha256Hex } from "./lib/sha256";
import { assertValidEmail } from "./lib/slug";
import {
	assertSubscriptionActive,
	loadSubscription,
	resolveAccess,
} from "./subscriptions";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Resend throttle — protects the Resend quota and closes a nag vector. */
const RESEND_COOLDOWN_MS = 60 * 1000;

function siteUrl(): string {
	return process.env.SITE_URL ?? "https://kedaipal.com";
}

/** 32 random bytes as hex (256 bits, URL-safe with no encoder) + its hash. */
function mintInviteToken(): { token: string; hash: string } {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return { token, hash: sha256Hex(token) };
}

/** "a•••@gmail.com" — enough for the holder of a link to recognise which
 * inbox was invited, useless to anyone else. Exported for the order
 * timeline's actor names (convex/orders.getTimeline), which fall back to the
 * same masking when a member never set a display name. */
export function maskEmail(email: string): string {
	const at = email.indexOf("@");
	if (at <= 1) return `•••${email.slice(at)}`;
	return `${email[0]}•••${email.slice(at)}`;
}

/** The Clerk identity's verified email, normalized like invite emails are. */
function identityEmail(identity: {
	email?: unknown;
}): string | undefined {
	return typeof identity.email === "string" && identity.email.trim().length > 0
		? identity.email.trim().toLowerCase()
		: undefined;
}

/** Best display name the identity offers; undefined over an empty string. */
function identityDisplayName(identity: {
	name?: unknown;
	givenName?: unknown;
	familyName?: unknown;
}): string | undefined {
	if (typeof identity.name === "string" && identity.name.trim().length > 0)
		return identity.name.trim();
	const parts = [identity.givenName, identity.familyName]
		.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
		.map((p) => p.trim());
	return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Member seats this store may hold (`userCap - 1`). Resolved through
 * `resolveAccess` so comped stores and an admin's own store get unlimited
 * seats exactly like every other cap — `adminFullAccess` is a property of the
 * store's OWNER, so an admin act-as inviting on a normal seller's store still
 * sees the seller's real limit.
 */
async function effectiveSeatLimit(
	ctx: QueryCtx | MutationCtx,
	retailer: Doc<"retailers">,
): Promise<number> {
	const sub = await loadSubscription(ctx, retailer._id);
	const caps = resolveAccess(sub, {
		adminFullAccess: adminUserIds().includes(retailer.userId),
	}).caps;
	return memberSeatLimit(caps.userCap);
}

/** The caller's store relationships, for the one-store rule + onboarding. */
async function callerStoreTies(
	ctx: QueryCtx | MutationCtx,
	subject: string,
): Promise<{
	ownStore: Doc<"retailers"> | null;
	activeMembership:
		| { row: Doc<"retailerMembers">; retailer: Doc<"retailers"> | null }
		| null;
}> {
	const ownStore = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", subject))
		.first();
	const memberships = await ctx.db
		.query("retailerMembers")
		.withIndex("by_user", (q) => q.eq("userId", subject))
		.collect();
	const active = memberships.find((m) => m.status === "active") ?? null;
	return {
		ownStore,
		activeMembership: active
			? { row: active, retailer: await ctx.db.get(active.retailerId) }
			: null,
	};
}

// ---------------------------------------------------------------------------
// Owner-side management
// ---------------------------------------------------------------------------

export const invite = mutation({
	args: {
		retailerId: v.id("retailers"),
		email: v.string(),
		permissions: memberPermissionsValidator,
	},
	handler: async (
		ctx,
		args,
	): Promise<{ memberId: Id<"retailerMembers"> }> => {
		const access = await requireRetailerAccess(ctx, args.retailerId, {
			ownerOnly: true,
		});
		const email = assertValidEmail(args.email);

		// The owner inviting themselves is always a mistake — the owner needs no
		// seat. Checked against the CALLER's identity email (notifyEmail is a
		// routing address that may legitimately be a helper's shared ops inbox).
		const identity = await ctx.auth.getUserIdentity();
		if (identity && identityEmail(identity) === email && access.role === "owner")
			throw new ConvexError(
				"That's your own email — the owner doesn't need a seat.",
			);

		const existing = await ctx.db
			.query("retailerMembers")
			.withIndex("by_email", (q) => q.eq("email", email))
			.collect();
		const onThisStore = existing.find(
			(m) => m.retailerId === args.retailerId && m.status !== "removed",
		);
		if (onThisStore) {
			throw new ConvexError(
				onThisStore.status === "active"
					? "That person is already on your team."
					: "That email already has a pending invitation — resend it instead.",
			);
		}

		// View-only lock: a lapsed store can't ADD seats (growth-write). Exits —
		// remove, cancel, leave — stay unlocked below: cutting access off must
		// never require paying first. Admin act-as bypasses (white-glove).
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, args.retailerId);

		const limit = await effectiveSeatLimit(ctx, access.retailer);
		const { active, invited } = await seatRows(ctx, args.retailerId);
		if (!isUnlimited(limit) && active.length + invited.length >= limit) {
			// The Team tab disables Invite with this reason before the request; the
			// server repeats it because the client is a convenience, not the rule.
			// Counted in PEOPLE, like the seat meter above it — "3 of 3 seats
			// used" beside "all 2 member seats" read as two different limits.
			const total = limit + 1;
			throw new ConvexError(
				`All ${total} seats are in use — remove a teammate or upgrade your plan for more.`,
			);
		}

		const now = Date.now();
		const { token, hash } = mintInviteToken();
		const memberId = await ctx.db.insert("retailerMembers", {
			retailerId: args.retailerId,
			email,
			permissions: sanitizePermissions(args.permissions),
			status: "invited",
			inviteTokenHash: hash,
			expiresAt: now + INVITE_EXPIRY_MS,
			lastInviteSentAt: now,
			invitedBy: access.userId,
			invitedAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamInvite",
			retailerId: args.retailerId,
			to: email,
			inviteToken: token,
		});
		await logAdminAction(ctx, access, "team.invite", memberId);
		return { memberId };
	},
});

export const resend = mutation({
	args: { memberId: v.id("retailerMembers") },
	handler: async (ctx, { memberId }): Promise<null> => {
		const row = await ctx.db.get(memberId);
		if (!row) throw new ConvexError("Invitation not found");
		const access = await requireRetailerAccess(ctx, row.retailerId, {
			ownerOnly: true,
		});
		if (row.status !== "invited")
			throw new ConvexError("That invitation was already used.");
		// View-only lock: resending extends a seat promise — same class as invite.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, row.retailerId);
		const now = Date.now();
		if (row.lastInviteSentAt && now - row.lastInviteSentAt < RESEND_COOLDOWN_MS)
			throw new ConvexError(
				"Just sent — give it a minute before resending.",
			);
		// Rotate the token: the old link dies, the new email carries the only
		// live one. Expiry restarts so a resent invite is a fresh 7-day offer.
		const { token, hash } = mintInviteToken();
		await ctx.db.patch(memberId, {
			inviteTokenHash: hash,
			expiresAt: now + INVITE_EXPIRY_MS,
			lastInviteSentAt: now,
		});
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamInvite",
			retailerId: row.retailerId,
			to: row.email,
			inviteToken: token,
		});
		await logAdminAction(ctx, access, "team.resend", memberId);
		return null;
	},
});

export const cancelInvite = mutation({
	args: { memberId: v.id("retailerMembers") },
	handler: async (ctx, { memberId }): Promise<null> => {
		const row = await ctx.db.get(memberId);
		if (!row) return null; // already gone — cancel is idempotent
		const access = await requireRetailerAccess(ctx, row.retailerId, {
			ownerOnly: true,
		});
		if (row.status !== "invited")
			throw new ConvexError(
				"That invitation was already accepted — remove the member instead.",
			);
		await ctx.db.delete(memberId);
		await logAdminAction(ctx, access, "team.cancelInvite", memberId);
		return null;
	},
});

export const updatePermissions = mutation({
	args: {
		memberId: v.id("retailerMembers"),
		permissions: memberPermissionsValidator,
	},
	handler: async (ctx, { memberId, permissions }): Promise<null> => {
		const row = await ctx.db.get(memberId);
		if (!row) throw new ConvexError("Member not found");
		const access = await requireRetailerAccess(ctx, row.retailerId, {
			ownerOnly: true,
		});
		if (row.status === "removed")
			throw new ConvexError("That person is no longer on the team.");
		// View-only lock: grant edits are a deliberate configuration tap (the
		// setPinned precedent) — locked stores read, they don't reshape access.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, row.retailerId);
		// Takes effect on the member's next request — every server function
		// re-resolves access, and Convex reactivity refreshes their open tabs.
		await ctx.db.patch(memberId, {
			permissions: sanitizePermissions(permissions),
		});
		await logAdminAction(ctx, access, "team.updatePermissions", memberId);
		return null;
	},
});

export const remove = mutation({
	args: { memberId: v.id("retailerMembers") },
	handler: async (ctx, { memberId }): Promise<null> => {
		const row = await ctx.db.get(memberId);
		if (!row) throw new ConvexError("Member not found");
		const access = await requireRetailerAccess(ctx, row.retailerId, {
			ownerOnly: true,
		});
		if (row.status !== "active")
			throw new ConvexError(
				row.status === "invited"
					? "That's a pending invitation — cancel it instead."
					: "That person is no longer on the team.",
			);
		await ctx.db.patch(memberId, {
			status: "removed",
			removedAt: Date.now(),
			removedBy: access.userId,
			removedReason: "removed_by_owner",
		});
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamAccessRevoked",
			retailerId: row.retailerId,
			to: row.email,
			revokeReason: "removed_by_owner",
		});
		await logAdminAction(ctx, access, "team.remove", memberId);
		return null;
	},
});

export const leave = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<null> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			anyMember: true,
		});
		if (access.role !== "member" || !access.membership)
			throw new ConvexError(
				"Only team members can leave — an owner closes the store instead.",
			);
		await ctx.db.patch(access.membership._id, {
			status: "removed",
			removedAt: Date.now(),
			removedBy: access.userId,
			removedReason: "left",
		});
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamMemberLeft",
			retailerId,
			memberName:
				access.membership.displayName ?? access.membership.email,
			memberEmail: access.membership.email,
			leftReason: "left",
		});
		return null;
	},
});

// ---------------------------------------------------------------------------
// Team list (Settings → Team)
// ---------------------------------------------------------------------------

export type TeamMemberRow = {
	memberId: Id<"retailerMembers">;
	status: "invited" | "active";
	/** Always present for the owner/admin view; a member viewing the list sees
	 * other people's emails MASKED (their colleagues' inboxes are not their
	 * business) and their own in full. */
	email: string;
	displayName?: string;
	/** Grants — owner/admin view and the viewer's own row only. */
	permissions?: MemberPermissions;
	invitedAt: number;
	acceptedAt?: number;
	expiresAt?: number;
	lastInviteSentAt?: number;
	isSelf: boolean;
};

export const list = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		viewerRole: "owner" | "member" | "admin";
		seats: {
			/** Member seats the plan allows (owner excluded). */
			memberLimit: number;
			unlimited: boolean;
			activeCount: number;
			invitedCount: number;
		};
		members: TeamMemberRow[];
	}> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			anyMember: true,
		});
		const { active, invited } = await seatRows(ctx, retailerId);
		const limit = await effectiveSeatLimit(ctx, access.retailer);
		const privileged = access.role !== "member";
		const rows = [...active, ...invited].sort(
			(a, b) => a.invitedAt - b.invitedAt,
		);
		return {
			viewerRole: access.role,
			seats: {
				memberLimit: limit,
				unlimited: isUnlimited(limit),
				activeCount: active.length,
				invitedCount: invited.length,
			},
			members: rows.map((m) => {
				const isSelf = m.userId === access.userId;
				const full = privileged || isSelf;
				return {
					memberId: m._id,
					status: m.status as "invited" | "active",
					email: full ? m.email : maskEmail(m.email),
					displayName: m.displayName,
					permissions: full ? m.permissions : undefined,
					invitedAt: m.invitedAt,
					acceptedAt: m.acceptedAt,
					expiresAt: full ? m.expiresAt : undefined,
					lastInviteSentAt: full ? m.lastInviteSentAt : undefined,
					isSelf,
				};
			}),
		};
	},
});

// ---------------------------------------------------------------------------
// Accepting (the /join page + the onboarding banner)
// ---------------------------------------------------------------------------

/**
 * Why results instead of throws: every non-happy outcome here is an expected
 * human situation with its own copy on /join, not an error — a throw would
 * reach the client as one generic message and flatten them.
 */
export type AcceptResult =
	| { ok: true; storeName: string }
	| {
			ok: false;
			reason:
				| "invalid" // unknown/revoked token
				| "used" // someone already accepted this invite
				| "expired"
				| "email_mismatch" // signed in with a different inbox
				| "own_store" // caller owns a store (one store per login)
				| "other_membership" // caller already works in another store
				| "no_seat"; // plan dropped below the invite between send and accept
			/** Which inbox the invite is for (masked) — on email_mismatch. */
			invitedEmail?: string;
			/** The blocking store's name — on own_store / other_membership. */
			storeName?: string;
	  };

async function acceptRow(
	ctx: MutationCtx,
	row: Doc<"retailerMembers">,
	identity: {
		subject: string;
		name?: unknown;
		givenName?: unknown;
		familyName?: unknown;
	},
): Promise<AcceptResult> {
	const retailer = await ctx.db.get(row.retailerId);
	if (!retailer) return { ok: false, reason: "invalid" };

	const { ownStore, activeMembership } = await callerStoreTies(
		ctx,
		identity.subject,
	);
	// One store per login. Never a silent failure, never a side effect on the
	// blocking store — /join renders these with the way out (leave the other
	// team, or close their own store first) + a WhatsApp-the-inviter CTA.
	if (ownStore)
		return { ok: false, reason: "own_store", storeName: ownStore.storeName };
	if (activeMembership)
		return {
			ok: false,
			reason: "other_membership",
			storeName: activeMembership.retailer?.storeName,
		};

	// Cap re-check: the plan may have dropped between invite and accept.
	// enforceSeatCap deletes over-cap invites at settle, so this is the belt
	// for the race where both land in the same moment.
	const limit = await effectiveSeatLimit(ctx, retailer);
	if (!isUnlimited(limit)) {
		const { active } = await seatRows(ctx, row.retailerId);
		if (active.length + 1 > limit) return { ok: false, reason: "no_seat" };
	}

	await ctx.db.patch(row._id, {
		status: "active",
		userId: identity.subject,
		displayName: identityDisplayName(identity),
		acceptedAt: Date.now(),
	});
	await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
		kind: "teamMemberJoined",
		retailerId: row.retailerId,
		memberName: identityDisplayName(identity) ?? row.email,
		memberEmail: row.email,
	});
	return { ok: true, storeName: retailer.storeName };
}

export const acceptInvite = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<AcceptResult> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const row = await ctx.db
			.query("retailerMembers")
			.withIndex("by_token", (q) => q.eq("inviteTokenHash", sha256Hex(token)))
			.unique();
		if (!row) return { ok: false, reason: "invalid" };
		if (row.status === "active") return { ok: false, reason: "used" };
		if (row.status === "removed") return { ok: false, reason: "invalid" };
		if (row.expiresAt !== undefined && row.expiresAt < Date.now())
			return { ok: false, reason: "expired" };
		// The token proves the link; the EMAIL proves the person. Clerk verifies
		// addresses (email-code sign-in), so equality here means the accepter
		// controls the invited inbox — a forwarded link binds nobody.
		if (identityEmail(identity) !== row.email)
			return {
				ok: false,
				reason: "email_mismatch",
				invitedEmail: maskEmail(row.email),
			};
		return acceptRow(ctx, row, identity);
	},
});

/**
 * Accept WITHOUT a token: the invitee signed up directly (never clicked the
 * link) and is looking at the onboarding banner. Safe because the banner only
 * lists invites addressed to the caller's own verified email — controlling
 * the inbox is exactly what the token flow ultimately verifies too.
 */
export const acceptPendingInvite = mutation({
	args: { memberId: v.id("retailerMembers") },
	handler: async (ctx, { memberId }): Promise<AcceptResult> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const row = await ctx.db.get(memberId);
		if (!row || row.status === "removed")
			return { ok: false, reason: "invalid" };
		if (row.status === "active") return { ok: false, reason: "used" };
		if (identityEmail(identity) !== row.email)
			return {
				ok: false,
				reason: "email_mismatch",
				invitedEmail: maskEmail(row.email),
			};
		if (row.expiresAt !== undefined && row.expiresAt < Date.now())
			return { ok: false, reason: "expired" };
		return acceptRow(ctx, row, identity);
	},
});

/** Everything /join/$token needs to render its state — including, for a
 * signed-in viewer, the conflicts they'd hit BEFORE they tap Accept. */
export const getInviteContext = query({
	args: { token: v.string() },
	handler: async (
		ctx,
		{ token },
	): Promise<
		| { state: "invalid" }
		// Separate members (not `"expired" | "used"` in one) so the client's
		// ternary chain narrows all the way down to the valid shape.
		| { state: "expired"; storeName: string }
		| { state: "used"; storeName: string }
		| {
				state: "valid";
				storeName: string;
				invitedEmail: string; // masked
				expiresAt?: number;
				/** Store's public WhatsApp number — the "message the inviter" CTA
				 * on conflict states. Already public on the storefront. */
				ownerWaPhone?: string;
				viewer: {
					signedIn: boolean;
					emailMatches?: boolean;
					ownsStore?: string; // their store's name
					memberOf?: string; // the other store's name
				};
		  }
	> => {
		const row = await ctx.db
			.query("retailerMembers")
			.withIndex("by_token", (q) => q.eq("inviteTokenHash", sha256Hex(token)))
			.unique();
		if (!row || row.status === "removed") return { state: "invalid" };
		const retailer = await ctx.db.get(row.retailerId);
		if (!retailer) return { state: "invalid" };
		if (row.status === "active")
			return { state: "used", storeName: retailer.storeName };
		if (row.expiresAt !== undefined && row.expiresAt < Date.now())
			return { state: "expired", storeName: retailer.storeName };

		const identity = await ctx.auth.getUserIdentity();
		let viewer: {
			signedIn: boolean;
			emailMatches?: boolean;
			ownsStore?: string;
			memberOf?: string;
		} = { signedIn: false };
		if (identity) {
			const ties = await callerStoreTies(ctx, identity.subject);
			viewer = {
				signedIn: true,
				emailMatches: identityEmail(identity) === row.email,
				ownsStore: ties.ownStore?.storeName,
				memberOf: ties.activeMembership?.retailer?.storeName,
			};
		}
		return {
			state: "valid",
			storeName: retailer.storeName,
			invitedEmail: maskEmail(row.email),
			expiresAt: row.expiresAt,
			ownerWaPhone: retailer.waPhone,
			viewer,
		};
	},
});

// ---------------------------------------------------------------------------
// Onboarding hooks (banner + removed state + create-store confirm)
// ---------------------------------------------------------------------------

/** Live invites addressed to the caller's verified email — the "You've been
 * invited to {Store}" banner above the create-store wizard. */
export const myPendingInvites = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			memberId: Id<"retailerMembers">;
			storeName: string;
			expiresAt?: number;
		}>
	> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const email = identityEmail(identity);
		if (!email) return [];
		const rows = await ctx.db
			.query("retailerMembers")
			.withIndex("by_email", (q) => q.eq("email", email))
			.collect();
		const now = Date.now();
		const out: Array<{
			memberId: Id<"retailerMembers">;
			storeName: string;
			expiresAt?: number;
		}> = [];
		for (const row of rows) {
			if (row.status !== "invited") continue;
			if (row.expiresAt !== undefined && row.expiresAt < now) continue;
			const retailer = await ctx.db.get(row.retailerId);
			if (!retailer) continue;
			out.push({
				memberId: row._id,
				storeName: retailer.storeName,
				expiresAt: row.expiresAt,
			});
		}
		return out;
	},
});

/**
 * The caller's membership situation, for /onboarding and the create-store
 * confirm: an ACTIVE membership means creating a store costs them their seat
 * (the wizard says so up front); a latest REMOVED row (with no store and no
 * active seat) explains the "you no longer have access" state instead of a
 * bare wizard.
 */
export const myMembershipState = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		active: { retailerId: Id<"retailers">; storeName: string } | null;
		removed: {
			storeName: string;
			reason: "removed_by_owner" | "left" | "left_to_create_store" | "plan_change" | "store_deleted";
			removedAt: number;
		} | null;
	}> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { active: null, removed: null };
		const { ownStore, activeMembership } = await callerStoreTies(
			ctx,
			identity.subject,
		);
		if (activeMembership) {
			return {
				active: activeMembership.retailer
					? {
							retailerId: activeMembership.retailer._id,
							storeName: activeMembership.retailer.storeName,
						}
					: null,
				removed: null,
			};
		}
		// Removed banner only when they truly have nowhere to land — an owner or
		// a member elsewhere doesn't need yesterday's goodbye on their wizard.
		if (ownStore) return { active: null, removed: null };
		const memberships = await ctx.db
			.query("retailerMembers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.collect();
		const latestRemoved = memberships
			.filter((m) => m.status === "removed" && m.removedReason !== "left")
			.sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))[0];
		if (!latestRemoved?.removedAt || !latestRemoved.removedReason)
			return { active: null, removed: null };
		const retailer = await ctx.db.get(latestRemoved.retailerId);
		if (!retailer) return { active: null, removed: null };
		return {
			active: null,
			removed: {
				storeName: retailer.storeName,
				reason: latestRemoved.removedReason,
				removedAt: latestRemoved.removedAt,
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export const getEmailMeta = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		storeName: string;
		locale: Locale;
		notifyEmail?: string;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return {
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? DEFAULT_LOCALE,
			notifyEmail: retailer.notifyEmail,
		};
	},
});

/**
 * One dispatcher for every team email. Fire-and-forget (scheduled with
 * runAfter(0)); failures log and are never allowed to fail the mutation that
 * scheduled them — the seat change itself already happened.
 *
 * `storeNameOverride`/`localeOverride` exist for the store-deleted goodbye:
 * by the time it sends, the retailer row is gone, so the deletion phase
 * snapshots what the email needs into the args.
 *
 * The raw invite token rides the scheduler args (transient) so the email can
 * carry the only live link; at REST it exists solely as a hash.
 */
export const sendTeamEmail = internalAction({
	args: {
		kind: v.union(
			v.literal("teamInvite"),
			v.literal("teamAccessRevoked"),
			v.literal("teamMemberJoined"),
			v.literal("teamMemberLeft"),
			v.literal("teamSeatSummary"),
		),
		retailerId: v.optional(v.id("retailers")),
		/** Recipient for invitee-facing kinds; owner kinds go to notifyEmail. */
		to: v.optional(v.string()),
		inviteToken: v.optional(v.string()),
		revokeReason: v.optional(
			v.union(
				v.literal("removed_by_owner"),
				v.literal("plan_change"),
				v.literal("store_deleted"),
			),
		),
		memberName: v.optional(v.string()),
		memberEmail: v.optional(v.string()),
		leftReason: v.optional(
			v.union(v.literal("left"), v.literal("left_to_create_store")),
		),
		droppedNames: v.optional(v.array(v.string())),
		storeNameOverride: v.optional(v.string()),
		localeOverride: v.optional(
			v.union(v.literal("en"), v.literal("ms"), v.literal("zh")),
		),
	},
	handler: async (ctx, args): Promise<null> => {
		let storeName = args.storeNameOverride;
		let locale: Locale = args.localeOverride ?? DEFAULT_LOCALE;
		let notifyEmail: string | undefined;
		if (args.retailerId) {
			const meta = await ctx.runQuery(internal.team.getEmailMeta, {
				retailerId: args.retailerId,
			});
			if (meta) {
				storeName = storeName ?? meta.storeName;
				locale = args.localeOverride ?? meta.locale;
				notifyEmail = meta.notifyEmail;
			}
		}
		if (!storeName) {
			console.error(`[team] ${args.kind} email skipped — no store name`);
			return null;
		}

		const base = siteUrl();
		const ownerFacing =
			args.kind === "teamMemberJoined" ||
			args.kind === "teamMemberLeft" ||
			args.kind === "teamSeatSummary";
		const to = ownerFacing ? notifyEmail : args.to;
		if (!to) {
			// An owner with no notifyEmail simply gets no owner alerts — same
			// posture as every other retailer email.
			if (!ownerFacing)
				console.error(`[team] ${args.kind} email skipped — no recipient`);
			return null;
		}
		const ctaUrl =
			args.kind === "teamInvite"
				? `${base}/join/${args.inviteToken ?? ""}`
				: args.kind === "teamAccessRevoked"
					? base
					: `${base}/app/settings?tab=team`;
		const vars: TeamEmailVars = {
			storeName,
			ctaUrl,
			expiresDays: 7,
			revokeReason: args.revokeReason,
			memberName: args.memberName,
			memberEmail: args.memberEmail,
			leftReason: args.leftReason,
			droppedNames: args.droppedNames,
		};
		const { subject, html, text } = renderTeamEmail(
			locale,
			args.kind as TeamEmailKey,
			vars,
		);
		try {
			await sendEmail(to, subject, html, text);
		} catch (err) {
			console.error(
				`[team] ${args.kind} email failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		return null;
	},
});
