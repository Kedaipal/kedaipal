// Seat math + cap enforcement for team members (86exr91r4).
//
// `PLAN_CAPS.userCap` is TOTAL people including the owner (Starter 1 / Pro 3 /
// Scale 6 — "You + 0/2/5 teammates"), so member rows get `userCap - 1` seats.
// Pending invites hold a seat: an invite is a promise, and promising a 4th
// person a seat on a 3-person plan is the lie the cap exists to prevent.
//
// WHERE ENFORCEMENT RUNS: `enforceSeatCap` is called from the ONE place a
// subscription's plan actually flips — `settleInvoicePaid` (every rail funnels
// there: manual mark-paid, Pay-now, auto-renew, and a scheduled downgrade,
// which is billed as the pending plan's invoice and applied at settle). States
// that LOCK a store without flipping the plan — payment lapse, comp turned
// off, Off-Season Hold — deliberately drop nobody: the store is view-only for
// members exactly as for the owner, and seats survive (Zaki, 24 Sep 2026). A
// store that was over-cap under a comp's unlimited seats reconciles on its
// next paid settle.
//
// Drop order when over cap: pending invites first (newest first — an unkept
// promise is the cheapest thing to take back), then active members, newest
// `acceptedAt` first. Every dropped MEMBER is emailed; the owner gets one
// summary. Dropped invites get no email — their /join link now explains
// itself ("no longer valid, ask {owner}").

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isUnlimited } from "./plans";

/** Member seats available under a total-people cap. Unlimited stays unlimited. */
export function memberSeatLimit(userCap: number): number {
	if (isUnlimited(userCap)) return userCap;
	return Math.max(0, userCap - 1);
}

export type SeatRows = {
	active: Doc<"retailerMembers">[];
	invited: Doc<"retailerMembers">[];
};

/** All seat-holding rows for a store. `.collect()` is deliberate: the row
 * count is bounded by the seat cap itself (≤ a handful; a comped store's
 * "unlimited" is a real-world dozen, not a table). */
export async function seatRows(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<SeatRows> {
	const active = await ctx.db
		.query("retailerMembers")
		.withIndex("by_retailer_status", (q) =>
			q.eq("retailerId", retailerId).eq("status", "active"),
		)
		.collect();
	const invited = await ctx.db
		.query("retailerMembers")
		.withIndex("by_retailer_status", (q) =>
			q.eq("retailerId", retailerId).eq("status", "invited"),
		)
		.collect();
	return { active, invited };
}

export type SeatCapResult = {
	/** Invites deleted to fit the cap (newest first). */
	cancelledInvites: number;
	/** Members dropped to fit the cap (newest first). */
	removedMembers: Array<{ email: string; displayName?: string }>;
};

/**
 * Reconcile a store's seats against a (new) total-people cap. No-op within
 * cap. Beyond it: deletes over-cap invites, marks over-cap members
 * `removed (plan_change)`, and schedules the emails — each dropped member is
 * told, the owner gets a summary naming everyone. Idempotent: a second run
 * finds the store within cap.
 *
 * `removedBy` is stamped with the OWNER's subject: the drop is a consequence
 * of the owner's plan change, and the removed screen says "ask {owner}" — a
 * system pseudo-actor would dead-end that conversation.
 */
export async function enforceSeatCap(
	ctx: MutationCtx,
	retailer: Doc<"retailers">,
	userCap: number,
	now: number,
): Promise<SeatCapResult> {
	const result: SeatCapResult = { cancelledInvites: 0, removedMembers: [] };
	if (isUnlimited(userCap)) return result;
	const limit = memberSeatLimit(userCap);
	const { active, invited } = await seatRows(ctx, retailer._id);
	let over = active.length + invited.length - limit;
	if (over <= 0) return result;

	const invitesNewestFirst = [...invited].sort(
		(a, b) => b.invitedAt - a.invitedAt,
	);
	for (const invite of invitesNewestFirst) {
		if (over <= 0) break;
		await ctx.db.delete(invite._id);
		result.cancelledInvites++;
		over--;
	}

	const membersNewestFirst = [...active].sort(
		(a, b) => (b.acceptedAt ?? b.invitedAt) - (a.acceptedAt ?? a.invitedAt),
	);
	for (const member of membersNewestFirst) {
		if (over <= 0) break;
		await ctx.db.patch(member._id, {
			status: "removed",
			removedAt: now,
			removedBy: retailer.userId,
			removedReason: "plan_change",
		});
		result.removedMembers.push({
			email: member.email,
			displayName: member.displayName,
		});
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamAccessRevoked",
			to: member.email,
			retailerId: retailer._id,
			revokeReason: "plan_change",
		});
		over--;
	}

	if (result.removedMembers.length > 0) {
		await ctx.scheduler.runAfter(0, internal.team.sendTeamEmail, {
			kind: "teamSeatSummary",
			retailerId: retailer._id,
			droppedNames: result.removedMembers.map(
				(m) => m.displayName ?? m.email,
			),
		});
	}
	return result;
}
