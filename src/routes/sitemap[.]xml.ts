import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

export const Route = createFileRoute("/sitemap.xml")({
	loader: async () => {
		const client = getConvexHttpClient();
		const slugs = await client.query(api.retailers.listSlugsForSitemap);

		const urls = [
			`  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
			`  <url>\n    <loc>${SITE_URL}/pricing</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
			`  <url>\n    <loc>${SITE_URL}/cost</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
			...slugs.map(({ slug, updatedAt }) => {
				const lastmod = new Date(updatedAt).toISOString().split("T")[0];
				return `  <url>\n    <loc>${SITE_URL}/${slug}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`;
			}),
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
