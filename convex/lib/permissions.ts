// Team-member permission registry (ClickUp 86exr91r4, docs/team-members.md).
//
// THE model: a store has ONE owner (`retailers.userId`) and up to
// `userCap - 1` members (`retailerMembers` rows). A member holds per-AREA
// grants — none / read / write — assigned by the owner. There are no stored
// roles: "roles" in the UI are presets that prefill these grants.
//
// Permissions attach to DATA AREAS, never to components. Every settings tab,
// route and dashboard widget declares the area whose data it reads and
// inherits its visibility from that grant — a future Lalamove-balance widget
// declares `integrations` and needs no new permission row. This is what keeps
// the Team page ~11 rows forever and prevents contradictions (hiding a revenue
// tile while the order list still shows per-order amounts).
//
// DENY-BY-DEFAULT: an absent key means no access. An area added to this list
// later therefore starts at "none" for every existing member automatically —
// adding an area is safe by construction.
//
// Honesty rule for UI copy: `insights: none` hides TOTALS AND TRENDS, not
// money entirely — a member granted orders sees per-order amounts, because
// collecting payment is the job. Copy must promise the former, never the
// latter.

import { v } from "convex/values";

export const PERMISSION_AREAS = [
	// Day-to-day operating surfaces.
	"orders", // inbox, detail, status moves, notes, cancel, pin, counter checkout, rider booking, payment reminder
	"products", // products + categories + variants + bulk import
	"customers", // CRM list, detail, notes
	"bookings", // booking listings, blocks, calendar feed
	// Aggregates + data egress — sensitive, expected to stay off for most helpers.
	"insights", // /app/insights + every revenue/aggregate dashboard widget
	"exports", // every CSV export (orders, products, customers)
	// Configuration surfaces.
	"store_settings", // name, description, logo, cover, hours, order-status labels
	"fulfilment", // pickup locations, delivery config, AWB template
	"payments_settings", // banks + QR codes buyers see
	"integrations", // Lalamove/Delyva/HitPay accounts + future balance widgets
	"billing", // subscription, invoices, seat usage
] as const;

export type PermissionArea = (typeof PERMISSION_AREAS)[number];

export type PermissionLevel = "read" | "write";

/** A member's grants. Absent key = no access to that area. */
export type MemberPermissions = Partial<
	Record<PermissionArea, PermissionLevel>
>;

/**
 * The highest level the OWNER can grant per area. Two reasons an area is
 * capped at "read":
 *  - `insights` / `exports` have no write concept (viewing / downloading IS
 *    the capability);
 *  - `billing` write moves the owner's money (plan change, cancel,
 *    auto-renew), so it stays owner-only in v1 — relaxing that later is this
 *    one line, not a migration (Zaki, 24 Sep 2026).
 * `sanitizePermissions` clamps to this, so a tampered client request can
 * never store a grant the registry forbids.
 */
export const MAX_GRANTABLE: Record<PermissionArea, PermissionLevel> = {
	orders: "write",
	products: "write",
	customers: "write",
	bookings: "write",
	insights: "read",
	exports: "read",
	store_settings: "write",
	fulfilment: "write",
	payments_settings: "write",
	integrations: "write",
	billing: "read",
};

/**
 * Validator for the grants object. Deliberately explicit (not built from the
 * array) so `convex dev` schema analysis stays trivially static;
 * `permissions.test.ts` pins that these keys and PERMISSION_AREAS can never
 * drift apart.
 */
const level = v.union(v.literal("read"), v.literal("write"));
export const memberPermissionsValidator = v.object({
	orders: v.optional(level),
	products: v.optional(level),
	customers: v.optional(level),
	bookings: v.optional(level),
	insights: v.optional(level),
	exports: v.optional(level),
	store_settings: v.optional(level),
	fulfilment: v.optional(level),
	payments_settings: v.optional(level),
	integrations: v.optional(level),
	billing: v.optional(level),
});

/** Write implies read; absent means none. */
export function hasPermission(
	grants: MemberPermissions,
	area: PermissionArea,
	needed: PermissionLevel,
): boolean {
	const held = grants[area];
	if (held === undefined) return false;
	if (needed === "read") return held === "read" || held === "write";
	return held === "write";
}

/**
 * Clamp arbitrary input to what the registry allows: unknown keys dropped,
 * levels capped at MAX_GRANTABLE. Run on every server write of a grants
 * object (invite + edit-access) — the client's preset UI is convenience, this
 * is the rule.
 */
export function sanitizePermissions(
	input: MemberPermissions,
): MemberPermissions {
	const out: MemberPermissions = {};
	for (const area of PERMISSION_AREAS) {
		const requested = input[area];
		if (requested === undefined) continue;
		const max = MAX_GRANTABLE[area];
		out[area] = requested === "write" && max === "read" ? "read" : requested;
	}
	return out;
}
