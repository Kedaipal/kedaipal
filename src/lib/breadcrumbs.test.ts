import { describe, expect, test } from "vitest";
import {
	breadcrumbListJsonLd,
	categoryCrumbs,
	productCrumbs,
} from "./breadcrumbs";

const SITE = "https://kedaipal.com";

describe("breadcrumbs", () => {
	test("category page: Store › Category, 1-based positions", () => {
		const ld = breadcrumbListJsonLd(
			categoryCrumbs({
				siteUrl: SITE,
				storeName: "K Frozen Food",
				storeSlug: "k-frozen-food",
				categoryName: "Ayam",
				categorySlug: "ayam",
			}),
		);
		expect(ld["@type"]).toBe("BreadcrumbList");
		expect(ld.itemListElement).toEqual([
			{
				"@type": "ListItem",
				position: 1,
				name: "K Frozen Food",
				item: `${SITE}/k-frozen-food`,
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Ayam",
				item: `${SITE}/k-frozen-food/c/ayam`,
			},
		]);
	});

	test("product page with a category: Store › Category › Product", () => {
		const crumbs = productCrumbs({
			siteUrl: SITE,
			storeName: "K Frozen Food",
			storeSlug: "k-frozen-food",
			category: { name: "Ayam", slug: "ayam" },
			productName: "Ayam Goreng",
			productUrl: `${SITE}/k-frozen-food/p/ayam-goreng`,
		});
		expect(crumbs.map((c) => c.name)).toEqual([
			"K Frozen Food",
			"Ayam",
			"Ayam Goreng",
		]);
		expect(crumbs[2].url).toBe(`${SITE}/k-frozen-food/p/ayam-goreng`);
	});

	test("product with no category: two levels, no null item", () => {
		const ld = breadcrumbListJsonLd(
			productCrumbs({
				siteUrl: SITE,
				storeName: "S",
				storeSlug: "s",
				category: null,
				productName: "P",
				productUrl: `${SITE}/s/p/p`,
			}),
		);
		expect(ld.itemListElement).toHaveLength(2);
		expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2]);
		for (const item of ld.itemListElement) expect(item.item).toBeTruthy();
	});
});
