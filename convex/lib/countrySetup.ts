import { type Country, DEFAULT_COUNTRY } from "./country";
import {
	type DeliveryConfig,
	deliveryModeAllowed,
	riderBookingAllowed,
} from "./delivery";
import { STORED_MOBILE_PATTERN } from "./slug";

/**
 * The post-switch setup checklist (SG-lite, 86eyqgujv).
 *
 * Switching a store's country is a different path from creating one in that
 * country, and it leaves Malaysian data behind on surfaces a buyer and a
 * courier can see. The settled rule (Zaki, 21 Aug): **allow the switch, then
 * guide the cleanup.** Refusing was tried and is a hard deadlock — Google
 * Places predictions are locked server-side to the store's CURRENT country
 * (convex/google.ts `includedRegionCodes`), so "fix your address before
 * switching" cannot be done. Clearing the values instead is the data wipe we
 * don't want: a seller's weight-zone rate card is an hour of work.
 *
 * So nothing is refused and nothing is destroyed. Every carried-over value is
 * inert where it matters (the delivery resolver holds rather than prices an
 * unservable address; the dispatch card hides itself), and this module names
 * what is still to be fixed.
 *
 * COMPUTED ON READ, never stored. It cannot go stale, needs no migration, and
 * self-clears item by item as the seller fixes things.
 *
 * Two kinds of item, and the difference is honest rather than cosmetic:
 *
 *  · VERIFIABLE — we hold the fact, so the row disappears when it is actually
 *    fixed and an acknowledgement can never dismiss it into a lie. This is
 *    what the address country stamps exist for.
 *  · ACKNOWLEDGED — free text we cannot judge. Nothing in the row says whether
 *    a bank account is Malaysian or Singaporean, so the seller confirms it and
 *    we record that they did.
 */

export type CountrySetupItemKey =
	| "payment_methods"
	| "hitpay"
	| "business_address"
	| "pickup_addresses"
	| "delivery_mode"
	| "pickup_contacts"
	| "delivery_booking"
	| "wa_phone"
	| "notify_wa_phone"
	| "message_copy";

/**
 * Ranked by what it costs to get wrong, because a seller reads the first row
 * and maybe the second.
 *
 *  · money        — the buyer's payment fails or lands somewhere unusable.
 *  · buyer_visible — wrong information printed in front of a buyer or courier.
 *  · cosmetic     — reads as foreign, but nothing breaks.
 */
export type CountrySetupSeverity = "money" | "buyer_visible" | "cosmetic";

export type CountrySetupItem = {
	key: CountrySetupItemKey;
	severity: CountrySetupSeverity;
	/** False = the seller must confirm it; we cannot tell. */
	verifiable: boolean;
	/** How many rows are affected, where the item covers a list. */
	count?: number;
};

/**
 * Whether we can judge a row ourselves, per key — the single author.
 *
 * Exported because the deep-link highlight needs it WITHOUT running the whole
 * resolver: a verifiable row we know is wrong earns a red error ring, while a
 * row we merely want checked earns amber. Deriving that from a second
 * hand-written table on the client is how the two would drift.
 */
export const VERIFIABLE: Record<CountrySetupItemKey, boolean> = {
	payment_methods: false,
	hitpay: false,
	message_copy: false,
	business_address: true,
	pickup_addresses: true,
	delivery_mode: true,
	pickup_contacts: true,
	// Was verifiable when it meant "booking on in a country with no booking" —
	// a fact we held. Since z8r3fdch3r it means "your keys may belong to the
	// old market", and nothing in a stored key says which market it was created
	// for, so only the seller can confirm. Un-dismissable here would be a
	// permanent nag on stores whose keys are fine.
	delivery_booking: false,
	wa_phone: true,
	notify_wa_phone: true,
};

/** Severity order — the sort key, and the reason `money` items keep the panel
 * open. Declared as a Record so a new severity is a compile error. */
const SEVERITY_RANK: Record<CountrySetupSeverity, number> = {
	money: 0,
	buyer_visible: 1,
	cosmetic: 2,
};

export type CountrySetupInput = {
	country: Country | undefined;
	/** Unset = the store has never switched; there is nothing to check. */
	countryChangedAt: number | undefined;
	acked: readonly string[] | undefined;
	businessAddress: { country?: Country } | undefined;
	pickupLocations: readonly {
		country?: Country;
		managerWaPhone?: string;
		isActive: boolean;
	}[];
	deliveryConfigMode: DeliveryConfig["mode"] | undefined;
	deliveryBookingEnabled: boolean;
	waPhone: string | undefined;
	notifyWaPhone: string | undefined;
	hasPaymentMethods: boolean;
	hasHitpay: boolean;
	hasCustomCopy: boolean;
};

