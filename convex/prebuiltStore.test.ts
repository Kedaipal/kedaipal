/// <reference types="vite/client" />
// Pre-built stores handed over later (docs/prebuilt-stores.md).
//
// Every test here is written so that DELETING the guard it covers turns it red
// — the handover moves ownership of a whole store, so each thing standing
// between "an address was typed into a console" and "that login now owns this
// business" gets its own failing case.

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { UNCLAIMED_OWNER_PREFIX } from "./lib/unclaimedStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = { subject: "user_admin", email: "admin@kedaipal.com" };
const VENDOR = {
	subject: "user_vendor",
	email: "vendor@example.com",
	emailVerified: true,
	name: "Mak Cik Kuih",
};
const STRANGER = {
	subject: "user_stranger",
	email: "stranger@example.com",
	emailVerified: true,
};

const DAY_MS = 24 * 60 * 60 * 1000;

let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN.subject;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

/** Build a store as the admin would, optionally naming its handover address. */
async function buildStore(
	t: ReturnType<typeof setup>,
	opts: { email?: string; slug?: string } = {},
) {
	return await t.withIdentity(ADMIN).mutation(api.retailers.createUnclaimedStore, {
		storeName: "Mak Cik Kuih",
		slug: opts.slug ?? "mak-cik-kuih",
		pendingOwnerEmail: opts.email,
	});
}

function readStore(t: ReturnType<typeof setup>, id: Id<"retailers">) {
	return t.run(async (ctx) => ctx.db.get(id));
}

function readSub(t: ReturnType<typeof setup>, id: Id<"retailers">) {
	return t.run(async (ctx) =>
		ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", id))
			.first(),
	);
}

