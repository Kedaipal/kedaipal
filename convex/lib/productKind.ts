// Product "kind" — the vocabulary + question router locked in the booking
// spec (86eyj70z1, decision 5): Food / Physical goods / Service / Booking in
// the wizard, stored as a MINIMAL 3-value enum. "Food" is a router, never a
// stored kind — it lands as "physical" and re-words the existing preparation
// question ("Made fresh when ordered" vs "Ready stock"), so no future feature
// can ever branch on "food". Kind changes which wizard steps appear and what
// words render (products→listings, order→booking); it is NEVER a behaviour
// fork into a second product system — a fork doubles every test matrix
// forever.
//
// Pure + dependency-free: imported by BOTH the Convex mutations that validate
// it and the wizard/form UI that renders it (productCap precedent).
// See docs/booking.md.

export type ProductKind = "physical" | "service" | "booking";

export const PRODUCT_KINDS: readonly ProductKind[] = [
	"physical",
	"service",
	"booking",
];

/** Unset rows predate the field — they are physical products (zero migration). */
export const DEFAULT_PRODUCT_KIND: ProductKind = "physical";

export function effectiveKind(kind: string | undefined): ProductKind {
	return kind === "service" || kind === "booking" ? kind : DEFAULT_PRODUCT_KIND;
}

/**
 * Ceiling on per-night capacity. Sengloh's real catalog needs ~5; the cap is
 * a fat-finger guard (a "500" typo would silently accept 500 overlapping
 * bookings a night), not a product limit — raise it when a real seller needs
 * more.
 */
export const MAX_CAPACITY_PER_NIGHT = 100;

/**
 * Validate a booking listing's per-night capacity: a whole number of
 * interchangeable units ("Standard Plot ×5" is one product with capacity 5).
 * Throws with seller-facing copy — callers surface it verbatim.
 */
export function sanitizeCapacityPerNight(n: number): number {
	if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY_PER_NIGHT) {
		throw new Error(
			`Capacity must be a whole number between 1 and ${MAX_CAPACITY_PER_NIGHT}`,
		);
	}
	return n;
}


/** Ceiling on the refundable security deposit (sen) — RM 10,000, the same
 * fat-finger guard as sanitizeFee's fee ceiling. */
export const MAX_SECURITY_DEPOSIT = 1_000_000;

/**
 * Validate a booking listing's refundable security deposit (sen). Integer,
 * ≥ 0, ≤ RM 10,000; 0 normalizes to undefined so "no deposit" has exactly one
 * spelling (the sanitizeFee posture). Throws seller-facing copy.
 */
export function sanitizeSecurityDeposit(
	n: number | undefined,
): number | undefined {
	if (n === undefined) return undefined;
	if (!Number.isInteger(n) || n < 0 || n > MAX_SECURITY_DEPOSIT) {
		throw new Error(
			"Security deposit must be between RM 0 and RM 10,000",
		);
	}
	return n === 0 ? undefined : n;
}

/**
 * The rendered noun for one sellable row of this kind — the vocabulary half
 * of the kind decision. Copy reads "listing" for bookings ("2 listings",
 * "Name this listing") without the stored table ever renaming.
 */
export function kindNoun(kind: ProductKind): "product" | "service" | "listing" {
	switch (kind) {
		case "service":
			return "service";
		case "booking":
			return "listing";
		default:
			return "product";
	}
}