/**
 * An address is only "wrong country" when its capture country is STAMPED and
 * differs. Un-stamped rows predate the stamp and read as matching — fail open,
 * so no existing store is told its own address is foreign. See the schema
 * comment on `retailers.businessAddress.country` for why coordinates can't
 * answer this (Singapore's bounding box contains Johor Bahru).
 */
function foreign(stamped: Country | undefined, store: Country): boolean {
	return stamped !== undefined && stamped !== store;
}

/**
 * What still needs the seller's attention after a country switch, most costly
 * first. Empty = nothing left to do (or the store never switched).
 */
export function resolveCountrySetup(
	input: CountrySetupInput,
): CountrySetupItem[] {
	if (input.countryChangedAt === undefined) return [];
	const country = input.country ?? DEFAULT_COUNTRY;
	const acked = new Set(input.acked ?? []);
	const items: CountrySetupItem[] = [];

	const add = (
		key: CountrySetupItemKey,
		severity: CountrySetupSeverity,
		count?: number,
	) => {
		const verifiable = VERIFIABLE[key];
		// An acknowledgement only ever retires an UNVERIFIABLE item. A stamped
		// wrong-country address is a fact; letting a tick hide it would turn the
		// checklist into a thing sellers learn to dismiss.
		if (!verifiable && acked.has(key)) return;
		items.push({ key, severity, verifiable, ...(count ? { count } : {}) });
	};

	// --- money: the buyer's payment goes somewhere unusable -----------------
	if (input.hasPaymentMethods) add("payment_methods", "money");
	if (input.hasHitpay) add("hitpay", "money");

	// --- buyer- and courier-visible wrongness -------------------------------
	if (foreign(input.businessAddress?.country, country)) {
		add("business_address", "buyer_visible");
	}
	// Deliberately NOT auto-hidden. Hiding every wrong-country pickup point
	// would break the working-method invariant — a pickup-only store would lose
	// checkout entirely, turning a cosmetic problem into a dead storefront. And
	// unlike a bank account, a pickup address is printed in front of the buyer
	// at checkout, so it is self-evident once seen.
	const foreignPickups = input.pickupLocations.filter(
		(l) => l.isActive && foreign(l.country, country),
	).length;
	if (foreignPickups > 0) {
		add("pickup_addresses", "buyer_visible", foreignPickups);
	}
	if (
		input.deliveryConfigMode !== undefined &&
		!deliveryModeAllowed(country, input.deliveryConfigMode)
	) {
		add("delivery_mode", "buyer_visible");
	}

	// --- cosmetic: reads as foreign, nothing breaks -------------------------
	const stalePickupContacts = input.pickupLocations.filter(
		(l) => l.managerWaPhone && !STORED_MOBILE_PATTERN[country].test(l.managerWaPhone),
	).length;
	if (stalePickupContacts > 0) {
		add("pickup_contacts", "cosmetic", stalePickupContacts);
	}
	// Rider booking exists in both our markets now (z8r3fdch3r), but Lalamove
	// issues API keys per market app — a key created for Malaysia quotes
	// nothing in Singapore. Booking stays armed across the switch (nothing is
	// silently disabled), so the checklist has to say why the next quote will
	// fail and where the fix is.
	if (input.deliveryBookingEnabled) {
		add("delivery_booking", riderBookingAllowed(country) ? "money" : "cosmetic");
	}
	if (input.waPhone && !STORED_MOBILE_PATTERN[country].test(input.waPhone)) {
		add("wa_phone", "cosmetic");
	}
	if (
		input.notifyWaPhone &&
		!STORED_MOBILE_PATTERN[country].test(input.notifyWaPhone)
	) {
		add("notify_wa_phone", "cosmetic");
	}
	if (input.hasCustomCopy) add("message_copy", "cosmetic");

	return items.sort(
		(a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
	);
}

/** Keys the seller can retire by confirming — what a "dismiss" acknowledges.
 * A verifiable item is never in here, so dismissing can't hide a real fault. */
export function ackableKeys(items: readonly CountrySetupItem[]): string[] {
	return items.filter((i) => !i.verifiable).map((i) => i.key);
}

/** Money is still at stake — the panel stays open (86eyqgujv: "might cause
 * them quite abit of problem if they use the wrong keys or checkout address
 * and buyer already made an order"). */
export function hasMoneyRisk(items: readonly CountrySetupItem[]): boolean {
	return items.some((i) => i.severity === "money");
}
