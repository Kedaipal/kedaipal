import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	adminUserIds,
	logAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import { assertValidMapsUrl } from "./lib/mapsUrl";
import { assertValidWaPhone } from "./lib/slug";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";

const LABEL_MAX = 60;
const ADDRESS_MIN = 3;
const ADDRESS_MAX = 500;
const NOTES_MAX = 200;
// Schedule note is a short recurring-availability line ("Every Sat 3-5pm"), not
// a paragraph — keep it tight so it line-clamps cleanly on the storefront +
// tracking page. Mirrors the cap documented on the schema field.
const SCHEDULE_NOTE_MAX = 120;
const MANAGER_NAME_MAX = 60;
// Google Place IDs are typically 27–100 chars; cap generously at 300 to reject
// arbitrarily long strings while leaving headroom for any future Google ID
// format. The cap protects the buyer-supplied surface on orders.create too —
// keep `PLACE_ID_MAX` in lockstep with the delivery-address validator in
// convex/lib/address.ts.
const PLACE_ID_MAX = 300;
// Sanity ceiling on a per-location pickup fee (minor units) — RM10,000. Real
// fees are RM2–RM50 (a paid drop-off host, a meetup run); the cap only guards
// fat-fingered zeros, mirroring the MOCKUP_QUOTE_MAX pattern in orders.ts but
// an order of magnitude tighter since a "pickup fee" should never approach a
// custom-work quote.
export const PICKUP_FEE_MAX = 1_000_000;

// ---------------------------------------------------------------------------
// Auth helpers — mirror the pattern in convex/customers.ts so each module is
// self-contained and a future split of these into a shared lib can be a single
// search-and-replace.
// ---------------------------------------------------------------------------

// Owner-OR-admin access (see convex/lib/auth.ts) so a Kedaipal admin can set up
// a seller's pickup points during white-glove onboarding.
async function requireRetailerOwner(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
): Promise<RetailerAccess> {
	return requireRetailerAccess(ctx, retailerId);
}

async function requireOwnedLocation(
	ctx: QueryCtx | MutationCtx,
	pickupLocationId: Id<"pickupLocations">,
): Promise<{ location: Doc<"pickupLocations">; access: RetailerAccess }> {
	const location = await ctx.db.get(pickupLocationId);
	if (!location) throw new Error("Pickup location not found");
	const access = await requireRetailerAccess(ctx, location.retailerId);
	return { location, access };
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

function sanitizeLabel(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) throw new ConvexError("Label is required");
	if (trimmed.length > LABEL_MAX) {
		throw new ConvexError(`Label must be at most ${LABEL_MAX} characters`);
	}
	return trimmed;
}

function sanitizeAddress(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length < ADDRESS_MIN) {
		throw new ConvexError(
			`Address must be at least ${ADDRESS_MIN} characters`,
		);
	}
	if (trimmed.length > ADDRESS_MAX) {
		throw new ConvexError(`Address must be at most ${ADDRESS_MAX} characters`);
	}
	return trimmed;
}

function sanitizeMapsUrl(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	try {
		return assertValidMapsUrl(trimmed);
	} catch (err) {
		throw new ConvexError((err as Error).message);
	}
}

/**
 * Trim + enforce the {@link PLACE_ID_MAX} cap. Google Place IDs are short
 * (typically 27–100 chars), but this field flows in directly from authenticated
 * retailers via the create/update mutations AND from the public buyer surface
 * on orders.create deliveryAddress — both need the same cap so a malicious
 * client can't write an arbitrarily long string into the DB.
 */
function sanitizePlaceId(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > PLACE_ID_MAX) {
		throw new ConvexError(`Invalid place ID (max ${PLACE_ID_MAX} characters)`);
	}
	return trimmed;
}

function sanitizeNotes(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > NOTES_MAX) {
		throw new ConvexError(`Notes must be at most ${NOTES_MAX} characters`);
	}
	return trimmed;
}

function sanitizeScheduleNote(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > SCHEDULE_NOTE_MAX) {
		throw new ConvexError(
			`Availability note must be at most ${SCHEDULE_NOTE_MAX} characters`,
		);
	}
	return trimmed;
}

function sanitizeManagerName(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > MANAGER_NAME_MAX) {
		throw new ConvexError(
			`Manager name must be at most ${MANAGER_NAME_MAX} characters`,
		);
	}
	return trimmed;
}

