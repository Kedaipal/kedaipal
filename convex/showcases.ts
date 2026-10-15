import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { adminUserIds, logGlobalAdminAction, requireAdmin } from "./lib/auth";
import { takesBuyerOrders } from "./lib/storeAvailability";
import type { ClosedDateRange } from "./lib/closedDates";
import type { OpeningHours } from "./lib/openingHours";
import { type Country, countryValidator, DEFAULT_COUNTRY } from "./lib/country";
import {
	assertValidShowcaseWindow,
	DEFAULT_SHOWCASE_THEME,
	isShowcaseLive,
	SHOWCASE_MEMBER_CAP,
	SHOWCASE_SCAN_CAP,
	type ShowcaseState,
	type ShowcaseTheme,
	sanitizeShowcaseColor,
	sanitizeShowcaseLabel,
	sanitizeShowcaseTagline,
	sanitizeShowcaseTitle,
	showcaseSlugFromTitle,
	showcaseState,
	showcaseThemeValidator,
} from "./lib/showcase";
import {
	type NotListedReason,
	notListedReason,
	storeIsInternal,
} from "./marketplace";
import { storeAvailabilityOf } from "./storeAvailability";
import { loadSubscription } from "./subscriptions";

/**
 * Marketplace showcases (z8r3fdr6mv) — see `lib/showcase.ts` for the rules
 * and `docs/marketplace-home.md` for the feature. This module is the
 * database side: the public read the buyer page SSRs, the seller's "you're
 * featured" answer, and the admin's CRUD, every write of which lands in the
 * audit log under its own function name with the showcase as `targetId`.
 */

// ---------------------------------------------------------------------------
// Public payload — what kedaipal.com/stores renders
// ---------------------------------------------------------------------------

export type PublicShowcaseMember = {
	/** Joined on the client to the directory's card payload (name, logo,
	 * hours); a slug the directory doesn't carry is dropped there too. */
	slug: string;
	/** "Booth B4" */
	label?: string;
	/** The store's own cover — the ticket's info-panel background. Resolved
	 * here, not on the card payload, because the directory only renders
	 * covers for sponsored cards and this is the one other surface. */
	coverImageUrl?: string;
};

/**
 * Card fields ONLY, the `MarketplaceStoreCard` posture: no ids, no
 * `publishedAt` (a buyer never needs to know a draft exists — drafts aren't
 * in the payload at all), no member ids.
 */
export type PublicShowcase = {
	slug: string;
	title: string;
	tagline?: string;
	country: Country;
	theme: ShowcaseTheme;
	/** The `custom` look's colour; absent for every other look. */
	customColor?: string;
	coverImageUrl?: string;
	startsAt?: number;
	endsAt?: number;
	members: PublicShowcaseMember[];
};

/**
 * Every LIVE showcase, in admin order, with the members that pass the
 * directory's listable rule. Members are filtered HERE, with the directory's
 * own `notListedReason`, so the public payload never carries a store the
 * directory hides (an admin-hidden store's cover must not ride out on a
 * showcase); the client then joins each slug to its directory card.
 *
 * Bounded: `SHOWCASE_SCAN_CAP` rows, `SHOWCASE_MEMBER_CAP` members each.
 */
export const listShowcases = query({
	args: {},
	handler: async (ctx): Promise<PublicShowcase[]> => {
		const now = Date.now();
		const adminIds = adminUserIds();
		const rows = await ctx.db
			.query("marketplaceShowcases")
			.withIndex("by_sortOrder")
			.order("asc")
			.take(SHOWCASE_SCAN_CAP);
		const out: PublicShowcase[] = [];
		for (const row of rows) {
			if (!isShowcaseLive(row, now)) continue;
			const members: PublicShowcaseMember[] = [];
			for (const member of row.members) {
				const retailer = await ctx.db.get(member.retailerId);
				if (!retailer) continue;
				if ((await notListedReason(ctx, retailer, adminIds)) !== null)
					continue;
				members.push({
					slug: retailer.slug,
					label: member.label,
					coverImageUrl: await storageUrl(ctx, retailer.coverImageStorageId),
				});
			}
			// A showcase whose stores are all unlistable is an empty banner —
			// the buyer never sees one.
			if (members.length === 0) continue;
			out.push({
				slug: row.slug,
				title: row.title,
				tagline: row.tagline,
				country: row.country,
				theme: row.theme,
				...(row.theme === "custom" && row.customColor
					? { customColor: row.customColor }
					: {}),
				coverImageUrl: await storageUrl(ctx, row.coverImageStorageId),
				startsAt: row.startsAt,
				endsAt: row.endsAt,
				members,
			});
		}
		return out;
	},
});

