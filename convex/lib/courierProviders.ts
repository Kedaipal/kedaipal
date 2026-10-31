/**
 * The courier provider registry (z8r3fdcje2 PR1).
 *
 * ONE author for "which booking providers exist". Before this module the
 * provider union was hand-spelled in ~20 places (schema validators, lib
 * types, dispatch UI, email args), so adding a third provider meant finding
 * every site by grep and hoping. Now the id list below is the source: the
 * `CourierProviderId` type, the shared schema validator, the per-country
 * booking gate and the armed-predicate registry (lib/courierBooking.ts) all
 * derive from it, so a new provider that misses an arm is a COMPILE error,
 * not a runtime surprise.
 *
 * What this seam deliberately is NOT: a function-path rewrite. The public
 * Convex modules (convex/lalamove.ts, convex/delyva.ts) keep their paths —
 * deployed clients hold references to them and function paths must not move
 * (docs/cleanup — versioning rule). A new provider adds its own sibling
 * module plus one entry in each registry here.
 */

import { type Infer, v } from "convex/values";
import type { Country } from "./country";

export const COURIER_PROVIDER_IDS = ["lalamove", "delyva", "easyparcel"] as const;

/** Which booking integration ran/runs a job — `deliveryJobs.provider` et al. */
export type CourierProviderId = (typeof COURIER_PROVIDER_IDS)[number];

/**
 * The one schema validator for provider fields. Spelled out (not mapped from
 * the array) so the schema stays greppable; the pin below makes drifting
 * from COURIER_PROVIDER_IDS a compile error instead of a reminder.
 */
export const courierProviderValidator = v.union(
	v.literal("lalamove"),
	v.literal("delyva"),
	v.literal("easyparcel"),
);

type MutuallyAssignable<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;
// Compile-time pin: adding an id to COURIER_PROVIDER_IDS without widening the
// validator (or vice versa) refuses to build.
true satisfies MutuallyAssignable<
	Infer<typeof courierProviderValidator>,
	CourierProviderId
>;

/**
 * Whether a store COUNTRY may book each provider. One row per provider,
 * every country decided explicitly — booking capability is a per-provider
 * judgement, never derived from a pricing-mode list or another provider's
 * row (the two existing providers have disagreed before: Lalamove was
 * MY-only until z8r3fdch3r opened SG). The `Record` shape means a new
 * provider id cannot compile without stating its countries.
 *
 * lalamove — SG went TRUE with z8r3fdch3r. The blockers were ours, and each
 * was closed with evidence, not hope: the Market header follows the store
 * (`lalamoveMarketForCountry`), `toLalamoveContactPhone` accepts each
 * market's own numbers, SGD's one-decimal amounts parse correctly, SG shares
 * UTC+8 so the MYT helpers hold, and our two hardcoded serviceTypes
 * (MOTORCYCLE, CAR) appear verbatim in Lalamove's published SG catalogue.
 * Enforced at the country-switch guard in `retailers.updateSettings` as well
 * as dispatch, so a broken state is visible BEFORE a seller reaches for it
 * (the 86eypncfy lesson).
 *
 * delyva — SG flipped FALSE with EasyParcel SG (z8r3fdcje2 PR2, Oct 2026).
 * It had been true only because the API takes SG addresses unchanged
 * (verified 2 Sep 2026), but the SG tenant ships an EMPTY service catalogue,
 * has no SG sandbox, and delyva.com/sg redirects away — an SG store could
 * connect it and quote nothing. With a real SG parcel lane live, showing the
 * dead integration stopped being harmless. The existing
 * `country_unsupported` plumbing hides every Delyva surface for SG stores;
 * a finished SG job from before stays on the order timeline (the
 * dispatch-surface rule keeps history visible, it only stops NEW bookings).
 *
 * easyparcel — the SG parcel lane (z8r3fdcje2): J&T/SingPost/Qxpress/Ninja
 * Van/Teleport and more through the seller's own EasyParcel SG account.
 * MY flipped TRUE for the cross-border lane (z8r3fdr5yy, Zaki 29 Oct 2026) —
 * but for orders going ABROAD only (`COURIER_DESTINATIONS` below): EasyParcel
 * MY was dropped for domestic on 29 Jul 2026 (frozen/perishable prohibition +
 * indemnity clause — docs/delivery-delyva.md), and Delyva stays MY's domestic
 * courier (cold chain, and its 1% `source: "kedaipal"` commission). Frozen
 * goods can't cross the border anyway — the product opt-out covers them.
 */
export const COUNTRY_COURIER_BOOKING: Record<
	CourierProviderId,
	Record<Country, boolean>
> = {
	lalamove: { MY: true, SG: true },
	delyva: { MY: true, SG: false },
	easyparcel: { MY: true, SG: true },
};

export function courierBookingAllowed(
	provider: CourierProviderId,
	country: Country,
): boolean {
	return COUNTRY_COURIER_BOOKING[provider][country];
}

/**
 * Which ORDERS a provider books for a store in a given country — by where the
 * parcel is going (z8r3fdr5yy). `COUNTRY_COURIER_BOOKING` says whether a store
 * can connect the provider at all; this says which of its orders it may carry:
 *
 *   "domestic" — orders to the store's own country only. Lalamove takes one
 *                market per request; Delyva's API can't be shown to price an
 *                international route (dev runs on its flat-rate demo), so
 *                both stay home until proven otherwise — a one-cell flip.
 *   "abroad"   — cross-border orders only (EasyParcel on a MY store).
 *   "both"     — everything (EasyParcel on an SG store; Delyva SG offers no
 *                courier services, so EasyParcel is SG's only parcel lane).
 */
export type CourierDestinations = "domestic" | "abroad" | "both";

export const COURIER_DESTINATIONS: Record<
	CourierProviderId,
	Record<Country, CourierDestinations>
> = {
	lalamove: { MY: "domestic", SG: "domestic" },
	delyva: { MY: "domestic", SG: "domestic" },
	easyparcel: { MY: "abroad", SG: "both" },
};

/** Can `provider` carry an order from a store in `storeCountry` to an
 * address in `destinationCountry`? */
export function courierServesDestination(
	provider: CourierProviderId,
	storeCountry: Country,
	destinationCountry: Country,
): boolean {
	const scope = COURIER_DESTINATIONS[provider][storeCountry];
	if (scope === "both") return true;
	const abroad = destinationCountry !== storeCountry;
	return scope === "abroad" ? abroad : !abroad;
}
