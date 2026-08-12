/**
 * Kedaipal's own WhatsApp number — the one a human answers. Used by every
 * seller→Kedaipal CTA: landing/pricing founding-spot enquiries AND in-app
 * support (billing, upgrades, white-glove, sending paused). Deliberately NOT
 * `WHATSAPP_CHECKOUT_PHONE` — that's the shared WABA sender that talks to
 * *buyers*; messaging it reaches a bot, not support.
 * wa.me requires digits only — country code, no `+` or spaces (+60 18-473 5095).
 */
export const SUPPORT_WA_NUMBER = "60184735095";

/** Build a wa.me deep link with a prefilled message. */
export function buildWaContactLink(message: string): string {
	return `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(message)}`;
}
