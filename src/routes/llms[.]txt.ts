import { createFileRoute } from "@tanstack/react-router";
import { FAQ_MESSAGES } from "../components/landing/faq";
import { SITE_URL } from "../lib/convex-server";
import { FAQ_PRIMARY_IDS } from "../lib/landing-faq";
import { buildLlmsTxt } from "../lib/llms-txt";

/**
 * /llms.txt — the one page an answer engine reads to learn what Kedaipal is,
 * who it is for and what it costs (z8r3fdh2yt). A server GET handler like
 * `sitemap[.]xml.ts`, because the body reads live billing constants and the
 * English FAQ catalog; a static file would be a second copy of the prices.
 */
export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: async () => {
				const faq = FAQ_PRIMARY_IDS.map((id) => ({
					q: FAQ_MESSAGES[id].q({}, { locale: "en" }),
					a: FAQ_MESSAGES[id].a({}, { locale: "en" }),
				}));
				return new Response(buildLlmsTxt({ siteUrl: SITE_URL, faq }), {
					status: 200,
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
	component: () => null,
});
