// Client registry for team permissions (86exr91r4, docs/team-members.md).
//
// The KEYS and clamps live server-side in convex/lib/permissions.ts (imported
// here, type-safe both ways); this file adds what the server has no business
// knowing: the human labels, the one-line descriptions the Team page surfaces
// (the standing rule — a permission the owner can grant must SAY what it
// opens), the area grouping, and the invite presets. Presets are PREFILLS of
// the same grants, never stored roles.

import {
	MAX_GRANTABLE,
	type MemberPermissions,
	PERMISSION_AREAS,
	type PermissionArea,
	type PermissionLevel,
} from "../../convex/lib/permissions";

export {
	MAX_GRANTABLE,
	PERMISSION_AREAS,
	type MemberPermissions,
	type PermissionArea,
	type PermissionLevel,
};

export type AreaCopy = {
	label: string;
	/** What granting this actually opens — shown under the label in the matrix. */
	description: string;
	/** Honest scope note where the obvious reading over-promises. */
	caveat?: string;
};

export const AREA_COPY: Record<PermissionArea, AreaCopy> = {
	orders: {
		label: "Orders & counter",
		description:
			"The order inbox and pages, status moves, counter checkout, rider booking, payment confirmations.",
	},
	products: {
		label: "Products",
		description: "Products, variants, categories and bulk import.",
	},
	customers: {
		label: "Customers",
		description: "The customer list, details and notes.",
	},
	bookings: {
		label: "Bookings",
		description: "Booking listings, blocked dates and the calendar.",
	},
	insights: {
		label: "Business insights",
		description: "Revenue totals, trends and best sellers.",
		caveat:
			"Hides totals and trends only — anyone working orders still sees each order's amount.",
	},
	exports: {
		label: "Data export",
		description: "Downloading orders, products and customers as CSV.",
	},
	store_settings: {
		label: "Store settings",
		description: "Store name, description, logo, cover, hours, order stages.",
	},
	fulfilment: {
		label: "Fulfilment settings",
		description: "Pickup locations, delivery charges, labels, order rules.",
	},
	payments_settings: {
		label: "Payment details",
		description: "The bank accounts and QR codes buyers pay into.",
	},
	integrations: {
		label: "Integrations",
		description: "Lalamove, Delyva and HitPay accounts.",
	},
	billing: {
		label: "Billing",
		description: "Your Kedaipal subscription and invoices (view only).",
	},
};

/** Display + matrix order: day-to-day work first, then configuration, then
 * the sensitive money/egress grants presets deliberately leave off. */
export const AREA_GROUPS: ReadonlyArray<{
	label: string;
	areas: PermissionArea[];
}> = [
	{ label: "Day-to-day", areas: ["orders", "products", "customers", "bookings"] },
	{ label: "Store setup", areas: ["store_settings", "fulfilment"] },
	{
		label: "Sensitive",
		areas: [
			"insights",
			"exports",
			"payments_settings",
			"integrations",
			"billing",
		],
	},
];

export type TeamPreset = {
	id: "helper" | "manager";
	label: string;
	description: string;
	grants: MemberPermissions;
};

export const TEAM_PRESETS: TeamPreset[] = [
	{
		id: "helper",
		label: "Front-desk helper",
		description:
			"Runs orders and the counter, sees products and customers. No settings, no totals.",
		grants: {
			orders: "write",
			products: "read",
			customers: "read",
			bookings: "write",
		},
	},
	{
		id: "manager",
		label: "Store manager",
		description:
			"Everything a helper can, plus editing products, customers, store and fulfilment settings, and viewing insights.",
		grants: {
			orders: "write",
			products: "write",
			customers: "write",
			bookings: "write",
			store_settings: "write",
			fulfilment: "write",
			insights: "read",
		},
	},
];

/** The matrix's control shape for an area: three-way (none/view/edit) where
 * write is grantable, a single view toggle where it isn't. */
export function areaControl(area: PermissionArea): "three-way" | "view-toggle" {
	return MAX_GRANTABLE[area] === "write" ? "three-way" : "view-toggle";
}

export function grantsEqual(
	a: MemberPermissions,
	b: MemberPermissions,
): boolean {
	return PERMISSION_AREAS.every((area) => (a[area] ?? null) === (b[area] ?? null));
}

/** Which preset a grants object matches, for the picker's selected state. */
export function matchingPreset(
	grants: MemberPermissions,
): TeamPreset["id"] | "custom" {
	for (const preset of TEAM_PRESETS) {
		if (grantsEqual(grants, preset.grants)) return preset.id;
	}
	return "custom";
}

/**
 * Short chips for a member row: first areas they can touch, "+N" overflow.
 *
 * A read-only grant says so. The chips used to name the area and nothing else,
 * so a member holding `products: "read"` read "Products" here and then met
 * "Ask the store owner for edit access to change products" on the button —
 * two statements about the same grant, on the same screen, disagreeing (found
 * driving Chrome as a member, 26 Sep). It matters most to the MEMBER, who has
 * no Edit-access dialog to open: these chips are the only place they are told
 * what they hold. Write stays bare, because it is the unsurprising half; the
 * qualifier goes on the one that would otherwise be discovered by being
 * refused.
 */
export function grantSummary(
	grants: MemberPermissions | undefined,
	max = 3,
): { chips: string[]; more: number } {
	if (!grants) return { chips: [], more: 0 };
	const held = PERMISSION_AREAS.filter((a) => grants[a] !== undefined);
	return {
		chips: held
			.slice(0, max)
			.map((a) =>
				grants[a] === "read"
					? `${AREA_COPY[a].label} · view`
					: AREA_COPY[a].label,
			),
		more: Math.max(0, held.length - max),
	};
}
