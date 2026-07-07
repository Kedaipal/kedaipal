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