describe("createUnclaimedStore", () => {
	test("only an admin can build a store for someone else", async () => {
		const t = setup();
		await expect(
			t
				.withIdentity(STRANGER)
				.mutation(api.retailers.createUnclaimedStore, {
					storeName: "Not Yours",
					slug: "not-yours",
				}),
		).rejects.toThrow(/Not authorized/);
	});

	test("the store is owned by a PLACEHOLDER no Clerk subject can match", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		const row = await readStore(t, retailerId);
		expect(row?.userId.startsWith(UNCLAIMED_OWNER_PREFIX)).toBe(true);
		// A Clerk subject is `user_…`; the two namespaces must not overlap, or
		// the owner branch of requireRetailerAccess could match a real person.
		expect(row?.userId.startsWith("user_")).toBe(false);
	});

	test("two pre-built stores get DIFFERENT placeholders", async () => {
		// `retailers.by_user` is read with `.first()` everywhere — a shared
		// sentinel would make the second store unreachable through that index.
		const t = setup();
		const a = await buildStore(t, { slug: "store-a" });
		const b = await buildStore(t, { slug: "store-b" });
		const rowA = await readStore(t, a.retailerId);
		const rowB = await readStore(t, b.retailerId);
		expect(rowA?.userId).not.toBe(rowB?.userId);
	});

	test("NO consent is stamped — the vendor hasn't agreed to anything yet", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		const row = await readStore(t, retailerId);
		expect(row?.termsAcceptedAt).toBeUndefined();
		expect(row?.privacyAcceptedAt).toBeUndefined();
		expect(row?.aupAcceptedAt).toBeUndefined();
	});

	test("no notifyEmail is set — a store in setup must not mail a founder inbox", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		const row = await readStore(t, retailerId);
		expect(row?.notifyEmail).toBeUndefined();
		expect(row?.pendingOwnerEmail).toBe(VENDOR.email);
	});

	test("it runs on an `internal` comp, so nothing bills or locks while we build", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		const sub = await readSub(t, retailerId);
		expect(sub?.comped).toBe(true);
		expect(sub?.comp?.kind).toBe("internal");
		// The point of the comp: no trial clock is running, so the days spent
		// setting the store up cannot be spent out of the vendor's free period.
		expect(sub?.trialEndsAt).toBeUndefined();
		expect(sub?.status).toBe("active");
	});

	test("the directory counts NO seats on it — there is no owner to count", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		const before = await t
			.withIdentity(ADMIN)
			.query(api.admin.listSellersForAdmin, {});
		expect(before.find((r) => r._id === retailerId)).toMatchObject({
			unclaimed: true,
			pendingOwnerEmail: VENDOR.email,
			seats: { active: 0 },
		});
		// And the owner reappears in the count the moment it is claimed.
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const after = await t
			.withIdentity(ADMIN)
			.query(api.admin.listSellersForAdmin, {});
		expect(after.find((r) => r._id === retailerId)).toMatchObject({
			unclaimed: false,
			seats: { active: 1 },
		});
	});

	test("a slug another store holds is refused", async () => {
		const t = setup();
		await buildStore(t, { slug: "taken" });
		await expect(buildStore(t, { slug: "taken" })).rejects.toThrow(/taken/i);
	});

	test("the slug hint an admin sees AGREES with what the create does", async () => {
		// The 2 Oct hands-on blocker: `checkSlugAvailability` exempted the
		// CALLER's own slug (right for a rename, wrong for a birth), so an admin
		// building a store saw "✓ Available" for their own store's slug and the
		// server then refused. Flip the query's `purpose` branch back and the
		// two stop agreeing.
		const t = setup();
		// The admin owns a store of their own, as they do in real life.
		await t.withIdentity(ADMIN).mutation(api.retailers.createRetailer, {
			storeName: "Admin's Own Shop",
			slug: "admin-own",
		});
		const hint = await t
			.withIdentity(ADMIN)
			.query(api.retailers.checkSlugAvailability, {
				slug: "admin-own",
				purpose: "create",
			});
		expect(hint).toEqual({ status: "taken" });
		await expect(buildStore(t, { slug: "admin-own" })).rejects.toThrow(
			/taken/i,
		);
	});

	test("a store builds with NO handover email — 'we don't know yet' is a state", async () => {
		// The headline of the 7 Oct change: a batch pre-built ahead of a vendor
		// list has no addresses yet BY DEFINITION. The store is unclaimed and
		// nameless, and the directory shows it as such rather than refusing the
		// build.
		const t = setup();
		const { retailerId } = await buildStore(t);
		const store = await readStore(t, retailerId);
		expect(store?.pendingOwnerEmail).toBeUndefined();
		expect(store?.userId.startsWith(UNCLAIMED_OWNER_PREFIX)).toBe(true);
		// Nobody can take it until an address is named — covered by "a store with
		// NO handover email cannot be claimed by anyone" in the claim suite below.
	});

	test("the email hint an admin sees AGREES with what the create does", async () => {
		// The sibling of the slug-hint blocker above, and the same class of bug:
		// `checkEmailHasStore` used to check `notifyEmail` ALONE, which an
		// unclaimed store never has — so a second build form typed with the same
		// address showed no warning, the button stayed enabled, and the create
		// threw. Both now ask `findEmailConflict`; delete its pending branch and
		// both halves of this go red.
		const t = setup();
		await buildStore(t, { slug: "first", email: VENDOR.email });
		const hint = await t
			.withIdentity(ADMIN)
			.query(api.retailers.checkEmailHasStore, { email: VENDOR.email });
		expect(hint?.kind).toBe("waiting");
		const err = await buildStore(t, {
			slug: "second",
			email: VENDOR.email,
		}).catch((e: Error) => e.message);
		// Not merely "both refuse" — the SAME WORDS, so neither side can be
		// re-worded without the other following.
		expect(err).toBe(hint?.message);
	});

	test("an address another pre-built store is already waiting for is refused", async () => {
		// Two stores pointed at one inbox would both answer myClaimableStore and
		// the vendor would get whichever the index returned first.
		const t = setup();
		await buildStore(t, { slug: "first", email: VENDOR.email });
		await expect(
			buildStore(t, { slug: "second", email: VENDOR.email }),
		).rejects.toThrow(/already waiting/i);
	});

	test("an address that already OWNS a store is refused at build time", async () => {
		const t = setup();
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.createRetailer, {
				storeName: "Their Own Shop",
				slug: "their-own-shop",
			});
		// The claim would refuse this (one store per login), so refusing here is
		// what stops an admin building a store that can never be handed over.
		await expect(
			buildStore(t, { slug: "doomed", email: VENDOR.email }),
		).rejects.toThrow(/one store/i);
	});

	test("that refusal says what it CHECKED, not that the address owns a store", async () => {
		// We match on `notifyEmail`, which is explicitly re-pointable at a shared
		// ops inbox (schema), so it can name a different person than the one who
		// signs in. Asserting "X already runs Y" on that proxy would be a flat
		// refusal on a signal we cannot stand behind, with no way out — so the
		// message states the match it made and how to clear it.
		const t = setup();
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.createRetailer, {
				storeName: "Their Own Shop",
				slug: "their-own-shop",
			});
		const err = await buildStore(t, {
			slug: "doomed",
			email: VENDOR.email,
		}).catch((e: Error) => e.message);
		expect(err).toMatch(/uses .* as its contact email/i);
		expect(err).toMatch(/notification email/i); // the way out
		expect(err).not.toMatch(/already runs/i); // the claim we cannot make
	});
});

