import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

export const Route = createFileRoute("/sitemap.xml")({
	loader: async () => {
		const client = getConvexHttpClient();
		const [slugs, products] = await Promise.all([
			client.query(api.retailers.listSlugsForSitemap),
			client.query(api.products.listForSitemap),
		]);
		const day = (ms: number) => new Date(ms).toISOString().split("T")[0];

		const urls = [
			`  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
			`  <url>\n    <loc>${SITE_URL}/pricing</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
			`  <url>\n    <loc>${SITE_URL}/cost</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
			...slugs.map(
				({ slug, updatedAt }) =>
					`  <url>\n    <loc>${SITE_URL}/${slug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`,
			),
			// Product pages (86eybrhrt PR2). Priority sits below the store home —
			// the storefront is the entry a seller shares, a product page is a leaf
			// — but they're the pages carrying `Product` JSON-LD, so Google needs to
			// know they exist. `weekly`: price/stock move, the page itself rarely.
			...products.map(
				({ storeSlug, productSlug, updatedAt }) =>
					`  <url>\n    <loc>${SITE_URL}/${storeSlug}/p/${productSlug}</loc>\n    <lastmod>${day(updatedAt)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
			),
		];

		const xml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
			...urls,
			"</urlset>",
		].join("\n");

		throw new Response(xml, {
			status: 200,
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		});
	},
	component: () => null,
});
