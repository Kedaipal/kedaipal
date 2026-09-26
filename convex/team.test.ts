/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceSeatCap } from "./lib/seats";
import { sha256Hex } from "./lib/sha256";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const OWNER = { subject: "user_owner", email: "owner@example.com" };
const HELPER = {
	subject: "user_helper",
	email: "helper@example.com",
	name: "Aina",
};
const OUTSIDER = { subject: "user_outsider", email: "outsider@example.com" };
const ADMIN = { subject: "user_admin", email: "admin@example.com" };

async function seedStore(
	t: ReturnType<typeof setup>,
	who = OWNER,
	slugSuffix = "a",
) {
	const asOwner = t.withIdentity(who);
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slugSuffix.toUpperCase()}`,
		slug: `team-store-${slugSuffix}`,
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Invite HELPER and flip the row to ACTIVE via the real accept path (the
 * onboarding-banner variant, which needs no raw token). */
async function seedActiveMember(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	permissions: Record<string, "read" | "write"> = { orders: "write" },
	who = HELPER,
) {
	const asOwner = t.withIdentity(OWNER);
	const { memberId } = await asOwner.mutation(api.team.invite, {
		retailerId,
		email: who.email,
		permissions,
	});
	const result = await t
		.withIdentity(who)
		.mutation(api.team.acceptPendingInvite, { memberId });
	expect(result).toMatchObject({ ok: true });
	return memberId;
}

describe("invite lifecycle", () => {
	test("owner invites → row invited, permissions sanitized, email normalized", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		const { memberId } = await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: "  Helper@Example.COM ",
			// billing write + insights write are not grantable → clamp to read.
			permissions: { orders: "write", billing: "write", insights: "write" },
		});
		const row = await t.run(async (ctx) => ctx.db.get(memberId));
		expect(row).toMatchObject({
			email: "helper@example.com",
			status: "invited",
			permissions: { orders: "write", billing: "read", insights: "read" },
		});
		// Token at rest is a sha256 hex, never the raw capability.
		expect(row?.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(row?.expiresAt).toBeGreaterThan(Date.now());
	});

	test("duplicate + owner-self invites are refused", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: HELPER.email,
			permissions: {},
		});
		await expect(
			asOwner.mutation(api.team.invite, {
				retailerId: store._id,
				email: HELPER.email,
				permissions: {},
			}),
		).rejects.toThrow(/pending invitation/);
		await expect(
			asOwner.mutation(api.team.invite, {
				retailerId: store._id,
				email: OWNER.email,
				permissions: {},
			}),
		).rejects.toThrow(/your own email/);
	});

	test("seat cap counts pending invites (trial store = Pro caps = 2 member seats)", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: "one@example.com",
			permissions: {},
		});
		await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: "two@example.com",
			permissions: {},
		});
		await expect(
			asOwner.mutation(api.team.invite, {
				retailerId: store._id,
				email: "three@example.com",
				permissions: {},
			}),
		).rejects.toThrow(/seats are in use/);
	});

	test("a member can never manage the team (ownerOnly)", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id, { orders: "write" });
		await expect(
			t.withIdentity(HELPER).mutation(api.team.invite, {
				retailerId: store._id,
				email: "friend@example.com",
				permissions: {},
			}),
		).rejects.toThrow(/Only the store owner/);
	});
});

describe("accepting", () => {
	test("token accept binds userId + displayName; wrong email refused", async () => {
		const t = setup();
		const store = await seedStore(t);
		const token = "f".repeat(64);
		const memberId = await t.run(async (ctx) =>
			ctx.db.insert("retailerMembers", {
				retailerId: store._id,
				email: HELPER.email,
				permissions: { orders: "write" },
				status: "invited",
				inviteTokenHash: sha256Hex(token),
				expiresAt: Date.now() + 1000 * 60,
				invitedBy: OWNER.subject,
				invitedAt: Date.now(),
			}),
		);
		// Signed in with a DIFFERENT inbox → mismatch, not a bind.
		const mismatch = await t
			.withIdentity(OUTSIDER)
			.mutation(api.team.acceptInvite, { token });
		expect(mismatch).toMatchObject({ ok: false, reason: "email_mismatch" });

		const accepted = await t
			.withIdentity(HELPER)
			.mutation(api.team.acceptInvite, { token });
		expect(accepted).toMatchObject({ ok: true, storeName: store.storeName });
		const row = await t.run(async (ctx) => ctx.db.get(memberId));
		expect(row).toMatchObject({
			status: "active",
			userId: HELPER.subject,
			displayName: "Aina",
		});

		// Re-clicking the link says "used", not "never existed".
		const again = await t
			.withIdentity(HELPER)
			.mutation(api.team.acceptInvite, { token });
		expect(again).toMatchObject({ ok: false, reason: "used" });
	});

	test("expired + unknown tokens read as such", async () => {
		const t = setup();
		const store = await seedStore(t);
		const token = "e".repeat(64);
		await t.run(async (ctx) =>
			ctx.db.insert("retailerMembers", {
				retailerId: store._id,
				email: HELPER.email,
				permissions: {},
				status: "invited",
				inviteTokenHash: sha256Hex(token),
				expiresAt: Date.now() - 1,
				invitedBy: OWNER.subject,
				invitedAt: Date.now() - 10,
			}),
		);
		const asHelper = t.withIdentity(HELPER);
		expect(
			await asHelper.mutation(api.team.acceptInvite, { token }),
		).toMatchObject({ ok: false, reason: "expired" });
		expect(
			await asHelper.mutation(api.team.acceptInvite, {
				token: "0".repeat(64),
			}),
		).toMatchObject({ ok: false, reason: "invalid" });
	});

	test("one store per login, both directions", async () => {
		const t = setup();
		const store = await seedStore(t);
		// OUTSIDER owns their own store → accepting is refused with the store named.
		await seedStore(t, OUTSIDER, "b");
		const asOwnerOfB = t.withIdentity(OUTSIDER);
		const invited = await t.withIdentity(OWNER).mutation(api.team.invite, {
			retailerId: store._id,
			email: OUTSIDER.email,
			permissions: {},
		});
		expect(
			await asOwnerOfB.mutation(api.team.acceptPendingInvite, {
				memberId: invited.memberId,
			}),
		).toMatchObject({ ok: false, reason: "own_store" });

		// HELPER is active on store A → accepting an invite from store B refused.
		await seedActiveMember(t, store._id);
		const storeB = await t
			.withIdentity(OUTSIDER)
			.query(api.retailers.getMyRetailer);
		const inviteB = await t.withIdentity(OUTSIDER).mutation(api.team.invite, {
			retailerId: (storeB as NonNullable<typeof storeB>)._id,
			email: HELPER.email,
			permissions: {},
		});
		expect(
			await t.withIdentity(HELPER).mutation(api.team.acceptPendingInvite, {
				memberId: inviteB.memberId,
			}),
		).toMatchObject({ ok: false, reason: "other_membership" });
	});
});

describe("member access through the gate", () => {
	test("getMyRetailer resolves the membership store with role + grants", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id, { orders: "read" });
		const asHelper = t.withIdentity(HELPER);
		const mine = await asHelper.query(api.retailers.getMyRetailer);
		expect(mine?._id).toBe(store._id);
		expect(mine?.role).toBe("member");
		expect(mine?.permissions).toEqual({ orders: "read" });
	});

	test("deny-by-default: no grant → Forbidden; grant opens exactly that area", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id, { orders: "read" });
		const asHelper = t.withIdentity(HELPER);
		// orders:read → the inbox list answers.
		await expect(
			asHelper.query(api.orders.countActionable, { retailerId: store._id }),
		).resolves.toBeDefined();
		// products has no grant → Forbidden, not empty.
		await expect(
			asHelper.query(api.products.listAll, { retailerId: store._id }),
		).rejects.toThrow(/don't have access to products/);
		// read never implies write: the same person can SEE an order but not
		// rearrange the shared inbox (setPinned gates at orders:write).
		const orderId = await t.run(async (ctx) =>
			ctx.db.insert("orders", {
				retailerId: store._id,
				shortId: "ORD-TEAM1",
				items: [],
				subtotal: 0,
				total: 0,
				currency: "MYR",
				status: "confirmed",
				channel: "whatsapp",
				customer: {},
				statusChangedAt: Date.now(),
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		await expect(
			asHelper.mutation(api.orders.setPinned, { orderId, pinned: true }),
		).rejects.toThrow(/permission to change orders/);
	});

	test("a stranger gets the GENERIC refusal — copy naming areas is for teammates only", async () => {
		const t = setup();
		const store = await seedStore(t);
		// OUTSIDER has no relationship to this store at all.
		await expect(
			t
				.withIdentity(OUTSIDER)
				.query(api.products.listAll, { retailerId: store._id }),
		).rejects.toThrow("Forbidden");
		await expect(
			t
				.withIdentity(OUTSIDER)
				.query(api.products.listAll, { retailerId: store._id }),
		).rejects.not.toThrow(/Settings → Team/);
	});

	test("updateSettings honors the field→area map", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id, {
			fulfilment: "write",
			store_settings: "write",
		});
		const asHelper = t.withIdentity(HELPER);
		// fulfilment write → editing a fulfilment rule is allowed.
		await expect(
			asHelper.mutation(api.retailers.updateSettings, {
				retailerId: store._id,
				minFulfilmentNoticeDays: 3,
			}),
		).resolves.toMatchObject({ ok: true });
		// payments_settings NOT granted → bank config refused, and the refusal
		// NAMES the area rather than arriving as a bare "Forbidden" (which the
		// client renders as a stack trace — the thing refusalMessage exists to
		// end). The caller is already known to be a member, so naming it leaks
		// nothing.
		await expect(
			asHelper.mutation(api.retailers.updateSettings, {
				retailerId: store._id,
				paymentMethods: [],
			}),
		).rejects.toThrow(/payment details.*Settings → Team/);
		// WhatsApp fields are owner-only whatever the grants (D2) — and say so.
		await expect(
			asHelper.mutation(api.retailers.updateSettings, {
				retailerId: store._id,
				notifyEmail: "helper@example.com",
			}),
		).rejects.toThrow(/Only the store owner/);
		// A mixed save is all-or-nothing: one refused field fails the call.
		await expect(
			asHelper.mutation(api.retailers.updateSettings, {
				retailerId: store._id,
				minFulfilmentNoticeDays: 2,
				waPhone: "60123456789",
			}),
		).rejects.toThrow(/Only the store owner/);
	});

	test("grant edits + removal take effect on the next request", async () => {
		const t = setup();
		const store = await seedStore(t);
		const memberId = await seedActiveMember(t, store._id, { orders: "read" });
		const asOwner = t.withIdentity(OWNER);
		const asHelper = t.withIdentity(HELPER);

		await asOwner.mutation(api.team.updatePermissions, {
			memberId,
			permissions: {},
		});
		await expect(
			asHelper.query(api.orders.countActionable, { retailerId: store._id }),
		).rejects.toThrow(/don't have access to orders/);

		await asOwner.mutation(api.team.updatePermissions, {
			memberId,
			permissions: { orders: "read" },
		});
		await expect(
			asHelper.query(api.orders.countActionable, { retailerId: store._id }),
		).resolves.toBeDefined();

		await asOwner.mutation(api.team.remove, { memberId });
		// A removed person is no longer a teammate, so they get the GENERIC
		// refusal — the copy that names areas is for people still on the team.
		await expect(
			asHelper.query(api.orders.countActionable, { retailerId: store._id }),
		).rejects.toThrow("Forbidden");
		expect(await asHelper.query(api.retailers.getMyRetailer)).toBeNull();
		const state = await asHelper.query(api.team.myMembershipState);
		expect(state.removed).toMatchObject({
			storeName: store.storeName,
			reason: "removed_by_owner",
		});
	});

	test("leave frees the seat and tells the owner's list", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id);
		await t.withIdentity(HELPER).mutation(api.team.leave, {
			retailerId: store._id,
		});
		const list = await t
			.withIdentity(OWNER)
			.query(api.team.list, { retailerId: store._id });
		expect(list.members).toHaveLength(0);
		expect(list.seats.activeCount).toBe(0);
	});

	test("member view of the list masks colleagues' emails; owner sees all", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id);
		await t.withIdentity(OWNER).mutation(api.team.invite, {
			retailerId: store._id,
			email: "second@example.com",
			permissions: {},
		});
		const ownerList = await t
			.withIdentity(OWNER)
			.query(api.team.list, { retailerId: store._id });
		expect(ownerList.members.map((m) => m.email).sort()).toEqual([
			"helper@example.com",
			"second@example.com",
		]);
		const memberList = await t
			.withIdentity(HELPER)
			.query(api.team.list, { retailerId: store._id });
		const self = memberList.members.find((m) => m.isSelf);
		const other = memberList.members.find((m) => !m.isSelf);
		expect(self?.email).toBe(HELPER.email);
		expect(other?.email).toContain("•••");
		expect(other?.permissions).toBeUndefined();
	});
});

describe("create-store while on a team", () => {
	// Leaving a team is its own act — `team.leave` is the ONE exit, so creating
	// a store can never end a membership as a side effect. Delete the guard in
	// retailers.createRetailer and the first half of this goes red.
	test("is refused outright, and naming the way out is the whole message", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id);
		const asHelper = t.withIdentity(HELPER);
		await expect(
			asHelper.mutation(api.retailers.createRetailer, {
				storeName: "Helper Store",
				slug: "helper-store",
			}),
		).rejects.toThrow(/Leave that team first from Settings → Team/i);
		// Refused means refused: no store of their own was half-created, and the
		// seat they sit in is untouched. They still resolve the TEAM store —
		// which is also why /onboarding redirects them and the old
		// confirm-in-the-wizard could never have run.
		const still = await asHelper.query(api.retailers.getMyRetailer);
		expect(still?._id).toBe(store._id);
		expect(still?.role).toBe("member");
		const before = await t
			.withIdentity(OWNER)
			.query(api.team.list, { retailerId: store._id });
		expect(before.seats.activeCount).toBe(1);
	});

	test("leaving first is what unblocks it, and it frees the seat", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id);
		const asHelper = t.withIdentity(HELPER);
		await asHelper.mutation(api.team.leave, { retailerId: store._id });
		await asHelper.mutation(api.retailers.createRetailer, {
			storeName: "Helper Store",
			slug: "helper-store",
		});
		const mine = await asHelper.query(api.retailers.getMyRetailer);
		expect(mine?.role).toBe("owner");
		expect(mine?.slug).toBe("helper-store");
		const list = await t
			.withIdentity(OWNER)
			.query(api.team.list, { retailerId: store._id });
		expect(list.seats.activeCount).toBe(0);
	});

	// A membership the member ENDED is not a removal to explain back to them —
	// they were there when they clicked it — so the wizard they land on stays
	// clean instead of opening with "you no longer have access".
	test("the wizard after leaving carries no removed-from-team banner", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedActiveMember(t, store._id);
		const asHelper = t.withIdentity(HELPER);
		await asHelper.mutation(api.team.leave, { retailerId: store._id });
		const state = await asHelper.query(api.team.myMembershipState, {});
		expect(state.active).toBeNull();
		expect(state.removed).toBeNull();
	});
});

describe("enforceSeatCap", () => {
	test("drops invites first (newest first), then newest members; emails scheduled; idempotent", async () => {
		const t = setup();
		const store = await seedStore(t);
		const now = Date.now();
		await t.run(async (ctx) => {
			const retailer = await ctx.db.get(store._id);
			if (!retailer) throw new Error("no retailer");
			const base = {
				retailerId: store._id,
				permissions: {},
				invitedBy: OWNER.subject,
			};
			// Three active members (joined in order) + one pending invite.
			for (const [i, email] of [
				"m1@example.com",
				"m2@example.com",
				"m3@example.com",
			].entries()) {
				await ctx.db.insert("retailerMembers", {
					...base,
					email,
					status: "active",
					userId: `user_m${i + 1}`,
					invitedAt: now - 1000 + i,
					acceptedAt: now - 500 + i,
				});
			}
			await ctx.db.insert("retailerMembers", {
				...base,
				email: "pending@example.com",
				status: "invited",
				inviteTokenHash: sha256Hex("pending-token"),
				expiresAt: now + 10_000,
				invitedAt: now,
			});
			// Cap 3 total people = 2 member seats; 4 seat-holders → drop 2:
			// the pending invite first, then the NEWEST member (m3).
			const result = await enforceSeatCap(ctx, retailer, 3, now);
			expect(result.cancelledInvites).toBe(1);
			expect(result.removedMembers.map((m) => m.email)).toEqual([
				"m3@example.com",
			]);
		});
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("retailerMembers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", store._id))
				.collect();
			const byEmail = new Map(rows.map((r) => [r.email, r]));
			expect(byEmail.get("pending@example.com")).toBeUndefined();
			expect(byEmail.get("m3@example.com")).toMatchObject({
				status: "removed",
				removedReason: "plan_change",
				removedBy: OWNER.subject,
			});
			expect(byEmail.get("m1@example.com")?.status).toBe("active");
			expect(byEmail.get("m2@example.com")?.status).toBe("active");
			// Idempotent: a second run finds the store within cap.
			const retailer = await ctx.db.get(store._id);
			if (!retailer) throw new Error("no retailer");
			const again = await enforceSeatCap(ctx, retailer, 3, now);
			expect(again).toEqual({ cancelledInvites: 0, removedMembers: [] });
		});
	});
});

describe("admin act-as posture", () => {
	let prev: string | undefined;
	beforeEach(() => {
		prev = process.env.ADMIN_USER_IDS;
		process.env.ADMIN_USER_IDS = ADMIN.subject;
	});
	afterEach(() => {
		process.env.ADMIN_USER_IDS = prev;
	});

	test("admin passes every requirement; role is admin, never member", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asAdmin = t.withIdentity(ADMIN);
		// ownerOnly surface (team management) — admin passes (white-glove).
		const { memberId } = await asAdmin.mutation(api.team.invite, {
			retailerId: store._id,
			email: "va@example.com",
			permissions: { orders: "write" },
		});
		expect(memberId).toBeDefined();
		// Area surface without any grants — admin still passes.
		await expect(
			asAdmin.query(api.orders.countActionable, { retailerId: store._id }),
		).resolves.toBeDefined();
	});
});

describe("invitation email budgets (86exr91r4, PR review)", () => {
	// The seat cap bounds how many invites can be OPEN, not how many can be
	// SENT: `cancelInvite` deletes the row, which frees the seat, the duplicate
	// check and the resend cooldown's anchor at once. Without a budget,
	// invite → cancel → invite mails an arbitrary address from Kedaipal's own
	// sending domain as fast as a script can loop. Delete either
	// `spendInviteBudget` call and one of these goes red.
	test("the invite→cancel→invite loop runs out of credits instead of running forever", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		const target = "target@example.com";
		let sent = 0;
		let refusal: unknown;
		for (let i = 0; i < 12; i++) {
			try {
				const { memberId } = await asOwner.mutation(api.team.invite, {
					retailerId: store._id,
					email: target,
					permissions: {},
				});
				sent++;
				await asOwner.mutation(api.team.cancelInvite, { memberId });
			} catch (err) {
				refusal = err;
				break;
			}
		}
		expect(sent).toBeLessThan(12);
		// And the refusal is a sentence, not the limiter's generic "busy".
		expect(String((refusal as { data?: string })?.data ?? refusal)).toMatch(
			/invitations today|invitations in a short time/i,
		);
	});

	// The 60s cooldown shapes how FAST resends go out; it caps no total, so on
	// its own it still allowed roughly a mail a minute at one address forever.
	test("resend spends the same per-address budget the invite does", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		const { memberId } = await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: "target@example.com",
			permissions: {},
		});
		let resent = 0;
		let refusal: unknown;
		for (let i = 0; i < 10; i++) {
			// Move past the 60s cooldown each round so the ONLY thing that can
			// stop the loop is the budget.
			await t.run(async (ctx) => {
				await ctx.db.patch(memberId, { lastInviteSentAt: 0 });
			});
			try {
				await asOwner.mutation(api.team.resend, { memberId });
				resent++;
			} catch (err) {
				refusal = err;
				break;
			}
		}
		expect(resent).toBeLessThan(10);
		expect(String((refusal as { data?: string })?.data ?? refusal)).toMatch(
			/invitations today|invitations in a short time/i,
		);
	});

	// A refused invite must not cost a real seller a credit — otherwise a
	// fat-fingered duplicate eats the budget for the person they meant to add.
	test("an invite the server refuses spends nothing", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		for (let i = 0; i < 8; i++) {
			await expect(
				asOwner.mutation(api.team.invite, {
					retailerId: store._id,
					email: OWNER.email,
					permissions: {},
				}),
			).rejects.toThrow(/own email/i);
		}
		// Budget untouched: the real invite still goes through.
		const { memberId } = await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: "real@example.com",
			permissions: {},
		});
		expect(memberId).toBeTruthy();
	});
});

describe("accept requires a VERIFIED address", () => {
	// "The token proves the link, the email proves the person" only holds if the
	// address is confirmed. Clerk's email-code sign-in makes that true by
	// configuration today; this makes it true in code, so enabling password
	// sign-up later can't turn "registered the invited address first" into
	// "took the seat". Delete the `emailVerified === false` line and this goes
	// red.
	test("an unverified identity is an email mismatch, on both accept paths", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity(OWNER);
		const { memberId } = await asOwner.mutation(api.team.invite, {
			retailerId: store._id,
			email: HELPER.email,
			permissions: { orders: "write" },
		});
		const unverified = { ...HELPER, emailVerified: false };
		expect(
			await t
				.withIdentity(unverified)
				.mutation(api.team.acceptPendingInvite, { memberId }),
		).toMatchObject({ ok: false, reason: "email_mismatch" });
		// …and the same person, verified, still gets in.
		expect(
			await t
				.withIdentity({ ...HELPER, emailVerified: true })
				.mutation(api.team.acceptPendingInvite, { memberId }),
		).toMatchObject({ ok: true });
	});

	// An ABSENT claim stays permissive on purpose: a JWT template may not carry
	// `email_verified`, and reading "unknown" as "unverified" would lock every
	// accept out on a harmless config change.
	test("an identity with no emailVerified claim is unaffected", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { memberId } = await t.withIdentity(OWNER).mutation(api.team.invite, {
			retailerId: store._id,
			email: HELPER.email,
			permissions: { orders: "write" },
		});
		expect(
			await t
				.withIdentity(HELPER)
				.mutation(api.team.acceptPendingInvite, { memberId }),
		).toMatchObject({ ok: true });
	});
});