describe("setPendingOwnerEmail", () => {
	test("an admin can name, change and clear the handover address", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		const asAdmin = t.withIdentity(ADMIN);
		await asAdmin.mutation(api.retailers.setPendingOwnerEmail, {
			retailerId,
			email: "first@example.com",
		});
		expect((await readStore(t, retailerId))?.pendingOwnerEmail).toBe(
			"first@example.com",
		);
		await asAdmin.mutation(api.retailers.setPendingOwnerEmail, {
			retailerId,
			email: "SECOND@Example.com",
		});
		// Normalized, so it compares equal to a Clerk identity email.
		expect((await readStore(t, retailerId))?.pendingOwnerEmail).toBe(
			"second@example.com",
		);
		await asAdmin.mutation(api.retailers.setPendingOwnerEmail, { retailerId });
		expect((await readStore(t, retailerId))?.pendingOwnerEmail).toBeUndefined();
	});

	test("a CLAIMED store refuses it — this is not a store-takeover primitive", async () => {
		// THE guard. Without it, an admin could re-point a live seller's owner
		// email and hand their business to anyone who signs up with it.
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		await expect(
			t.withIdentity(ADMIN).mutation(api.retailers.setPendingOwnerEmail, {
				retailerId,
				email: STRANGER.email,
			}),
		).rejects.toThrow(/already has an owner/i);
	});

	test("a non-admin cannot touch it", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		await expect(
			t.withIdentity(STRANGER).mutation(api.retailers.setPendingOwnerEmail, {
				retailerId,
				email: STRANGER.email,
			}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("claimStore", () => {
	test("the named vendor takes ownership, and the handover email is retired", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		const result = await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({ ok: true, slug: "mak-cik-kuih" });
		const row = await readStore(t, retailerId);
		expect(row?.userId).toBe(VENDOR.subject);
		// "Remove the previously used email" in full: the target is cleared and
		// their address becomes the store's operational contact.
		expect(row?.pendingOwnerEmail).toBeUndefined();
		expect(row?.notifyEmail).toBe(VENDOR.email);
		expect(row?.claimedAt).toBeGreaterThan(0);
	});

	test("the store then resolves as theirs through the ordinary owner path", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const mine = await t
			.withIdentity(VENDOR)
			.query(api.retailers.getMyRetailer, {});
		expect(mine?.storeName).toBe("Mak Cik Kuih");
		expect(mine?.role).toBe("owner");
		// The payload flag the act-as banner reads must stop being set.
		expect(mine?.unclaimed).toBeUndefined();
	});

	test("consent is stamped AT THE CLAIM — the admin could not agree for them", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const row = await readStore(t, retailerId);
		expect(row?.termsAcceptedAt).toBeGreaterThan(0);
		expect(row?.termsVersion).toBeTruthy();
		expect(row?.privacyAcceptedAt).toBeGreaterThan(0);
		expect(row?.aupAcceptedAt).toBeGreaterThan(0);
	});

	test("an unticked agreement refuses the claim", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		await expect(
			t
				.withIdentity(VENDOR)
				.mutation(api.retailers.claimStore, { acceptedLegal: false }),
		).rejects.toThrow(/Accept the Terms/i);
	});

	test("the 14-day free period starts AT THE CLAIM, not when we built it", async () => {
		// The bug this prevents: a store built on the 1st and handed over on the
		// 20th would arrive with its trial already spent, so the vendor's first
		// ever sign-in would be a past-due lockout.
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		const builtAt = (await readStore(t, retailerId))?._creationTime ?? 0;
		await t.run(async (ctx) => {
			// Age the store by three weeks — longer than the whole trial.
			await ctx.db.patch(retailerId, { createdAt: builtAt - 21 * DAY_MS });
		});
		const claimedAt = Date.now();
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const sub = await readSub(t, retailerId);
		expect(sub?.status).toBe("trialing");
		expect(sub?.comped).toBe(false);
		expect(sub?.comp).toBeUndefined();
		const daysLeft = ((sub?.trialEndsAt ?? 0) - claimedAt) / DAY_MS;
		expect(daysLeft).toBeGreaterThan(13);
		expect(daysLeft).toBeLessThan(15);
	});

	test("ending the setup comp must NOT land the store on past_due", async () => {
		// `endComp` (the ordinary revoke) lands on past_due with no invoice — an
		// expired seller. Routing the claim through it would lock the vendor out
		// on their first sign-in, so the claim has its own transition.
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const sub = await readSub(t, retailerId);
		expect(sub?.status).not.toBe("past_due");
		expect(sub?.compEndedAt).toBeUndefined();
	});

	test("a REAL comp (a partner deal) survives the handover", async () => {
		// Only the `internal` setup comp is scaffolding. A partner/sponsor comp
		// is a commercial promise to the vendor and the handover must not
		// silently cancel it.
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t.withIdentity(ADMIN).mutation(api.subscriptions.setComp, {
			retailerId,
			kind: "partner",
			label: "Sponsored by Maybank SME",
		});
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const sub = await readSub(t, retailerId);
		expect(sub?.comped).toBe(true);
		expect(sub?.comp?.kind).toBe("partner");
	});

	test("an UNVERIFIED email cannot claim, however exactly it matches", async () => {
		// Anyone can type any address into a sign-up form. Verification is the
		// whole proof of inbox control — delete the emailVerified check in
		// convex/lib/identity.ts and this test FAILS, because the unverified
		// caller walks off with the store.
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		const result = await t
			.withIdentity({ ...VENDOR, emailVerified: false })
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({ ok: false, reason: "unverified_email" });
	});

	test("a different address claims nothing", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		const result = await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({ ok: false, reason: "none" });
	});

	test("a store with NO handover email cannot be claimed by anyone", async () => {
		const t = setup();
		await buildStore(t);
		for (const who of [VENDOR, STRANGER]) {
			const result = await t
				.withIdentity(who)
				.mutation(api.retailers.claimStore, { acceptedLegal: true });
			expect(result).toMatchObject({ ok: false, reason: "none" });
		}
	});

	test("it can only be claimed ONCE", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const again = await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(again).toMatchObject({ ok: false, reason: "none" });
	});

	test("a CLAIMED store with a stale pending email cannot be claimed again", async () => {
		// The second line of defence, and the only test that reaches it: the
		// index only says an address is pending, not that the store is still
		// ownerless. Clearing `pendingOwnerEmail` at claim normally keeps this
		// unreachable — so if that clear ever regresses, or a row is patched by
		// hand, THIS is what stops a live store being handed to a second person.
		// Delete the `isUnclaimed` re-check in `claimStore` and this test FAILS,
		// because the stranger's claim succeeds.
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		await t.run(async (ctx) => {
			// Re-arm the target on a store that now has a real owner.
			await ctx.db.patch(retailerId, { pendingOwnerEmail: STRANGER.email });
		});
		const result = await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({ ok: false, reason: "none" });
		// And the real owner still owns it.
		expect((await readStore(t, retailerId))?.userId).toBe(VENDOR.subject);
	});

	test("a caller who already owns a store is refused, and told which", async () => {
		const t = setup();
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.createRetailer, {
				storeName: "Their Own Shop",
				slug: "their-own-shop",
			});
		// Built before they had a store (so the create-time check passed), then
		// they went and made one — exactly the race the claim has to catch.
		const { retailerId } = await buildStore(t, { slug: "built-later" });
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { pendingOwnerEmail: VENDOR.email });
		});
		const result = await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({
			ok: false,
			reason: "own_store",
			storeName: "Their Own Shop",
		});
	});

	test("a caller on another store's team is refused, and told which", async () => {
		const t = setup();
		const ownerIdentity = { subject: "user_other_owner", email: "o@x.com" };
		await t
			.withIdentity(ownerIdentity)
			.mutation(api.retailers.createRetailer, {
				storeName: "Host Store",
				slug: "host-store",
			});
		const host = await t
			.withIdentity(ownerIdentity)
			.query(api.retailers.getMyRetailer, {});
		if (!host) throw new Error("seed failed");
		const { memberId } = await t
			.withIdentity(ownerIdentity)
			.mutation(api.team.invite, {
				retailerId: host._id,
				email: VENDOR.email,
				permissions: { orders: "write" },
			});
		await t
			.withIdentity(VENDOR)
			.mutation(api.team.acceptPendingInvite, { memberId });
		await buildStore(t, { slug: "waiting", email: VENDOR.email });
		const result = await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(result).toMatchObject({
			ok: false,
			reason: "other_membership",
			storeName: "Host Store",
		});
	});
});

