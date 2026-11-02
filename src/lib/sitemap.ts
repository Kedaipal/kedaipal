/**
 * Pure sitemap.xml builder (86eyheqzv). Extracted from the route so the XML
 * shape is unit-testable; the route's server GET handler supplies live data
 * and returns this as a `Response`.
 *
 * Slugs are validated lowercase [a-z0-9-] at write time (store + product +
 * category), so no XML escaping is needed in <loc> values.
 *
 * Which stores appear is NOT decided here: the Convex queries apply the one
 * storefront index rule (`convex/lib/storefrontIndex.ts`, z8r3fdh2ye) and
 * this file lists what it is given.
 */

export interface SitemapStore {
	slug: string;
	updatedAt: number;
}

export interface SitemapProduct {
	storeSlug: string;
	productSlug: string;
	updatedAt: number;
}

export interface SitemapCategory {
	storeSlug: string;
	categorySlug: string;
	updatedAt: number;
}

/**
 * The seller setup guides in `public/guides/` — static HTML, so the route
 * can't discover them; listed here so they are crawlable (z8r3fdh2ye). Low
 * priority: they answer a vendor's setup question, not a buyer's or a
 * prospect's. Add a guide here when it is added to `public/guides/`.
 */
export const GUIDE_PATHS = [
	"/guides/hitpay-setup.html",
	"/guides/lalamove-setup.html",
	"/guides/delyva-setup.html",
] as const;

function day(ms: number): string {
	return new Date(ms).toISOString().split("T")[0];
}

export function buildSitemapXml({
	siteUrl,
	stores,
	products,
	categories = [],
}: {
	siteUrl: string;
	stores: SitemapStore[];
	products: SitemapProduct[];
	categories?: SitemapCategory[];
}): string {
	const urls = [
		`  <url>\n    <loc>${siteUrl}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/pricing</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
		// Marketplace home (z8r3fdkmyp) — the buyer-facing store directory. Daily:
		// its content is the store list, which moves as often as the stores do.
		`  <url>\n    <loc>${siteUrl}/stores</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/cost</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
		// Legal pack (86eyn25gu): public policies should be crawlable — the
		// Privacy Policy is linked from every checkout and WhatsApp notice.
		`  <url>\n    <loc>${siteUrl}/privacy</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/terms</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/acceptable-use</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		...GUIDE_PATHS.map(
			(path) =>
				`  <url>\n    <loc>${siteUrl}${path}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.4</priority>\n  </url>`,
		),
		...stores.map(
			({ slug, updatedAt }) =>
				`  <url>\n    <loc>${siteUrl}/${slug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`,
		),
		// Category pages (z8r3fdh2ye): SSR'd with their own meta and a
		// BreadcrumbList, between the store home and its product leaves.
		...categories.map(
			({ storeSlug, categorySlug, updatedAt }) =>
				`  <url>\n    <loc>${siteUrl}/${storeSlug}/c/${categorySlug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
		),
		// Product pages (86eybrhrt PR2). Priority sits below the store home —
		// the storefront is the entry a seller shares, a product page is a leaf
		// — but they're the pages carrying `Product` JSON-LD, so Google needs to
		// know they exist. `weekly`: price/stock move, the page itself rarely.
		...products.map(
			({ storeSlug, productSlug, updatedAt }) =>
				`  <url>\n    <loc>${siteUrl}/${storeSlug}/p/${productSlug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
		),
	];

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		"</urlset>",
	].join("\n");
}
