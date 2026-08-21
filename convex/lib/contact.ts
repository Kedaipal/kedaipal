import { assertValidMyMobile } from "./slug";

/**
 * Fallback for Kedaipal's own support WhatsApp number, used when
 * `SUPPORT_WA_PHONE` is unset or unusable.
 *
 * This is a real number, not a placeholder: the seller→Kedaipal CTAs it backs
 * (billing support, upgrades, white-glove, sending-paused) must never render a
 * dead link, and it is also what SSR emits before the client query resolves.
 * So when the number changes for good, set the env var (takes effect
 * immediately, no deploy) AND update this constant in the next PR — otherwise
 * server-rendered HTML keeps carrying the old one until hydration.
 */
export const DEFAULT_SUPPORT_WA_NUMBER = "60184735095";

/**
 * Read the support number an operator configured, normalized to the wa.me form
 * (digits only, country code, no `+`).
 *
 * Deliberately non-throwing: this is read on every landing/pricing/app render,
 * and a typo in an env var must degrade to the fallback rather than break the
 * only way a seller can reach us. A rejected value is logged so the mistake is
 * visible in the Convex logs instead of silently ignored.
 *
 * Deliberately MY-only even after SG-lite (86eynw28q): this validates
 * KEDAIPAL's own support line, not seller data — the platform's contact number
 * is Malaysian regardless of which countries its stores operate in.
 */
export function resolveSupportWaNumber(raw: string | undefined): string {
	const trimmed = raw?.trim();
	if (!trimmed) return DEFAULT_SUPPORT_WA_NUMBER;
	try {
		return assertValidMyMobile(trimmed);
	} catch {
		console.warn(
			`SUPPORT_WA_PHONE is not a valid Malaysian mobile number (${trimmed}) — falling back to the built-in support number`,
		);
		return DEFAULT_SUPPORT_WA_NUMBER;
	}
}