describe("myClaimableStore", () => {
	test("names the store waiting for this verified address", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		const state = await t
			.withIdentity(VENDOR)
			.query(api.retailers.myClaimableStore, {});
		expect(state).toMatchObject({
			state: "claimable",
			storeName: "Mak Cik Kuih",
			slug: "mak-cik-kuih",
		});
	});

	test("answers `none` to everyone else", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		for (const who of [STRANGER, { ...VENDOR, emailVerified: false }]) {
			expect(
				await t.withIdentity(who).query(api.retailers.myClaimableStore, {}),
			).toEqual({ state: "none" });
		}
	});

	test("says BLOCKED (not `none`) when a store waits but the login can't hold it", async () => {
		// Answering `none` here would render the bare wizard and leave the vendor
		// with no hint that the store we built them exists.
		const t = setup();
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.createRetailer, {
				storeName: "Their Own Shop",
				slug: "their-own-shop",
			});
		const { retailerId } = await buildStore(t, { slug: "built-later" });
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { pendingOwnerEmail: VENDOR.email });
		});
		const state = await t
			.withIdentity(VENDOR)
			.query(api.retailers.myClaimableStore, {});
		expect(state).toMatchObject({
			state: "blocked",
			storeName: "Mak Cik Kuih",
			refusal: { reason: "own_store", storeName: "Their Own Shop" },
		});
	});

	test("an UNAUTHENTICATED read answers `anonymous`, never `none`", async () => {
		// Convex answers the instant a query arrives — before the Clerk token
		// attaches — so an anonymous answer is "ask again in a tick", not a
		// verdict. Collapsing it into `none` flashed the "Name your store"
		// wizard at a vendor whose store was already built (Zaki, 2 Oct).
		// Return `none` here and the client has no way to tell the two apart.
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		expect(await t.query(api.retailers.myClaimableStore, {})).toEqual({
			state: "anonymous",
		});
		// A signed-in caller with nothing waiting still gets a real verdict.
		expect(
			await t.withIdentity(STRANGER).query(api.retailers.myClaimableStore, {}),
		).toEqual({ state: "none" });
	});

	test("goes quiet once the store is claimed", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(
			await t.withIdentity(VENDOR).query(api.retailers.myClaimableStore, {}),
		).toEqual({ state: "none" });
	});
});