/**
 * Validate a pickup fee (minor units). Whole non-negative sen with the
 * {@link PICKUP_FEE_MAX} ceiling. Normalizes 0 → undefined so "free" is stored
 * one way only — no row ever carries `fee: 0`, and every read can treat
 * `fee === undefined` as free without a `> 0` check.
 */
function sanitizeFee(raw: number | undefined): number | undefined {
	if (raw === undefined) return undefined;
	if (!Number.isInteger(raw) || raw < 0) {
		throw new ConvexError("Pickup fee must be a whole, non-negative amount");
	}
	if (raw > PICKUP_FEE_MAX) {
		throw new ConvexError(
			"Pickup fee is unrealistically large — check the amount",
		);
	}
	return raw === 0 ? undefined : raw;
}

function sanitizeManagerWaPhone(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	try {
		return assertValidWaPhone(trimmed);
	} catch (err) {
		throw new ConvexError((err as Error).message);
	}
}

/**
 * Validate a lat/lng pair from the Google action proxy. Both must be present
 * and inside the standard WGS84 ranges; otherwise we drop them (don't half-
 * store coordinates). Returns undefined when either is missing — coordinates
 * are an all-or-nothing field group.
 */
function sanitizeCoords(
	latitude: number | undefined,
	longitude: number | undefined,
): { latitude: number; longitude: number } | undefined {
	if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
	if (latitude < -90 || latitude > 90) {
		throw new ConvexError("latitude must be between -90 and 90");
	}
	if (longitude < -180 || longitude > 180) {
		throw new ConvexError("longitude must be between -180 and 180");
	}
	return { latitude, longitude };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Retailer-scoped list of every pickup location (active + inactive), ordered by
 * `sortOrder` ascending. The settings tab uses this for the management view —
 * inactive rows are kept so soft-deletes can be reversed.
 */
export const listForRetailer = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<Doc<"pickupLocations">[]> => {
		await requireRetailerOwner(ctx, retailerId);
		const rows = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		return rows.sort((a, b) => a.sortOrder - b.sortOrder);
	},
});

/**
 * Public, unauthed list of active pickup locations for a storefront slug.
 * Returns only public-safe fields so the storefront picker doesn't leak
 * internal flags. Inactive rows are excluded.
 */
export const listActivePublicBySlug = query({
	args: { slug: v.string() },
	handler: async (
		ctx,
		{ slug },
	): Promise<
		Array<{
			_id: Id<"pickupLocations">;
			label: string;
			address: string;
			locationType: "self_collect" | "drop_off";
			scheduleNote?: string;
			mapsUrl?: string;
			notes?: string;
			latitude?: number;
			longitude?: number;
			placeId?: string;
			/** Flat fee (minor units) added to the order total when the buyer
			 * picks this point. Undefined = free. Public by design — the buyer
			 * must see the charge in the picker before choosing. */
			fee?: number;
			sortOrder: number;
		}>
	> => {
		const normalized = slug.trim().toLowerCase();
		if (normalized.length === 0) return [];
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", normalized))
			.first();
		if (!retailer) return [];

		const rows = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailer._id).eq("isActive", true),
			)
			.collect();
		return rows
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((r) => ({
				_id: r._id,
				label: r.label,
				address: r.address,
				// Legacy rows (created before drop-off) read as self-collect so
				// the storefront never groups them under a blank/wrong heading.
				locationType: r.locationType ?? "self_collect",
				scheduleNote: r.scheduleNote,
				mapsUrl: r.mapsUrl,
				notes: r.notes,
				latitude: r.latitude,
				longitude: r.longitude,
				placeId: r.placeId,
				fee: r.fee,
				sortOrder: r.sortOrder,
			}));
	},
});

/**
 * Fetch a single pickup location by id, scoped to the calling retailer. Used
 * by the seller order detail page to read the LIVE manager contact (not the
 * frozen snapshot) — manager info should always reflect the current setting
 * so swapping a manager next week reroutes today's pending orders too.
 *
 * Returns null when the id doesn't exist or doesn't belong to the caller, so
 * callers don't have to distinguish "404" from "forbidden" — both are "we
 * can't show you this row, fall back to the snapshot-only path."
 */
