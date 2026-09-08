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
 *
 * **`undefined` means UNLIMITED** (S7, `86eyqxb14`) — a gym selling month
 * packages has no daily member cap, so requiring a number there would force a
 * fake ceiling. Every consumer must treat `undefined` as "never full", NOT as
 * a missing value to default to 1 — see `findFullNights`.
 *
 * Throws with seller-facing copy — callers surface it verbatim.
 */
export function sanitizeCapacityPerNight(
	n: number | undefined,
): number | undefined {
	if (n === undefined) return undefined;
	if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY_PER_NIGHT) {
		throw new Error(
			`Capacity must be a whole number between 1 and ${MAX_CAPACITY_PER_NIGHT}, or blank for unlimited`,
		);
	}
	return n;
}

/** Longest fixed-length package a seller may sell (S7), per unit. A year
 * covers the annual-membership case; beyond that is a subscription, not a
 * booking. */
export const MAX_PACKAGE_DAYS = 366;
export const MAX_PACKAGE_MONTHS = 12;

/**
 * How a package's length is counted — and, for `day` vs `night`, what the
 * seller's trade CALLS it.
 *
 * **"month" means the CALENDAR month** — join the 12th, renew the 12th —
 * which is what a gym means by "monthly" and what a rolling day count never
 * gives: 30 days from 1 Jan ends on the 30th, from 1 Feb it spills into
 * March, so the renewal date walks through the year.
 *
 * **"night" and "day" are the SAME arithmetic** — a 2-night stay and a 2-day
 * pass both run `checkIn + 2 days` — and differ only in the word the buyer
 * reads. That difference is real: accommodation is sold by the night (a "3D2N"
 * package is two nights), a gym or class by the day, and free-range stays on
 * this same storefront already say "nights". Rather than add a settings knob
 * for a wording nuance, the seller picks it in the unit dropdown they already
 * fill in — no new concept, one extra option.
 */
export type PackageUnit = "day" | "night" | "month";

export function packageUnitMax(unit: PackageUnit): number {
	return unit === "month" ? MAX_PACKAGE_MONTHS : MAX_PACKAGE_DAYS;
}

/** Does this unit count whole calendar months rather than 24-hour days? The
 * ONE place the day/night equivalence is asserted, so no caller has to
 * remember that `night` is day arithmetic wearing a different word. */
export function isMonthlyUnit(unit: PackageUnit | undefined): boolean {
	return unit === "month";
}

/**
 * Validate a booking listing's package length, in its own unit.
 *
 * Set = the listing sells a **fixed-length package**: the buyer picks a start
 * date only, the end derives, and the price is flat per package rather than
 * per night. Unset = the free check-in/check-out range the campsite uses.
 * 0 normalizes to undefined so "no package" has one spelling (the
 * sanitizeFee/securityDeposit posture).
 */