describe("an unclaimed store is reachable but never advertised", () => {
	test("the storefront resolves by direct link, so an admin can show the vendor", async () => {
		const t = setup();
		await buildStore(t, { email: VENDOR.email });
		const result = await t.query(api.retailers.getRetailerBySlug, {
			slug: "mak-cik-kuih",
		});
		expect(result.status).toBe("ok");
	});

	test("but it is kept out of the sitemap", async () => {
		const t = setup();
		await buildStore(t, { slug: "unclaimed-shop" });
		await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.createRetailer, {
				storeName: "Real Shop",
				slug: "real-shop",
			});
		const slugs = (
			await t.query(api.retailers.listSlugsForSitemap, {})
		).map((s) => s.slug);
		expect(slugs).toContain("real-shop");
		expect(slugs).not.toContain("unclaimed-shop");
	});

	test("and it joins the sitemap once claimed", async () => {
		const t = setup();
		await buildStore(t, { slug: "unclaimed-shop", email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const slugs = (
			await t.query(api.retailers.listSlugsForSitemap, {})
		).map((s) => s.slug);
		expect(slugs).toContain("unclaimed-shop");
	});

	test("an admin can operate it through act-as with no owner in existence", async () => {
		// The whole reason this feature is small: the admin branch of
		// requireRetailerAccess never looked at who the owner was.
		const t = setup();
		const { retailerId } = await buildStore(t);
		const seen = await t
			.withIdentity(ADMIN)
			.query(api.retailers.getRetailerForAdmin, { retailerId });
		expect(seen).toMatchObject({
			storeName: "Mak Cik Kuih",
			actingAsAdmin: true,
			unclaimed: true,
		});
	});

	test("a stranger still cannot operate it", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		await expect(
			t.withIdentity(STRANGER).mutation(api.retailers.updateSettings, {
				retailerId,
				storeName: "Hijacked",
			}),
		).rejects.toThrow(/Forbidden|Not authorized/);
	});
});

