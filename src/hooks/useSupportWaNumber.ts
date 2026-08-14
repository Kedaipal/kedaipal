import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DEFAULT_SUPPORT_WA_NUMBER } from "../lib/contact";

/**
 * Kedaipal's support WhatsApp number for seller→Kedaipal CTAs, as configured on
 * this deployment (`SUPPORT_WA_PHONE`).
 *
 * Falls back to the built-in default while the query is in flight and during
 * SSR — the CTA is often a seller's only route to us, so it must render a live
 * link on the first paint rather than wait or disappear (the
 * `getSpotsRemaining ?? TOTAL_SPOTS` pattern on the landing page).
 *
 * Call it at the top level of the component and pass the result to
 * `buildWaContactLink` — several call sites build their message inside a branch
 * or after an early return, where a hook can't go.
 */
export function useSupportWaNumber(): string {
	return useQuery(api.contact.supportWhatsapp) ?? DEFAULT_SUPPORT_WA_NUMBER;
}
