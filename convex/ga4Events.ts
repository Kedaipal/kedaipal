/**
 * Server-side GA4 key events via the Measurement Protocol (z8r3fdd1v1).
 *
 * Why server-side at all: activation = the retailer's first REAL order
 * reaching confirmed, and subscription revenue lands at admin mark-paid —
 * both happen in Convex, often while the seller's browser is closed, so no
 * client event can ever observe them. `first_order` piggybacks on the
 * existing write-once activation stamp (`stampRetailerActivation`), which IS
 * the once-per-retailer dedupe; `subscribe_paid` rides `invoices.markPaid`.
 *
 * Delivery contract: callers schedule this action fire-and-forget
 * (`ctx.scheduler.runAfter(0, …)`) so analytics can never block or roll back
 * an order or a payment. The action itself no-ops without env config and
 * swallows every failure. Event catalog + GA4 operator steps (api_secret,
 * key-event marking): docs/analytics.md. Seller-facing insights live in
 * `convex/analytics.ts` — a different domain; this file is Kedaipal's own
 * acquisition telemetry.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
	GA4_MP_ENDPOINT,
	buildMpPayload,
	isValidGaClientId,
	syntheticGaClientId,
} from "./lib/ga4";

export const sendKeyEvent = internalAction({
	args: {
		event: v.union(v.literal("first_order"), v.literal("subscribe_paid")),
		retailerId: v.id("retailers"),
		// The retailer's real GA client id captured at signup, when present —
		// lets Funnel Exploration stitch this event to their client-side journey.
		gaClientId: v.optional(v.string()),
		// The retailer's stored acquisition tag (retailers.signupSource).
		src: v.optional(v.string()),
		params: v.optional(
			v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
		),
	},
	handler: async (_ctx, args): Promise<null> => {
		const measurementId = process.env.GA4_MEASUREMENT_ID;
		const apiSecret = process.env.GA4_MP_API_SECRET;
		// Unconfigured (local dev, preview) → silent no-op, same posture as the
		// client-side providers. Both vars are required; half-set is unconfigured.
		if (!measurementId || !apiSecret) return null;

		const clientId =
			args.gaClientId !== undefined && isValidGaClientId(args.gaClientId)
				? args.gaClientId
				: syntheticGaClientId(args.retailerId);

		const url = `${GA4_MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
		const payload = buildMpPayload({
			clientId,
			event: args.event,
			src: args.src,
			params: args.params,
		});

		try {
			// MP replies 2xx even for malformed events (validation is offline via
			// the debug endpoint), so a non-ok status here means transport trouble.
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				console.error(
					`GA4 MP send failed for ${args.event}: HTTP ${res.status}`,
				);
			}
		} catch (err) {
			console.error(`GA4 MP send failed for ${args.event}`, err);
		}
		return null;
	},
});