describe("transferStoreOwnership", () => {
	/** A claimed store, owned by VENDOR, ready to be handed to someone else. */
	async function claimedStore(t: ReturnType<typeof setup>) {
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		return retailerId;
	}

	test("releases the store back to unclaimed, pointed at the new address", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		const before = await readStore(t, retailerId);
		expect(before?.userId).toBe(VENDOR.subject);
		expect(before?.notifyEmail).toBe(VENDOR.email);

		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		const after = await readStore(t, retailerId);
		expect(after?.userId.startsWith(UNCLAIMED_OWNER_PREFIX)).toBe(true);
		expect(after?.pendingOwnerEmail).toBe(STRANGER.email);
		expect(after?.claimedAt).toBeUndefined();
		// Cleared deliberately: a store in handover must not keep mailing the old
		// owner, and the new one has consented to nothing yet.
		expect(after?.notifyEmail).toBeUndefined();
	});

	test("the previous owner is locked out, and the new one can claim it", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		// The old owner's dashboard no longer resolves to this store.
		expect(
			await t.withIdentity(VENDOR).query(api.retailers.getMyRetailer, {}),
		).toBeNull();

		const claimed = await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(claimed.ok).toBe(true);
		const after = await readStore(t, retailerId);
		expect(after?.userId).toBe(STRANGER.subject);
		expect(after?.notifyEmail).toBe(STRANGER.email);
	});

	test("a store nobody owns yet is refused — that is the handover email's job", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		await expect(
			t.withIdentity(ADMIN).mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			}),
		).rejects.toThrow(/no owner yet/i);
	});

	test("only an admin can transfer", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		await expect(
			t.withIdentity(VENDOR).mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			}),
		).rejects.toThrow();
	});

	test("refuses an address already on this store's team — the claim would dead-end", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("retailerMembers", {
				retailerId,
				email: STRANGER.email,
				userId: STRANGER.subject,
				status: "active",
				permissions: { orders: "read" },
				invitedAt: Date.now(),
				invitedBy: VENDOR.subject,
			});
		});
		await expect(
			t.withIdentity(ADMIN).mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			}),
		).rejects.toThrow(/already on .* team/i);
	});

	test("the previous owner's saved card is detached — nothing can charge them for a store they lost", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		const sub = await readSub(t, retailerId);
		await t.run(async (ctx) => {
			if (!sub) throw new Error("sub");
			await ctx.db.patch(sub._id, {
				status: "active",
				autoRenewSessionId: "rec-session-1",
				autoRenew: {
					provider: "hitpay" as const,
					method: "card",
					attachedAt: Date.now(),
				},
			});
		});

		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		// The card is attached to the SUBSCRIPTION, which is store-scoped — so
		// without the detach it would follow the store and charge the person who
		// no longer owns it. Every charge is merchant-initiated, so clearing
		// `autoRenew` is what makes that structurally impossible.
		const after = await readSub(t, retailerId);
		expect(after?.autoRenew).toBeUndefined();
		expect(after?.autoRenewSessionId).toBeUndefined();
	});

	test("refuses an address that already runs another store — one login, one store", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		// A second, unrelated store already mailing that address.
		const other = await buildStore(t, { slug: "other-shop" });
		await t.run(async (ctx) => {
			await ctx.db.patch(other.retailerId, {
				userId: "user_other_owner",
				notifyEmail: "taken@example.com",
			});
		});
		await expect(
			t.withIdentity(ADMIN).mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: "taken@example.com",
			}),
		).rejects.toThrow(/already uses taken@example.com/i);
	});

	test("a PAID subscription survives the handover — the new owner inherits the period, not a free trial", async () => {
		const t = setup();
		const retailerId = await claimedStore(t);
		const periodEnd = Date.now() + 20 * DAY_MS;
		const sub = await readSub(t, retailerId);
		await t.run(async (ctx) => {
			if (!sub) throw new Error("sub");
			await ctx.db.patch(sub._id, {
				status: "active",
				plan: "pro",
				trialEndsAt: undefined,
				currentPeriodEnd: periodEnd,
			});
		});

		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});
		await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });

		const after = await readSub(t, retailerId);
		// Without the `status === "active"` guard in startFreePeriodOnClaim, the
		// claim resets this to `trialing` and wipes the period that was paid for.
		expect(after?.status).toBe("active");
		expect(after?.currentPeriodEnd).toBe(periodEnd);
	});
});