export const getOwnedById = query({
	args: { pickupLocationId: v.id("pickupLocations") },
	handler: async (
		ctx,
		{ pickupLocationId },
	): Promise<Doc<"pickupLocations"> | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const location = await ctx.db.get(pickupLocationId);
		if (!location) return null;
		const retailer = await ctx.db.get(location.retailerId);
		// Owner OR a Kedaipal admin operating this store (act-as).
		if (
			!retailer ||
			(retailer.userId !== identity.subject &&
				!adminUserIds().includes(identity.subject))
		)
			return null;
		return location;
	},
});

/**
 * Lightweight existence check used by the dashboard setup checklist. Returns
 * `{ hasAny }` so we never paginate just to read a boolean.
 */
export const hasAnyActive = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ hasAny: boolean }> => {
		await requireRetailerOwner(ctx, retailerId);
		const first = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("isActive", true),
			)
			.first();
		return { hasAny: first !== null };
	},
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
	args: {
		retailerId: v.id("retailers"),
		label: v.string(),
		address: v.string(),
		// Pickup kind. Omitted → "self_collect" (the legacy default + the
		// common case), so older clients that don't send it keep working.
		locationType: v.optional(
			v.union(v.literal("self_collect"), v.literal("drop_off")),
		),
		scheduleNote: v.optional(v.string()),
		mapsUrl: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Captured from Google Places autocomplete. All three flow together —
		// the create call either has all three or none. Optional so retailers
		// who skip the autocomplete and type freely still get a working row.
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		placeId: v.optional(v.string()),
		// Optional store-manager contact. When set, the seller order detail
		// page surfaces a one-tap "Notify <name>" wa.me button.
		managerName: v.optional(v.string()),
		managerWaPhone: v.optional(v.string()),
		// Optional flat fee (minor units) buyers pay for this point. Omitted or
		// 0 → free. Setting a non-zero fee is Pro-gated (chargeablePickup).
		fee: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			retailerId,
			label,
			address,
			locationType,
			scheduleNote,
			mapsUrl,
			notes,
			latitude,
			longitude,
			placeId,
			managerName,
			managerWaPhone,
			fee,
		},
	): Promise<{ pickupLocationId: Id<"pickupLocations"> }> => {
		const access = await requireRetailerOwner(ctx, retailerId);
		// Soft-lock: a past_due seller can't edit fulfilment setup (growth-write,
		// same class as updateSettings). Admin act-as bypasses (white-glove).
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, retailerId);

		const cleanFee = sanitizeFee(fee);
		// Charging for a pickup point is a Pro fulfilment feature. Gate only an
		// actual charge — a free location (fee omitted/0) stays all-tier, so
		// Starter sellers see zero behaviour change. Admin act-as bypasses
		// (white-glove onboarding), mirroring the soft-lock above.
		if (cleanFee !== undefined && !access.actingAsAdmin)
			await assertPlanFeature(ctx, retailerId, "chargeablePickup");

		const cleanLabel = sanitizeLabel(label);
		const cleanAddress = sanitizeAddress(address);
		const cleanLocationType = locationType ?? "self_collect";
		const cleanScheduleNote = sanitizeScheduleNote(scheduleNote);
		const cleanMapsUrl = sanitizeMapsUrl(mapsUrl);
		const cleanNotes = sanitizeNotes(notes);
		const cleanCoords = sanitizeCoords(latitude, longitude);
		const cleanPlaceId = sanitizePlaceId(placeId);
		const cleanManagerName = sanitizeManagerName(managerName);
		const cleanManagerWaPhone = sanitizeManagerWaPhone(managerWaPhone);

		// New rows go to the end of the list. Reading the current max sortOrder
		// keeps numbers stable when the user reorders later — no need to renumber
		// on insert.
		const existing = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		// `reduce` instead of `Math.max(...spread)` — spreading a large array
		// into call arguments throws `RangeError: Maximum call stack size
		// exceeded` once the engine's arg-limit (~65k) is breached. A retailer
		// won't realistically hit that with pickup locations, but reduce
		// is the safer pattern and costs nothing.
		const nextSortOrder =
			existing.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

		const now = Date.now();
		const pickupLocationId = await ctx.db.insert("pickupLocations", {
			retailerId,
			label: cleanLabel,
			address: cleanAddress,
			locationType: cleanLocationType,
			scheduleNote: cleanScheduleNote,
			mapsUrl: cleanMapsUrl,
			notes: cleanNotes,
			latitude: cleanCoords?.latitude,
			longitude: cleanCoords?.longitude,
			placeId: cleanPlaceId,
			managerName: cleanManagerName,
			managerWaPhone: cleanManagerWaPhone,
			fee: cleanFee,
			isActive: true,
			sortOrder: nextSortOrder,
			createdAt: now,
			updatedAt: now,
		});
		await logAdminAction(
			ctx,
			access,
			"pickupLocations.create",
			pickupLocationId,
		);
		return { pickupLocationId };
	},
});

