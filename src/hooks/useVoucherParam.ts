import { useEffect } from "react";
import { parseVoucherCode } from "../../convex/lib/vouchers";

/**
 * Carry a `?voucher=` code across the storefront (`z8r3fdr617`) — the sibling
 * of `useSourceAttribution`, and for the same structural reason: a param that
 * arrives on ONE hit has to survive the browsing that follows it.
 *
 * The link in a voucher's share sheet points at checkout, because that is
 * where the code is spent. But the buyer it is sent to on WhatsApp has an
 * EMPTY cart — they tap the link, land on "Your cart is empty · Browse the
 * store", and in-store navigation carries no params. Without this, the code
 * the seller just gave them is gone by the time they have something to buy,
 * and nothing on screen ever said so.
 *
 * So every storefront route captures it, checkout reads it back, and the
 * empty-cart panel says the voucher is being held. Stored CANONICAL
 * (`parseVoucherCode`), so junk in the URL is dropped at the door rather
 * than surfacing as a refusal three pages later.
 *
 * sessionStorage, keyed per store: two shops in one browser can't cross-apply
 * a code, it dies with the tab, and it is best-effort throughout — storage
 * being unavailable (private modes) must never break browsing or checkout.
 */

const PARAM = "voucher";
const storageKey = (slug: string) => `kedaipal:voucher:${slug}`;

/** Capture this visit's `?voucher=` for the store, if it carries a real one. */
export function useCaptureVoucherParam(slug: string | undefined): void {
	useEffect(() => {
		if (!slug) return;
		try {
			const raw = new URLSearchParams(window.location.search).get(PARAM);
			if (!raw) return;
			// Either spelling — a single-use `KP-…` or a shared word.
			const code = parseVoucherCode(raw)?.code;
			// A code that can't be one of ours is dropped, NOT stored — otherwise
			// the buyer meets a refusal at checkout for a typo in a link they
			// never wrote. A later hit with a real code overwrites (last touch,
			// the attribution rule); a hit with none leaves the held code alone,
			// because in-store navigation never carries the param.
			if (code) sessionStorage.setItem(storageKey(slug), code);
		} catch {
			// Storage/URL access denied — best-effort, never fatal.
		}
	}, [slug]);
}

/** The code this session is holding for `slug`, if any. */
export function readVoucherParam(slug: string): string | undefined {
	try {
		return sessionStorage.getItem(storageKey(slug)) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Forget it — called once the code has been spent on an order, so a second
 * checkout in the same tab doesn't silently re-apply a voucher that is now
 * redeemed and would be refused. */
export function clearVoucherParam(slug: string): void {
	try {
		sessionStorage.removeItem(storageKey(slug));
	} catch {
		// Best-effort.
	}
}
