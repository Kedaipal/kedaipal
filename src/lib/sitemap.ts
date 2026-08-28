/**
 * Pure sitemap.xml builder (86eyheqzv). Extracted from the route so the XML
 * shape is unit-testable; the route's server GET handler supplies live data
 * and returns this as a `Response`.
 *
 * Slugs are validated lowercase [a-z0-9-] at write time (store + product +
 * category), so no XML escaping is needed in <loc> values.
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

function day(ms: number): string {
	return new Date(ms).toISOString().split("T")[0];
}

export function buildSitemapXml({
	siteUrl,
	stores,
	products,
}: {
	siteUrl: string;
	stores: SitemapStore[];
	products: SitemapProduct[];
}): string {
	const urls = [
		`  <url>\n    <loc>${siteUrl}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/pricing</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/cost</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
		// Legal pack (86eyn25gu): public policies should be crawlable — the
		// Privacy Policy is linked from every checkout and WhatsApp notice.
		`  <url>\n    <loc>${siteUrl}/privacy</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/terms</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		`  <url>\n    <loc>${siteUrl}/acceptable-use</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
		...stores.map(
			({ slug, updatedAt }) =>
				`  <url>\n    <loc>${siteUrl}/${slug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`,
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