describe("sendHandoverInvite", () => {
	/** The send is real now (action, not fire-and-forget), so the Resend call is
	 * stubbed the way convex/lib/email.ts documents — credentials are read at
	 * call time and the transport is `globalThis.fetch`. */
	let sent: Array<{ to: string[]; subject: string }>;
	let restoreFetch: (() => void) | undefined;
	beforeEach(() => {
		process.env.RESEND_API_KEY = "test-resend";
		process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
		process.env.SITE_URL = "https://kedaipal.test";
		sent = [];
		const original = globalThis.fetch;
		restoreFetch = () => {
			globalThis.fetch = original;
		};
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			sent.push(JSON.parse(String(init?.body ?? "{}")));
			return { ok: true, status: 200, text: async () => "" } as Response;
		}) as unknown as typeof fetch;
	});
	afterEach(() => {
		restoreFetch?.();
	});

	test("sends the email, then stamps", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		const before = await readStore(t, retailerId);
		expect(before?.handoverInviteSentAt).toBeUndefined();

		const res = await t
			.withIdentity(ADMIN)
			.action(api.retailers.sendHandoverInvite, { retailerId });
		expect(res.email).toBe(VENDOR.email);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toEqual([VENDOR.email]);
		expect(sent[0]?.subject).toContain("Mak Cik Kuih");

		const after = await readStore(t, retailerId);
		expect(typeof after?.handoverInviteSentAt).toBe("number");
	});

	test("a provider failure reaches the admin AND leaves no stamp", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		globalThis.fetch = (async () =>
			({
				ok: false,
				status: 403,
				text: async () => "domain not verified",
			}) as Response) as unknown as typeof fetch;

		await expect(
			t
				.withIdentity(ADMIN)
				.action(api.retailers.sendHandoverInvite, { retailerId }),
		).rejects.toThrow(/domain not verified/i);

		// The bug this replaced: the first cut scheduled the send, swallowed the
		// error and stamped anyway, so the console read "sent" while nothing
		// arrived. A stamp now means the provider accepted it.
		const after = await readStore(t, retailerId);
		expect(after?.handoverInviteSentAt).toBeUndefined();
	});

	test("refuses when no address has been named — there is nothing to send to", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t);
		await expect(
			t
				.withIdentity(ADMIN)
				.action(api.retailers.sendHandoverInvite, { retailerId }),
		).rejects.toThrow(/Set the handover email/i);
	});

	test("refuses on a store that already has an owner", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		await expect(
			t
				.withIdentity(ADMIN)
				.action(api.retailers.sendHandoverInvite, { retailerId }),
		).rejects.toThrow(/already has an owner/i);
	});

	test("only an admin can invite", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await expect(
			t
				.withIdentity(VENDOR)
				.action(api.retailers.sendHandoverInvite, { retailerId }),
		).rejects.toThrow();
	});

	test("a transferred store can be invited through the same door", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});
		// Pre-built and transferred are the SAME state by the time this runs, so
		// one invite door serves both rather than two that drift apart.
		const res = await t
			.withIdentity(ADMIN)
			.action(api.retailers.sendHandoverInvite, { retailerId });
		expect(res.email).toBe(STRANGER.email);
	});
});

describe("the invite stamp always describes the CURRENT pending address", () => {
	/** Invite, then change who the store is waiting for. The stamp must not
	 * survive the address it was sent to — the Manage row gates the amber
	 * "invite them" nudge on it, so a surviving stamp tells the admin a person
	 * who was never emailed is "waiting to sign up". */
	async function invited(t: ReturnType<typeof setup>) {
		process.env.RESEND_API_KEY = "test-resend";
		process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
		globalThis.fetch = (async () =>
			({ ok: true, status: 200, text: async () => "" }) as Response) as unknown as typeof fetch;
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(ADMIN)
			.action(api.retailers.sendHandoverInvite, { retailerId });
		expect((await readStore(t, retailerId))?.handoverInviteSentAt).toBeDefined();
		return retailerId;
	}

	test("correcting a typo'd handover address takes the nudge back", async () => {
		const t = setup();
		const retailerId = await invited(t);
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.setPendingOwnerEmail, {
				retailerId,
				email: STRANGER.email,
			});
		expect(
			(await readStore(t, retailerId))?.handoverInviteSentAt,
		).toBeUndefined();
	});

	test("re-saving the SAME address is not a re-invite", async () => {
		const t = setup();
		const retailerId = await invited(t);
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.setPendingOwnerEmail, {
				retailerId,
				email: VENDOR.email,
			});
		expect((await readStore(t, retailerId))?.handoverInviteSentAt).toBeDefined();
	});

	test("a claim clears it, so a later transfer starts un-invited", async () => {
		const t = setup();
		const retailerId = await invited(t);
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		expect(
			(await readStore(t, retailerId))?.handoverInviteSentAt,
		).toBeUndefined();

		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});
		expect(
			(await readStore(t, retailerId))?.handoverInviteSentAt,
		).toBeUndefined();
	});
});

