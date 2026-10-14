/**
 * Canonical construction of the buyer-facing storefront URL.
 *
 * The dashboard runs on the same origin as the storefront, so in the browser
 * we use `window.location.origin` (keeps dev/preview links working); during
 * SSR we fall back to the production domain.
 */

const PRODUCTION_ORIGIN = "https://kedaipal.com";

export function storefrontOrigin(): string {
	// Some server runtimes define a `window` global without `location`, so
	// guard both before trusting it.
	if (typeof window === "undefined" || !window.location) {
		return PRODUCTION_ORIGIN;
	}
	return window.location.origin;
}

export function storefrontUrl(slug: string): string {
	return `${storefrontOrigin()}/${slug}`;
}

/**
 * Checkout, with a voucher already applied (`z8r3fdr617`) — the "link" of the
 * share sheet's code/QR/link trio, and what a buyer shopping on their own phone
 * needs (they can't scan their own screen). One author, so the share sheet, the
 * WhatsApp message and any future send build the same URL; the checkout route
 * reads the param back through `?voucher=`.
 */
export function voucherCheckoutUrl(slug: string, code: string): string {
	return `${storefrontUrl(slug)}/checkout?voucher=${encodeURIComponent(code)}`;
}