export const update = mutation({
	args: {
		pickupLocationId: v.id("pickupLocations"),
		label: v.optional(v.string()),
		address: v.optional(v.string()),
		// Pickup kind. Undefined = "no change"; a value re-tags the point.
		locationType: v.optional(
			v.union(v.literal("self_collect"), v.literal("drop_off")),
		),
		// Empty string clears the field. Undefined means "no change".
		scheduleNote: v.optional(v.string()),
		mapsUrl: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Google autocomplete fields. Pass all three together when the user
		// picks a suggestion. Pass `null` for all three to clear (used when a
		// previously-autocompleted row is edited back to free text and we
		// want to drop the stale coordinates).
		latitude: v.optional(v.union(v.number(), v.null())),
		longitude: v.optional(v.union(v.number(), v.null())),
		placeId: v.optional(v.union(v.string(), v.null())),
		// Store manager contact. Empty string clears.
		managerName: v.optional(v.string()),
		managerWaPhone: v.optional(v.string()),
		// Pickup fee (minor units). `null` or 0 clears back to free; a positive
		// number sets it (Pro-gated). Undefined = no change — matches the
		// lat/lng null-clear convention above.
		fee: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (
		ctx,
		{
			pickupLocationId,
			label,
			address,
			locationType,
			scheduleNote,
			mapsUrl,
			notes,
			latitude,
			longitude,
			placeId,
			managerName,
			managerWaPhone,
			fee,
		},
	): Promise<void> => {
		const { location, access } = await requireOwnedLocation(
			ctx,
			pickupLocationId,
		);
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, location.retailerId);

		// Pro gate (chargeablePickup) only when SETTING a charge — clearing a
		// fee (null/0) stays all-tier so a downgraded seller can always make a
		// location free again. Admin act-as bypasses (white-glove).
		const cleanFee = fee === null ? undefined : sanitizeFee(fee);
		if (
			fee !== undefined &&
			cleanFee !== undefined &&
			!access.actingAsAdmin
		)
			await assertPlanFeature(ctx, location.retailerId, "chargeablePickup");

		const patch: Partial<{
			label: string;
			address: string;
			locationType: "self_collect" | "drop_off";
			scheduleNote: string | undefined;
			mapsUrl: string | undefined;
			notes: string | undefined;
			latitude: number | undefined;
			longitude: number | undefined;
			placeId: string | undefined;
			managerName: string | undefined;
			managerWaPhone: string | undefined;
			fee: number | undefined;
			updatedAt: number;
		}> = { updatedAt: Date.now() };

		// Undefined = untouched; null/0 → clears (stored as undefined = free).
		if (fee !== undefined) patch.fee = cleanFee;

		if (label !== undefined) patch.label = sanitizeLabel(label);
		if (address !== undefined) patch.address = sanitizeAddress(address);
		if (locationType !== undefined) patch.locationType = locationType;
		// Empty string clears the note; a value re-sanitizes it.
		if (scheduleNote !== undefined)
			patch.scheduleNote = sanitizeScheduleNote(scheduleNote);
		if (mapsUrl !== undefined) patch.mapsUrl = sanitizeMapsUrl(mapsUrl);
		if (notes !== undefined) patch.notes = sanitizeNotes(notes);
		if (managerName !== undefined)
			patch.managerName = sanitizeManagerName(managerName);
		if (managerWaPhone !== undefined)
			patch.managerWaPhone = sanitizeManagerWaPhone(managerWaPhone);

		// Coordinates flow together. null = clear, number = set. Undefined =
		// don't touch. Either both lat AND lng must be numbers, or both null.
		if (latitude !== undefined || longitude !== undefined) {
			if (latitude === null || longitude === null) {
				patch.latitude = undefined;
				patch.longitude = undefined;
			} else if (typeof latitude === "number" && typeof longitude === "number") {
				const clean = sanitizeCoords(latitude, longitude);
				patch.latitude = clean?.latitude;
				patch.longitude = clean?.longitude;
			} else {
				throw new ConvexError(
					"latitude and longitude must be set together (both numbers or both null)",
				);
			}
		}
		if (placeId !== undefined) {
			patch.placeId =
				placeId === null ? undefined : sanitizePlaceId(placeId);
		}

		await ctx.db.patch(pickupLocationId, patch);
		await logAdminAction(
			ctx,
			access,
			"pickupLocations.update",
			pickupLocationId,
		);
	},
});