describe("a store nobody owns has no billing clock", () => {
	test("the manual invoice path refuses it", async () => {
		const t = setup();
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		// Claimed and NOT comped — the state `transferStoreOwnership` creates,
		// which the comped refusal alone would have let through.
		const sub = await readSub(t, retailerId);
		await t.run(async (ctx) => {
			if (!sub) throw new Error("sub");
			await ctx.db.patch(sub._id, { comped: false, comp: undefined, status: "active" });
		});
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		await expect(
			t.withIdentity(ADMIN).mutation(api.invoices.issueInvoice, {
				retailerId,
				plan: "pro",
				billingCycle: "monthly",
				founding: false,
			}),
		).rejects.toThrow(/no owner yet/i);
	});

	/** A claimed, PAYING store whose period ended yesterday with an overdue
	 * invoice still open — the two triggers the daily pass acts on, and the
	 * state a mid-cycle handover has to be safe in. Stops short of the transfer
	 * so each test can watch what the transfer itself does. */
	async function overdueStoreReadyToHandOver(t: ReturnType<typeof setup>) {
		const { retailerId } = await buildStore(t, { email: VENDOR.email });
		await t
			.withIdentity(VENDOR)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const sub = await readSub(t, retailerId);
		await t.run(async (ctx) => {
			if (!sub) throw new Error("sub");
			await ctx.db.patch(sub._id, {
				comped: false,
				comp: undefined,
				status: "active",
				// A period that ended yesterday, plus an overdue invoice: both
				// triggers the pass acts on.
				currentPeriodEnd: Date.now() - DAY_MS,
			});
			await ctx.db.insert("invoices", {
				retailerId,
				subscriptionId: sub._id,
				invoiceNumber: "INV-TEST-0001",
				plan: "pro",
				billingCycle: "monthly",
				amount: 14900,
				total: 14900,
				currency: "MYR",
				status: "pending",
				periodStart: Date.now() - 30 * DAY_MS,
				periodEnd: Date.now() - DAY_MS,
				dueDate: Date.now() - DAY_MS,
				createdAt: Date.now() - 20 * DAY_MS,
			});
		});
		return { retailerId };
	}

	const invoiceOn = (t: ReturnType<typeof setup>, retailerId: Id<"retailers">) =>
		t.run(async (ctx) =>
			ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);

	test("the daily pass issues nothing and never locks it", async () => {
		const t = setup();
		const { retailerId } = await overdueStoreReadyToHandOver(t);
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		await t.mutation(internal.subscriptions.internalDailyBillingStatus, {});

		// Without the unclaimed skip this flips to past_due — handing the new
		// owner a locked shop and a bill neither party was ever emailed.
		const after = await readSub(t, retailerId);
		expect(after?.status).toBe("active");
	});

	test("the open bill is VOIDED by the handover, and says who and why", async () => {
		const t = setup();
		const { retailerId } = await overdueStoreReadyToHandOver(t);
		expect((await invoiceOn(t, retailerId))?.status).toBe("pending");

		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});

		// The row SURVIVES as void — a genuine debt stays on the record to chase
		// off-platform. Hard-deleting it would erase the evidence.
		const invoice = await invoiceOn(t, retailerId);
		expect(invoice?.status).toBe("void");
		expect(invoice?.voidedBy).toBe(ADMIN.subject);
		expect(invoice?.voidReason).toMatch(/ownership transferred/i);
		expect(invoice?.invoiceNumber).toBe("INV-TEST-0001");
	});

	test("so the NEW owner is not locked on day one for the previous owner's month", async () => {
		const t = setup();
		const { retailerId } = await overdueStoreReadyToHandOver(t);
		await t
			.withIdentity(ADMIN)
			.mutation(api.retailers.transferStoreOwnership, {
				retailerId,
				email: STRANGER.email,
			});
		// The step the unclaimed skip alone never reached: the invoice re-arms
		// the moment somebody owns the store again.
		await t
			.withIdentity(STRANGER)
			.mutation(api.retailers.claimStore, { acceptedLegal: true });

		await t.mutation(internal.subscriptions.internalDailyBillingStatus, {});

		// Without the void, `overduePending` flips this to past_due and emails a
		// "pay to resume" demand for a period the new owner never had the store
		// for — the mirror image of the wiped-paid-period bug this feature
		// already guards against.
		const after = await readSub(t, retailerId);
		expect(after?.status).not.toBe("past_due");
		expect((await invoiceOn(t, retailerId))?.status).toBe("void");
	});
});
