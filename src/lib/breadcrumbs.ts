/**
 * `BreadcrumbList` JSON-LD for the storefront subpages (z8r3fdh2z3).
 *
 * Without it a product result in Google shows the bare URL path; with it the
 * result reads Store › Category › Product. One author so the category page
 * and the product page agree on the shape, and so a product with no category
 * gets a two-level trail rather than a null item.
 *
 * `item` is the canonical URL the loader already computed — never rebuilt
 * here, so the breadcrumb can't disagree with `<link rel="canonical">`.
 */

export interface Crumb {
	name: string;
	url: string;
}

export function breadcrumbListJsonLd(crumbs: readonly Crumb[]): {
	"@context": "https://schema.org";
	"@type": "BreadcrumbList";
	itemListElement: Array<{
		"@type": "ListItem";
		position: number;
		name: string;
		item: string;
	}>;
} {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: crumbs.map((crumb, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: crumb.name,
			item: crumb.url,
		})),
	};
}

/** Store › Category. */
export function categoryCrumbs(args: {
	siteUrl: string;
	storeName: string;
	storeSlug: string;
	categoryName: string;
	categorySlug: string;
}): Crumb[] {
	const store = `${args.siteUrl}/${args.storeSlug}`;
	return [
		{ name: args.storeName, url: store },
		{ name: args.categoryName, url: `${store}/c/${args.categorySlug}` },
	];
}

/** Store › (Category ›) Product — the category level only when the product
 * has a visible one; a missing category shortens the trail, never leaves a
 * hole in it. */
export function productCrumbs(args: {
	siteUrl: string;
	storeName: string;
	storeSlug: string;
	category: { name: string; slug: string } | null;
	productName: string;
	productUrl: string;
}): Crumb[] {
	const store = `${args.siteUrl}/${args.storeSlug}`;
	return [
		{ name: args.storeName, url: store },
		...(args.category
			? [
					{
						name: args.category.name,
						url: `${store}/c/${args.category.slug}`,
					},
				]
			: []),
		{ name: args.productName, url: args.productUrl },
	];
}
