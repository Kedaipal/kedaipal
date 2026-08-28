import { describe, expect, test } from "vitest";
import { buildSitemapXml } from "./sitemap";

const SITE = "https://kedaipal.com";

describe("buildSitemapXml", () => {
	test("always lists the static marketing pages", () => {
		const xml = buildSitemapXml({ siteUrl: SITE, stores: [], products: [] });
		expect(xml).toContain("<?xml version=");
		expect(xml).toContain(`<loc>${SITE}/</loc>`);
		expect(xml).toContain(`<loc>${SITE}/pricing</loc>`);
		expect(xml).toContain(`<loc>${SITE}/cost</loc>`);
		// Legal pack (86eyn25gu) — the Privacy Policy is linked from every
		// checkout and WhatsApp notice, so crawlers must be able to find it.
		expect(xml).toContain(`<loc>${SITE}/privacy</loc>`);
		expect(xml).toContain(`<loc>${SITE}/terms</loc>`);
		expect(xml).toContain(`<loc>${SITE}/acceptable-use</loc>`);
		expect(xml.trim().endsWith("</urlset>")).toBe(true);
	});

	test("lists store and product URLs with day-precision lastmod", () => {
		const xml = buildSitemapXml({
			siteUrl: SITE,
			stores: [{ slug: "k-frozen-food", updatedAt: Date.UTC(2026, 6, 30) }],
			products: [
				{
					storeSlug: "k-frozen-food",
					productSlug: "ayam-goreng",
					updatedAt: Date.UTC(2026, 7, 1, 15, 30),
				},
			],
		});
		expect(xml).toContain(`<loc>${SITE}/k-frozen-food</loc>`);
		expect(xml).toContain("<lastmod>2026-07-30</lastmod>");
		expect(xml).toContain(`<loc>${SITE}/k-frozen-food/p/ayam-goreng</loc>`);
		// Time-of-day is truncated — sitemap lastmod is a date.
		expect(xml).toContain("<lastmod>2026-08-01</lastmod>");
		expect(xml).not.toContain("15:30");
	});

	test("store pages outrank product pages in priority", () => {
		const xml = buildSitemapXml({
			siteUrl: SITE,
			stores: [{ slug: "s", updatedAt: 0 }],
			products: [{ storeSlug: "s", productSlug: "p", updatedAt: 0 }],
		});
		const storeIdx = xml.indexOf(`<loc>${SITE}/s</loc>`);
		const productIdx = xml.indexOf(`<loc>${SITE}/s/p/p</loc>`);
		expect(storeIdx).toBeGreaterThan(-1);
		expect(productIdx).toBeGreaterThan(storeIdx);
		expect(xml.slice(storeIdx, productIdx)).toContain(
			"<priority>0.8</priority>",
		);
		expect(xml.slice(productIdx)).toContain("<priority>0.6</priority>");
	});
});