export function sanitizePackageLength(
	n: number | undefined,
	unit: PackageUnit = "day",
): number | undefined {
	if (n === undefined) return undefined;
	const max = packageUnitMax(unit);
	if (!Number.isInteger(n) || n < 0 || n > max) {
		throw new Error(
			`Package length must be a whole number of ${unit}s between 1 and ${max}`,
		);
	}
	return n === 0 ? undefined : n;
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
 * Weekend / weekday per-night rates (S13, `z8r3fddkp8`) — the campsite and
 * homestay pricing shape: ONE listing, ONE capacity, a second per-night rate
 * that applies on the nights the seller names.
 *
 * `weekendDays` are weekday indexes (0 = Sunday .. 6 = Saturday, the
 * `weekdayIndexMyt` convention) of the NIGHT the guest sleeps — a 12→14 Sep
 * stay sleeps the 12th and the 13th; the check-out morning never counts. The
 * default is Fri + Sat nights, the near-universal campsite rule; the picker
 * covers "Fri, Sat & Sun" and "Sunday only" sites. Kept as a weekday SET (not
 * a dated list) so a future `peakDates[]` for public holidays can sit beside
 * it without a rename.
 *
 * The rate is a pricing RULE on the listing's one implicit variant — never a
 * second variant (that would split capacity in two, the exact trap the
 * two-listings workaround falls into). Free-range stays only: a fixed-length
 * package has one flat price by definition.
 */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [5, 6];

/** Ceiling on a per-night rate (sen) — RM 100,000, a fat-finger guard like
 * the deposit's, not a product limit. */
export const MAX_WEEKEND_PRICE = 10_000_000;

/** Short weekday names, index-aligned with `weekdayIndexMyt` (0 = Sunday).
 * Mirrors `WEEKDAY_NAMES_SHORT` in openingHours.ts — duplicated rather than
 * imported because this module must stay dependency-free (it is imported by
 * the wizard, the storefront and every Convex validator). */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Validate the weekend-rate pair.
 *
 * - No price (undefined or 0) → BOTH unset: "no weekend rate" has exactly one
 *   spelling (the sanitizeFee / securityDeposit posture), so days without a
 *   price are dropped rather than stored as dead config.
 * - A price → integer sen in (0, MAX]; days default to Fri + Sat when absent,
 *   otherwise must be ≥1 distinct weekday index in 0..6 and never all seven
 *   ("that's every night — set it as the base price instead"). Returned
 *   deduped and sorted so two sellers picking the same nights store the same
 *   array.
 * - A fixed-length package refuses the rate outright (surfaced, never
 *   silently ignored): its price is flat per package, so a weekend rate
 *   would be config that describes nothing.
 *
 * Throws with seller-facing copy — callers surface it verbatim.
 */
export function sanitizeWeekendRate(
	price: number | undefined,
	days: readonly number[] | undefined,
	opts: { packageLength?: number } = {},
): { weekendPrice?: number; weekendDays?: number[] } {
	if (price === undefined || price === 0) return {};
	if (!Number.isInteger(price) || price < 0 || price > MAX_WEEKEND_PRICE) {
		throw new Error("Weekend rate must be between RM 0 and RM 100,000");
	}
	if (opts.packageLength !== undefined && opts.packageLength > 0) {
		throw new Error(
			"A package has one flat price — clear the package length to price weekends differently",
		);
	}
	const picked = days === undefined ? [...DEFAULT_WEEKEND_DAYS] : [...days];
	for (const d of picked) {
		if (!Number.isInteger(d) || d < 0 || d > 6) {
			throw new Error("Weekend nights must be days of the week");
		}
	}
	const unique = [...new Set(picked)].sort((a, b) => a - b);
	if (unique.length === 0) {
		throw new Error("Pick at least one night for the weekend rate");
	}
	if (unique.length === 7) {
		throw new Error(
			"That's every night — set it as the price per night instead",
		);
	}
	return { weekendPrice: price, weekendDays: unique };
}

/**
 * The ONE author of "Fri & Sat" — every surface that names the weekend
 * nights (storefront price line, calendar legend, seller consequence line,
 * summary strip, the frozen order line) reads this. Rendered in Mon→Sun
 * order so "Sat & Sun" never comes out as "Sun & Sat".
 */
export function weekendDaysLabel(days: readonly number[]): string {
	const order = [1, 2, 3, 4, 5, 6, 0];
	const names = order
		.filter((d) => days.includes(d))
		.map((d) => WEEKDAY_SHORT[d]);
	if (names.length === 0) return "";
	if (names.length === 1) return names[0];
	return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * The frozen `variantLabel` on a booking order's two lines. Written here and
 * read back by `bookingNightKind` in the same module, so the writer and the
 * reader can never drift. A listing WITH a weekend rate labels even a
 * single-kind stay ("Weekday nights") — the label answers "why did I pay
 * RM 80 and not RM 120?" on an all-weekday stay just as much as on a mixed
 * one. A listing without one keeps today's unlabelled line.
 */
export const WEEKDAY_NIGHTS_LABEL = "Weekday nights";
const WEEKEND_NIGHTS_PREFIX = "Weekend nights";

export function weekendNightsLabel(days: readonly number[]): string {
	return `${WEEKEND_NIGHTS_PREFIX} (${weekendDaysLabel(days)})`;
}

export type BookingNightKind = "weekday" | "weekend";

/** Which kind of night a frozen booking line charges for, from its label —
 * `undefined` for a line placed before weekend rates existed or on a listing
 * that never had one. */
export function bookingNightKind(
	variantLabel: string | undefined,
): BookingNightKind | undefined {
	if (variantLabel === undefined) return undefined;
	if (variantLabel === WEEKDAY_NIGHTS_LABEL) return "weekday";
	if (variantLabel.startsWith(`${WEEKEND_NIGHTS_PREFIX} (`)) return "weekend";
	return undefined;
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