/**
 * Soft-delete / restore. Historical order snapshots are unaffected; the row
 * just stops appearing on the storefront. Reactivating sends it back to the
 * end of the list so it doesn't ambush the retailer's current ordering.
 */
export const setActive = mutation({
	args: {
		pickupLocationId: v.id("pickupLocations"),
		isActive: v.boolean(),
	},
	handler: async (ctx, { pickupLocationId, isActive }): Promise<void> => {
		const { location, access } = await requireOwnedLocation(
			ctx,
			pickupLocationId,
		);
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, location.retailerId);
		if (location.isActive === isActive) return; // idempotent

		// Fulfilment invariant: don't let the seller hide the LAST active pickup
		// location while delivery is off — that would leave the storefront with no
		// working way to receive orders. `location` is still active here (we
		// returned early above if it already matched), so it's counted among the
		// active rows below. Delivery undefined → effectively on (legacy default),
		// so this only ever blocks a pickup-only seller.
		if (!isActive) {
			const retailer = await ctx.db.get(location.retailerId);
			const offersDelivery = (retailer?.offerDelivery ?? true) === true;
			if (!offersDelivery) {
				const activeRows = await ctx.db
					.query("pickupLocations")
					.withIndex("by_retailer_active", (q) =>
						q.eq("retailerId", location.retailerId).eq("isActive", true),
					)
					.collect();
				if (activeRows.length <= 1) {
					throw new ConvexError(
						"Turn delivery back on or add another pickup location first — hiding this one would leave your storefront with no way to receive orders.",
					);
				}
			}
		}

		const patch: Partial<Doc<"pickupLocations">> = {
			isActive,
			updatedAt: Date.now(),
		};

		if (isActive) {
			const siblings = await ctx.db
				.query("pickupLocations")
				.withIndex("by_retailer", (q) =>
					q.eq("retailerId", location.retailerId),
				)
				.collect();
			// Same `reduce` pattern as in `create` — avoid the
			// `Math.max(...spread)` arg-limit footgun.
			patch.sortOrder =
				siblings.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
		}

		await ctx.db.patch(pickupLocationId, patch);
		await logAdminAction(
			ctx,
			access,
			"pickupLocations.setActive",
			pickupLocationId,
		);
	},
});

/**
 * Bulk-reorder the active pickup locations. Caller passes the full ordered
 * list of active ids; server rewrites `sortOrder` to the index of each id
 * (0..N-1) so the result is gap-free.
 *
 * Validates that `orderedIds` is exactly the set of currently-active ids for
 * the retailer — no duplicates, no missing, no foreign / inactive ids. This
 * catches a stale client that reordered against an outdated cache after
 * someone else added or deactivated a location.
 *
 * Inactive rows are intentionally untouched. Their existing `sortOrder` value
 * is preserved (and `setActive(true)` continues to send a reactivated row to
 * the end via `max(allSortOrders) + 1`).
 */
export const reorder = mutation({
	args: {
		retailerId: v.id("retailers"),
		orderedIds: v.array(v.id("pickupLocations")),
	},
	handler: async (ctx, { retailerId, orderedIds }): Promise<void> => {
		const access = await requireRetailerOwner(ctx, retailerId);
		// Soft-lock (growth-write); admin act-as bypasses.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, retailerId);

		const activeRows = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("isActive", true),
			)
			.collect();

		if (orderedIds.length !== activeRows.length) {
			throw new ConvexError(
				"Order list must contain every active pickup location exactly once",
			);
		}
		const activeIds = new Set(activeRows.map((r) => r._id));
		const seen = new Set<string>();
		for (const id of orderedIds) {
			if (!activeIds.has(id)) {
				throw new ConvexError(
					"Pickup location not found or no longer active",
				);
			}
			if (seen.has(id)) {
				throw new ConvexError("Duplicate id in order list");
			}
			seen.add(id);
		}

		const now = Date.now();
		for (let i = 0; i < orderedIds.length; i++) {
			await ctx.db.patch(orderedIds[i], {
				sortOrder: i,
				updatedAt: now,
			});
		}
		await logAdminAction(ctx, access, "pickupLocations.reorder", retailerId);
	},
});
