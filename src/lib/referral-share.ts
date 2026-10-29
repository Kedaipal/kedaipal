/**
 * The referral share kit's small shared pieces (the 28 Oct 2026 push,
 * docs/referrals.md) — used by the Home teaser and the Refer & earn page so
 * the two can never build the WhatsApp link differently.
 */

/** A `wa.me` share link with the message pre-filled — the recipient is
 * picked in WhatsApp, which is where a referral actually travels. */
export function waShareHref(message: string): string {
	return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The referee's WhatsApp, for a nudge from the referrer. `null` when the
 * store never set one (then there is nothing to tap). */
export function waChatHref(phone: string | null): string | null {
	const digits = (phone ?? "").replace(/\D/g, "");
	return digits.length > 0 ? `https://wa.me/${digits}` : null;
}

/**
 * Copy text, reporting whether it landed. The clipboard API is absent off
 * HTTPS and in some in-app browsers; the caller keeps the text on screen so
 * a `false` is never a dead end.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** The share image's file name: `refer-<slug>.png`. */
export function shareImageFilename(slug: string): string {
	return `refer-${slug}.png`;
}
