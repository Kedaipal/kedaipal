/**
 * Founding Member WhatsApp number for direct-contact CTAs. wa.me requires
 * digits only — country code, no `+` or spaces (+60 18-473 5095).
 */
export const FOUNDING_WA_NUMBER = "60184735095";

/** Build a wa.me deep link with a prefilled message. */
export function buildWaContactLink(message: string): string {
	return `https://wa.me/${FOUNDING_WA_NUMBER}?text=${encodeURIComponent(message)}`;
}
