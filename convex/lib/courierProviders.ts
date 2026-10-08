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

export const COURIER_PROVIDER_IDS = ["lalamove", "delyva"] as const;

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
 * delyva — SG is true because the API takes SG addresses unchanged (verified
 * 2 Sep 2026: a country:"SG" quote with a 6-digit postal code returns a
 * well-formed 200), but the SG tenant ships an EMPTY service catalogue, has
 * no SG sandbox, and delyva.com/sg redirects away — bring-your-own-courier
 * in practice. It stays true only because it costs nothing and works for a
 * seller who brings their own courier; no SG launch should depend on it, and
 * it flips FALSE when EasyParcel SG lands (z8r3fdcje2 PR2) so SG sellers
 * stop being shown a dead integration.
 */
export const COUNTRY_COURIER_BOOKING: Record<
	CourierProviderId,
	Record<Country, boolean>
> = {
	lalamove: { MY: true, SG: true },
	delyva: { MY: true, SG: true },
};

export function courierBookingAllowed(
	provider: CourierProviderId,
	country: Country,
): boolean {
	return COUNTRY_COURIER_BOOKING[provider][country];
}
