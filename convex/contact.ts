import { query } from "./_generated/server";
import { resolveSupportWaNumber } from "./lib/contact";

/**
 * Kedaipal's own support WhatsApp number — the one a human answers, backing
 * every seller→Kedaipal CTA (landing/pricing founding enquiries, billing
 * support, upgrades, white-glove, sending-paused).
 *
 * Configured per deployment via `SUPPORT_WA_PHONE` so it can be changed in the
 * Convex dashboard without a deploy; unset ⇒ `DEFAULT_SUPPORT_WA_NUMBER`.
 *
 * **Unauthenticated on purpose** — the landing, pricing and cost pages render
 * these CTAs to signed-out visitors, and the number is public by nature (it's
 * printed on the marketing pages). It is deliberately NOT
 * `WHATSAPP_CHECKOUT_PHONE`: that's the shared WABA sender that talks to
 * *buyers*, so a seller messaging it reaches the order bot, not support.
 */
export const supportWhatsapp = query({
	args: {},
	handler: async (): Promise<string> =>
		resolveSupportWaNumber(process.env.SUPPORT_WA_PHONE),
});
