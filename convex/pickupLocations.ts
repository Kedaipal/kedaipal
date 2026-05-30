import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { assertValidMapsUrl } from "./lib/mapsUrl";

const LABEL_MAX = 60;
const ADDRESS_MIN = 3;
const ADDRESS_MAX = 500;
const NOTES_MAX = 200;

// ---------------------------------------------------------------------------
// Auth helpers — mirror the pattern in convex/customers.ts so each module is
// self-contained and a future split of these into a shared lib can be a single
// search-and-replace.
// ---------------------------------------------------------------------------

async function requireRetailerOwner(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"retailers">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId !== identity.subject) throw new Error("Forbidden");
	return retailer;
}

async function requireOwnedLocation(
	ctx: QueryCtx,
	pickupLocationId: Id<"pickupLocations">,
): Promise<Doc<"pickupLocations">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const location = await ctx.db.get(pickupLocationId);
	if (!location) throw new Error("Pickup location not found");
	const retailer = await ctx.db.get(location.retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId !== identity.subject) throw new Error("Forbidden");
	return location;
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

function sanitizeNotes(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.length > NOTES_MAX) {
		throw new ConvexError(`Notes must be at most ${NOTES_MAX} characters`);
	}
	return trimmed;
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
			mapsUrl?: string;
			notes?: string;
			latitude?: number;
			longitude?: number;
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
				mapsUrl: r.mapsUrl,
				notes: r.notes,
				latitude: r.latitude,
				longitude: r.longitude,
				sortOrder: r.sortOrder,
			}));
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
		mapsUrl: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Captured from Google Places autocomplete. All three flow together —
		// the create call either has all three or none. Optional so retailers
		// who skip the autocomplete and type freely still get a working row.
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		placeId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ retailerId, label, address, mapsUrl, notes, latitude, longitude, placeId },
	): Promise<{ pickupLocationId: Id<"pickupLocations"> }> => {
		await requireRetailerOwner(ctx, retailerId);

		const cleanLabel = sanitizeLabel(label);
		const cleanAddress = sanitizeAddress(address);
		const cleanMapsUrl = sanitizeMapsUrl(mapsUrl);
		const cleanNotes = sanitizeNotes(notes);
		const cleanCoords = sanitizeCoords(latitude, longitude);
		const cleanPlaceId = placeId?.trim() || undefined;

		// New rows go to the end of the list. Reading the current max sortOrder
		// keeps numbers stable when the user reorders later — no need to renumber
		// on insert.
		const existing = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		const nextSortOrder =
			existing.length === 0
				? 0
				: Math.max(...existing.map((r) => r.sortOrder)) + 1;

		const now = Date.now();
		const pickupLocationId = await ctx.db.insert("pickupLocations", {
			retailerId,
			label: cleanLabel,
			address: cleanAddress,
			mapsUrl: cleanMapsUrl,
			notes: cleanNotes,
			latitude: cleanCoords?.latitude,
			longitude: cleanCoords?.longitude,
			placeId: cleanPlaceId,
			isActive: true,
			sortOrder: nextSortOrder,
			createdAt: now,
			updatedAt: now,
		});
		return { pickupLocationId };
	},
});

export const update = mutation({
	args: {
		pickupLocationId: v.id("pickupLocations"),
		label: v.optional(v.string()),
		address: v.optional(v.string()),
		// Empty string clears the field. Undefined means "no change".
		mapsUrl: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Google autocomplete fields. Pass all three together when the user
		// picks a suggestion. Pass `null` for all three to clear (used when a
		// previously-autocompleted row is edited back to free text and we
		// want to drop the stale coordinates).
		latitude: v.optional(v.union(v.number(), v.null())),
		longitude: v.optional(v.union(v.number(), v.null())),
		placeId: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (
		ctx,
		{ pickupLocationId, label, address, mapsUrl, notes, latitude, longitude, placeId },
	): Promise<void> => {
		await requireOwnedLocation(ctx, pickupLocationId);

		const patch: Partial<{
			label: string;
			address: string;
			mapsUrl: string | undefined;
			notes: string | undefined;
			latitude: number | undefined;
			longitude: number | undefined;
			placeId: string | undefined;
			updatedAt: number;
		}> = { updatedAt: Date.now() };

		if (label !== undefined) patch.label = sanitizeLabel(label);
		if (address !== undefined) patch.address = sanitizeAddress(address);
		if (mapsUrl !== undefined) patch.mapsUrl = sanitizeMapsUrl(mapsUrl);
		if (notes !== undefined) patch.notes = sanitizeNotes(notes);

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
			patch.placeId = placeId === null ? undefined : placeId.trim() || undefined;
		}

		await ctx.db.patch(pickupLocationId, patch);
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
		const location = await requireOwnedLocation(ctx, pickupLocationId);
		if (location.isActive === isActive) return; // idempotent

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
			patch.sortOrder =
				siblings.length === 0
					? 0
					: Math.max(...siblings.map((r) => r.sortOrder)) + 1;
		}

		await ctx.db.patch(pickupLocationId, patch);
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
 * the end via `Math.max(allSortOrders) + 1`).
 */
export const reorder = mutation({
	args: {
		retailerId: v.id("retailers"),
		orderedIds: v.array(v.id("pickupLocations")),
	},
	handler: async (ctx, { retailerId, orderedIds }): Promise<void> => {
		await requireRetailerOwner(ctx, retailerId);

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
	},
});