/**
 * A cover's URL, or undefined. Never throws: the ids are `v.string()` (the
 * retailers pattern), and one malformed id must cost one missing photo, not
 * the public read for every buyer on /stores. `update` also refuses a bad id
 * at the door (`normalizeId`).
 */
async function storageUrl(
	ctx: QueryCtx,
	storageId: string | undefined,
): Promise<string | undefined> {
	if (!storageId) return undefined;
	const id = ctx.db.system.normalizeId("_storage", storageId);
	if (id === null) return undefined;
	try {
		return (await ctx.storage.getUrl(id)) ?? undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Seller — "You're featured in …" lives in `lib/showcaseFeatured.ts`, so
// `marketplace.ts` (which serves it) never imports this module back.
// ---------------------------------------------------------------------------

export type { FeaturedIn } from "./lib/showcaseFeatured";

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type AdminShowcaseMember = {
	retailerId: Id<"retailers">;
	slug: string;
	storeName: string;
	logoUrl?: string;
	country: Country;
	label?: string;
	/** The card facts the editor's buyer preview needs to render the REAL
	 * ticket (same component as /stores), so the preview never lies about
	 * a store's hours or cover. */
	storeDescription?: string;
	storeArea?: string;
	coverImageUrl?: string;
	openingHours?: OpeningHours;
	closedDates?: ClosedDateRange[];
	orderingPaused: boolean;
	createdAt: number;
	offersDelivery: boolean;
	/** Why buyers won't see this member, or null when they will. Named on
	 * the editor row — a member is never dropped silently. */
	notListed: NotListedReason | null;
};

export type AdminShowcase = {
	_id: Id<"marketplaceShowcases">;
	slug: string;
	title: string;
	tagline?: string;
	country: Country;
	theme: ShowcaseTheme;
	/** Kept across look switches (the editor restores it), so it can be set
	 * while `theme` is not `custom`. */
	customColor?: string;
	coverImageUrl?: string;
	startsAt?: number;
	endsAt?: number;
	publishedAt?: number;
	sortOrder: number;
	state: ShowcaseState;
	members: AdminShowcaseMember[];
	createdAt: number;
	updatedAt: number;
};

async function toAdminShowcase(
	ctx: QueryCtx,
	row: Doc<"marketplaceShowcases">,
	now: number,
	adminIds: readonly string[],
): Promise<AdminShowcase> {
	const members: AdminShowcaseMember[] = [];
	for (const member of row.members) {
		const retailer = await ctx.db.get(member.retailerId);
		// A deleted store simply leaves the list — nothing to name.
		if (!retailer) continue;
		members.push({
			retailerId: retailer._id,
			slug: retailer.slug,
			storeName: retailer.storeName,
			logoUrl: await storageUrl(ctx, retailer.logoStorageId),
			country: retailer.country ?? DEFAULT_COUNTRY,
			label: member.label,
			storeDescription: retailer.storeDescription,
			storeArea: retailer.storeArea,
			coverImageUrl: await storageUrl(ctx, retailer.coverImageStorageId),
			openingHours: retailer.openingHours,
			closedDates: retailer.closedDates,
			// Any pause (seller, hold, Kedaipal) — the resolver the order doors
			// and the directory card use, never the raw hold stamp.
			orderingPaused: !takesBuyerOrders(
				await storeAvailabilityOf(ctx, retailer),
			),
			createdAt: retailer.createdAt,
			offersDelivery: retailer.offerDelivery !== false,
			notListed: await notListedReason(ctx, retailer, adminIds),
		});
	}
	return {
		_id: row._id,
		slug: row.slug,
		title: row.title,
		tagline: row.tagline,
		country: row.country,
		theme: row.theme,
		customColor: row.customColor,
		coverImageUrl: await storageUrl(ctx, row.coverImageStorageId),
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		publishedAt: row.publishedAt,
		sortOrder: row.sortOrder,
		state: showcaseState(row, now),
		members,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** Every showcase, drafts and ended included, in /stores order. */
export const listForAdmin = query({
	args: {},
	handler: async (ctx): Promise<AdminShowcase[]> => {
		await requireAdmin(ctx);
		const now = Date.now();
		const adminIds = adminUserIds();
		const rows = await ctx.db
			.query("marketplaceShowcases")
			.withIndex("by_sortOrder")
			.order("asc")
			.take(SHOWCASE_SCAN_CAP);
		const out: AdminShowcase[] = [];
		for (const row of rows) out.push(await toAdminShowcase(ctx, row, now, adminIds));
		return out;
	},
});

export const getForAdmin = query({
	args: { showcaseId: v.id("marketplaceShowcases") },
	handler: async (ctx, { showcaseId }): Promise<AdminShowcase | null> => {
		await requireAdmin(ctx);
		const row = await ctx.db.get(showcaseId);
		if (!row) return null;
		return toAdminShowcase(ctx, row, Date.now(), adminUserIds());
	},
});

async function loadShowcase(
	ctx: MutationCtx,
	showcaseId: Id<"marketplaceShowcases">,
): Promise<Doc<"marketplaceShowcases">> {
	const row = await ctx.db.get(showcaseId);
	if (!row) throw new ConvexError("Showcase not found");
	return row;
}

/** Re-throw a rule failure as a `ConvexError` so the client reads the
 * sentence, not "Server Error". */
function guarded<T>(fn: () => T): T {
	try {
		return fn();
	} catch (err) {
		throw new ConvexError(err instanceof Error ? err.message : String(err));
	}
}

/**
 * A slug nobody else holds: the title's slug, then `-2`, `-3`… Campfest
 * 2026 and a second "Campfest 2026" draft can't share a QR handle.
 */
async function uniqueSlug(ctx: MutationCtx, title: string): Promise<string> {
	const base = showcaseSlugFromTitle(title);
	for (let n = 1; n < 100; n++) {
		const candidate = n === 1 ? base : `${base}-${n}`;
		const taken = await ctx.db
			.query("marketplaceShowcases")
			.withIndex("by_slug", (q) => q.eq("slug", candidate))
			.unique();
		if (!taken) return candidate;
	}
	throw new ConvexError("Too many showcases share this title");
}

/**
 * A new showcase is born a DRAFT with no stores: the admin lands in the
 * editor next, and nothing reaches buyers until they publish. The region is
 * fixed at birth because every member must share it (a showcase never blends
 * MY and SG, like the directory itself).
 */
export const create = mutation({
	args: { title: v.string(), country: countryValidator },
	handler: async (ctx, args): Promise<Id<"marketplaceShowcases">> => {
		const adminUserId = await requireAdmin(ctx);
		const title = guarded(() => sanitizeShowcaseTitle(args.title));
		const last = await ctx.db
			.query("marketplaceShowcases")
			.withIndex("by_sortOrder")
			.order("desc")
			.first();
		const now = Date.now();
		const showcaseId = await ctx.db.insert("marketplaceShowcases", {
			slug: await uniqueSlug(ctx, title),
			title,
			country: args.country,
			theme: DEFAULT_SHOWCASE_THEME,
			sortOrder: (last?.sortOrder ?? 0) + 1,
			members: [],
			createdAt: now,
			updatedAt: now,
		});
		await logGlobalAdminAction(ctx, adminUserId, "showcases.create", showcaseId);
		return showcaseId;
	},
});

/**
 * Edit the showcase's own fields. `null` clears an optional field (a date,
 * the tagline, the cover); `undefined` leaves it alone. The slug is NOT
 * editable — see `showcaseSlugFromTitle`. Changing the region with members
 * from the old one is refused by name rather than dropping them: an admin
 * who flips MY→SG with eight Malaysian stores in the list should hear so.
 */
export const update = mutation({
	args: {
		showcaseId: v.id("marketplaceShowcases"),
		title: v.optional(v.string()),
		tagline: v.optional(v.union(v.string(), v.null())),
		country: v.optional(countryValidator),
		theme: v.optional(showcaseThemeValidator),
		customColor: v.optional(v.string()),
		coverImageStorageId: v.optional(v.union(v.string(), v.null())),
		startsAt: v.optional(v.union(v.number(), v.null())),
		endsAt: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, { showcaseId, ...patch }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const row = await loadShowcase(ctx, showcaseId);
		const next: Partial<Doc<"marketplaceShowcases">> = {};
		if (patch.title !== undefined)
			next.title = guarded(() => sanitizeShowcaseTitle(patch.title ?? ""));
		if (patch.tagline !== undefined)
			next.tagline = guarded(() =>
				sanitizeShowcaseTagline(patch.tagline ?? undefined),
			);
		if (patch.theme !== undefined) next.theme = patch.theme;
		if (patch.customColor !== undefined)
			next.customColor = guarded(() =>
				sanitizeShowcaseColor(patch.customColor ?? ""),
			);
		// The custom look IS its colour — without one there is nothing to
		// paint, so the pair is refused rather than silently falling back.
		if (
			(next.theme ?? row.theme) === "custom" &&
			(next.customColor ?? row.customColor) === undefined
		) {
			throw new ConvexError("Pick a colour for the custom look");
		}
		if (patch.startsAt !== undefined) next.startsAt = patch.startsAt ?? undefined;
		if (patch.endsAt !== undefined) next.endsAt = patch.endsAt ?? undefined;
		guarded(() =>
			assertValidShowcaseWindow({
				startsAt: "startsAt" in next ? next.startsAt : row.startsAt,
				endsAt: "endsAt" in next ? next.endsAt : row.endsAt,
			}),
		);
		if (patch.country !== undefined && patch.country !== row.country) {
			if (row.members.length > 0) {
				throw new ConvexError(
					`Remove the ${row.members.length} ${row.members.length === 1 ? "store" : "stores"} first — a showcase's stores must all be in its region`,
				);
			}
			next.country = patch.country;
		}
		if (patch.coverImageStorageId !== undefined) {
			const incoming = patch.coverImageStorageId ?? undefined;
			if (
				incoming !== undefined &&
				(ctx.db.system.normalizeId("_storage", incoming) === null ||
					(await ctx.storage.getUrl(incoming as Id<"_storage">)) === null)
			) {
				throw new ConvexError("That cover upload didn't finish — try again");
			}
			if (row.coverImageStorageId && row.coverImageStorageId !== incoming) {
				try {
					await ctx.storage.delete(row.coverImageStorageId as Id<"_storage">);
				} catch {
					// Already gone — nothing to free.
				}
			}
			next.coverImageStorageId = incoming;
		}
		await ctx.db.patch(showcaseId, { ...next, updatedAt: Date.now() });
		await logGlobalAdminAction(ctx, adminUserId, "showcases.update", showcaseId);
	},
});

/**
 * The whole member list in one write — add, remove, reorder and relabel are
 * one save from the editor, and the list is at most `SHOWCASE_MEMBER_CAP`
 * long, so a full replace is cheaper than a diff and can't half-apply.
 * Every store must exist and sit in the showcase's region; duplicates are
 * collapsed to the first mention. A Kedaipal or test store can't be ADDED —
 * it is never listed on /stores, so it could only ever be a dead row (the
 * picker greys it out with the same reason). One already in the list is left
 * alone, so a save never fails on a row the admin didn't touch.
 */
export const setMembers = mutation({
	args: {
		showcaseId: v.id("marketplaceShowcases"),
		members: v.array(
			v.object({
				retailerId: v.id("retailers"),
				label: v.optional(v.string()),
			}),
		),
	},
	handler: async (ctx, { showcaseId, members }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const row = await loadShowcase(ctx, showcaseId);
		const already = new Set(row.members.map((m) => m.retailerId));
		const adminIds = adminUserIds();
		const seen = new Set<Id<"retailers">>();
		const clean: Doc<"marketplaceShowcases">["members"] = [];
		for (const member of members) {
			if (seen.has(member.retailerId)) continue;
			seen.add(member.retailerId);
			const retailer = await ctx.db.get(member.retailerId);
			if (!retailer) throw new ConvexError("One of the stores no longer exists");
			if ((retailer.country ?? DEFAULT_COUNTRY) !== row.country) {
				throw new ConvexError(
					`${retailer.storeName} is not a ${row.country} store — a showcase's stores must all be in its region`,
				);
			}
			if (
				!already.has(member.retailerId) &&
				storeIsInternal(
					retailer,
					await loadSubscription(ctx, retailer._id),
					adminIds,
				)
			) {
				throw new ConvexError(
					`${retailer.storeName} is a Kedaipal or test store — it never shows on /stores`,
				);
			}
			const label = guarded(() => sanitizeShowcaseLabel(member.label));
			clean.push({
				retailerId: member.retailerId,
				...(label ? { label } : {}),
			});
		}
		if (clean.length > SHOWCASE_MEMBER_CAP) {
			throw new ConvexError(
				`A showcase holds up to ${SHOWCASE_MEMBER_CAP} stores — split a bigger event into two`,
			);
		}
		await ctx.db.patch(showcaseId, { members: clean, updatedAt: Date.now() });
		await logGlobalAdminAction(
			ctx,
			adminUserId,
			"showcases.setMembers",
			showcaseId,
		);
	},
});

/** The admin list's drag-to-reorder: positions follow the array given. Ids
 * left out keep their relative order after the given ones. */
export const reorder = mutation({
	args: { orderedIds: v.array(v.id("marketplaceShowcases")) },
	handler: async (ctx, { orderedIds }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const rows = await ctx.db
			.query("marketplaceShowcases")
			.withIndex("by_sortOrder")
			.order("asc")
			.take(SHOWCASE_SCAN_CAP);
		const given = new Set(orderedIds);
		const ordered = [
			...orderedIds
				.map((id) => rows.find((r) => r._id === id))
				.filter((r): r is Doc<"marketplaceShowcases"> => r !== undefined),
			...rows.filter((r) => !given.has(r._id)),
		];
		const now = Date.now();
		for (const [index, row] of ordered.entries()) {
			if (row.sortOrder !== index + 1)
				await ctx.db.patch(row._id, { sortOrder: index + 1, updatedAt: now });
		}
		await logGlobalAdminAction(ctx, adminUserId, "showcases.reorder");
	},
});

/**
 * Publishing is the only door to buyers. Refused for an empty showcase —
 * `listShowcases` would drop it anyway, but a "Live" badge over a banner no
 * buyer can see is the lie the editor exists to prevent. Idempotent.
 */
export const publish = mutation({
	args: { showcaseId: v.id("marketplaceShowcases") },
	handler: async (ctx, { showcaseId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const row = await loadShowcase(ctx, showcaseId);
		if (row.members.length === 0)
			throw new ConvexError("Add at least one store before publishing");
		if (row.publishedAt !== undefined) return;
		await ctx.db.patch(showcaseId, {
			publishedAt: Date.now(),
			updatedAt: Date.now(),
		});
		await logGlobalAdminAction(ctx, adminUserId, "showcases.publish", showcaseId);
	},
});

/** Off /stores at once; the showcase, its stores and its dates are kept as
 * a draft, so "take it down for an hour" is reversible. Idempotent. */
export const unpublish = mutation({
	args: { showcaseId: v.id("marketplaceShowcases") },
	handler: async (ctx, { showcaseId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const row = await loadShowcase(ctx, showcaseId);
		if (row.publishedAt === undefined) return;
		await ctx.db.patch(showcaseId, {
			publishedAt: undefined,
			updatedAt: Date.now(),
		});
		await logGlobalAdminAction(
			ctx,
			adminUserId,
			"showcases.unpublish",
			showcaseId,
		);
	},
});

/** Gone for good, cover blob included. The stores themselves are untouched —
 * a showcase only ever pointed at them. */
export const remove = mutation({
	args: { showcaseId: v.id("marketplaceShowcases") },
	handler: async (ctx, { showcaseId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const row = await loadShowcase(ctx, showcaseId);
		if (row.coverImageStorageId) {
			try {
				await ctx.storage.delete(row.coverImageStorageId as Id<"_storage">);
			} catch {
				// Already gone — nothing to free.
			}
		}
		await ctx.db.delete(showcaseId);
		await logGlobalAdminAction(ctx, adminUserId, "showcases.remove", showcaseId);
	},
});

/** Admin: a one-shot upload URL for a showcase cover. */
export const generateCoverUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		await requireAdmin(ctx);
		return ctx.storage.generateUploadUrl();
	},
});
