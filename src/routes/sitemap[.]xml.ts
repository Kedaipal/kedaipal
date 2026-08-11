import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { buildSitemapXml } from "../lib/sitemap";

/**
 * /sitemap.xml — served by a server GET handler returning the XML Response
 * directly (86eyheqzv). The previous implementation `throw`ed the Response
 * from a loader, which the current TanStack version treats as a route ERROR:
 * prod served a 500 error page instead of XML, so every storefront + product
 * URL was invisible to crawlers. `server.handlers` is the sanctioned
 * raw-response path — no loader run, no component render involved. The XML
 * shape itself lives in `src/lib/sitemap.ts` where it's unit-tested.
 */
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async () => {
				const client = getConvexHttpClient();
				const [stores, products] = await Promise.all([
					client.query(api.retailers.listSlugsForSitemap),
					client.query(api.products.listForSitemap),
				]);
				return new Response(
					buildSitemapXml({ siteUrl: SITE_URL, stores, products }),
					{
						status: 200,
						headers: {
							"Content-Type": "application/xml; charset=utf-8",
							"Cache-Control": "public, max-age=3600",
						},
					},
				);
			},
		},
	},
	component: () => null,
});
