import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { type Locale, OG_LOCALE } from "../../convex/lib/locale";
import { CartBar } from "../components/storefront/cart-bar";
import { ProductGrid } from "../components/storefront/product-grid";
import {
	OrderingPausedProvider,
	SeasonalBreakNotice,
} from "../components/storefront/seasonal-break";
import { HomeOnlyLabelProvider } from "../components/storefront/ships-abroad";
import {
	StoreUnavailable,
	type StoreUnavailableLoaderData,
	storeUnavailableHead,
} from "../components/storefront/store-unavailable";
import { StorefrontAppBar } from "../components/storefront/storefront-app-bar";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { useCaptureAttribution } from "../hooks/useSourceAttribution";
import { useCaptureVoucherParam } from "../hooks/useVoucherParam";
import { breadcrumbListJsonLd, categoryCrumbs } from "../lib/breadcrumbs";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { absoluteProxiedImageUrl } from "../lib/image-proxy";
import { jsonLdScript } from "../lib/json-ld";
import { missOwnedElsewhere } from "../lib/not-found";
import { seoDescription } from "../lib/seo-text";
import { ssrRead } from "../lib/ssr-read";

interface CategoryLoaderData {
	storeName: string;
	slug: string;
	categoryName: string;
	categorySlug: string;
	description: string;
	canonicalUrl: string;
	indexable: boolean;
	productSlugs: string[];
	ogImageUrl: string | undefined;
	locale: Locale;
}

/**
 * Nested storefront category page — /$slug/c/$categorySlug. The `$slug_`
 * filename (pathless-parent underscore) gives the URL prefix WITHOUT nesting
 * under $slug.tsx, which is a leaf route with no <Outlet/>. Shares the home
 * page's cart (useCart is keyed per retailerId in localStorage), cards, product
 * pages and checkout — only the product set is scoped to the category.
 */
export const Route = createFileRoute("/$slug_/c/$categorySlug")({
	loader: async ({
		params,
	}): Promise<CategoryLoaderData | StoreUnavailableLoaderData | null> => {
		const client = getConvexHttpClient();
		const retailerRead = await ssrRead(() =>
			client.query(api.retailers.getRetailerBySlug, { slug: params.slug }),
		);
		// Transient upstream failure: render the shell (client query paints the
		// category) instead of an error page (86eyheqzv). Definitive notFounds
		// below still 404.
		if (!retailerRead.ok) return null;
		const result = retailerRead.value;

		// Renamed store → keep the buyer on the same category under the new slug.
		if (result.status === "redirect") {
			throw redirect({
				to: "/$slug/c/$categorySlug",
				params: { slug: result.to, categorySlug: params.categorySlug },
				statusCode: 301,
			});
		}
		if (result.status === "notFound") {
			throw notFound();
		}
		// Taken offline by Kedaipal (z8r3fdudf7): no store data to preload —
		// the component renders the neutral unavailable page, and head()
		// takes it out of search in the SSR HTML.
		if (result.status === "unavailable")
			return { unavailable: true, storeName: result.storeName };
		const retailer = result.retailer;

		// Unknown or archived category → 404, never a silent empty page.
		const pageRead = await ssrRead(() =>
			client.query(api.categories.getPublicPage, {
				retailerId: retailer._id,
				categorySlug: params.categorySlug,
			}),
		);
		if (!pageRead.ok) return null;
		const page = pageRead.value;
		if (page === null) {
			throw notFound();
		}

		const categoryDescription = seoDescription(page.category.description);
		const description =
			categoryDescription ||
			`Browse ${page.category.name} from ${retailer.storeName} on Kedaipal and order on WhatsApp.`;

		return {
			storeName: retailer.storeName,
			slug: retailer.slug,
			categoryName: page.category.name,
			categorySlug: page.category.slug,
			description,
			canonicalUrl: `${SITE_URL}/${retailer.slug}/c/${page.category.slug}`,
			// The sitemap's rule, repeated as `noindex` (see $slug.tsx) — and an
			// empty category is a thin page whatever the store's standing.
			indexable: (retailer.indexable ?? true) && page.products.length > 0,
			// Product URLs for the ItemList: what a crawler that runs no JS can
			// still discover from this page.
			productSlugs: page.products.map((p) => p.slug),
			// Share-image precedence: the category's own image → store cover → logo.
			// Proxied like every other social card — see $slug.tsx for why.
			ogImageUrl: ((): string | undefined => {
				const raw =
					page.category.imageUrl ??
					retailer.coverImageUrl ??
					retailer.logoUrl ??
					undefined;
				return raw ? absoluteProxiedImageUrl(raw, SITE_URL) : undefined;
			})(),
			locale: retailer.locale ?? "en",
		};
	},
	head: ({ loaderData, match, matches }) => {
		// Matched only on the way to a URL nothing claims (`/x/p/y/extra`):
		// the page is the root's "Page not found", so this head stays out.
		if (missOwnedElsewhere(matches, match)) return {};
		if (!loaderData) return {};
		if ("unavailable" in loaderData)
			return storeUnavailableHead(loaderData.storeName);
		const {
			storeName,
			slug,
			categoryName,
			categorySlug,
			description,
			canonicalUrl,
			indexable,
			productSlugs,
			ogImageUrl,
			locale,
		} = loaderData;
		const title = `${categoryName} — ${storeName} | Kedaipal`;

		const meta = [
			{ title },
			{ name: "description", content: description },
			{
				name: "robots",
				content: indexable ? "index, follow" : "noindex, follow",
			},
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Kedaipal" },
			{ property: "og:locale", content: OG_LOCALE[locale] },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			{
				name: "twitter:card",
				content: ogImageUrl ? "summary_large_image" : "summary",
			},
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
		];
		if (ogImageUrl) {
			meta.push(
				{ property: "og:image", content: ogImageUrl },
				{ property: "og:image:alt", content: `${categoryName} — ${storeName}` },
				{ name: "twitter:image", content: ogImageUrl },
			);
		}
		const store = `${SITE_URL}/${slug}`;
		return {
			meta,
			// No cover preload here (z8r3fdegb5): the compact app bar carries no
			// cover image, so the page's LCP element is a product photo — the old
			// hint made every category deep link download a banner it never shows.
			links: [{ rel: "canonical", href: canonicalUrl }],
			// Store › Category, so the result reads as a trail, not a URL path
			// (z8r3fdh2z3).
			scripts: [
				jsonLdScript(
					breadcrumbListJsonLd(
						categoryCrumbs({
							siteUrl: SITE_URL,
							storeName,
							storeSlug: slug,
							categoryName,
							categorySlug,
						}),
					),
				),
				// The category's products as an ItemList of URLs: the body is
				// client-rendered, so this is how a crawler that runs no JS learns
				// the product pages exist from here (storefront SEO audit).
				jsonLdScript({
					"@context": "https://schema.org",
					"@type": "ItemList",
					name: categoryName,
					url: canonicalUrl,
					numberOfItems: productSlugs.length,
					itemListElement: productSlugs.map((productSlug, i) => ({
						"@type": "ListItem",
						position: i + 1,
						url: `${store}/p/${productSlug}`,
					})),
				}),
			],
		};
	},
	notFoundComponent: CategoryNotFound,
	component: CategoryRoute,
});

function CategoryNotFound() {
	const { slug } = Route.useParams();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 text-center">
			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<h1 className="text-3xl font-bold">Category not found</h1>
				<p className="text-sm text-muted-foreground">
					This category may have been renamed or removed — the store's full
					catalog is still open.
				</p>
				<Link
					to="/$slug"
					params={{ slug }}
					activeOptions={{ exact: true }}
					className="mt-1 inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-medium text-background"
				>
					Browse all products
				</Link>
			</div>
			<StorefrontFooter slug={slug} />
		</main>
	);
}

function CategorySkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-32">
			{/* Mirrors the compact StorefrontAppBar so the swap-in is seamless. */}
			<header className="border-b border-border">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:h-16">
					<Skeleton className="size-6 rounded-full" />
					<Skeleton className="size-8 rounded-[10px]" />
					<Skeleton className="h-4 w-32" />
				</div>
			</header>
			<div className="flex flex-col gap-3 px-5 pt-4 lg:px-8">
				<Skeleton className="h-8 w-48" />
			</div>
			<section className="mt-2 px-5 lg:px-8">
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{[0, 1, 2, 3].map((n) => (
						<Skeleton key={n} className="aspect-square w-full rounded-2xl" />
					))}
				</div>
			</section>
		</div>
	);
}

function CategoryRoute() {
	const { slug, categorySlug } = Route.useParams();
	// Category deep links get shared too — capture the ?src= tag here as well.
	useCaptureAttribution(slug);
	// A `?voucher=` link lands on an EMPTY cart, so the code has to survive the
	// browsing that follows (`z8r3fdr617`) — same reason as the line above.
	useCaptureVoucherParam(slug);
	// Live queries keep the page reactive after the SSR'd loader response.
	const result = useQuery(
		convexQuery(api.retailers.getRetailerBySlug, { slug }),
	).data;
	const retailer = result?.status === "ok" ? result.retailer : undefined;
	const page = useQuery(
		convexQuery(
			api.categories.getPublicPage,
			retailer ? { retailerId: retailer._id, categorySlug } : "skip",
		),
	).data;
	// Same per-retailer cart as the store home — items carry across pages.
	const cart = useCart(retailer?._id);

	if (result?.status === "unavailable") {
		return <StoreUnavailable storeName={result.storeName} />;
	}
	if (!retailer || page === undefined) {
		return <CategorySkeleton />;
	}
	if (page === null) {
		// The category was archived/renamed while the buyer had the page open.
		return <CategoryNotFound />;
	}

	return (
		<OrderingPausedProvider
			paused={retailer.orderingPaused === true}
			pausedBy={retailer.orderingPausedBy}
		>
			<HomeOnlyLabelProvider
				storeCountry={retailer.country}
				shipsAbroadTo={retailer.shipsAbroadTo}
			>
				{/* pb-28 keeps ≥96px clear for the floating cart pill (z8r3fdegb5). */}
				<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-28">
					{/* Compact app bar (z8r3fdegb5): whose store this is, the way back,
			    and share — the 176px cover hero stays on the store home so this
			    deep link's first screen belongs to the category. The bar owns
			    "back", so the old "← All products" text link is gone. */}
					<StorefrontAppBar
						retailer={retailer}
						slug={retailer.slug}
						shareUrl={`/${retailer.slug}/c/${page.category.slug}`}
					/>
					<SeasonalBreakNotice storeName={retailer.storeName} />

					{/* Category identity: its own name + blurb. */}
					<div className="flex flex-col gap-2 px-5 pt-4 lg:px-8">
						<div className="flex flex-col gap-1">
							{/* This page's own subject, so it owns the <h1>; the app bar
					    above renders the store name as plain text. */}
							<h1 className="font-heading text-2xl font-extrabold leading-tight tracking-tight">
								{page.category.name}
							</h1>
							{page.category.description ? (
								<p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
									{page.category.description}
								</p>
							) : null}
						</div>
					</div>

					<section className="mt-2 px-5 lg:px-8">
						{/* No category rail here. Once a buyer is inside a category the page
				    already names it (h1 + blurb above) and the only move that
				    matters is browsing what's in it; a row of sibling image tiles
				    just competes with the products it sits on top of. The app
				    bar's back is the way out — T3 (z8r3fdegb5) adds sibling
				    CHIPS to this page instead. */}
						<ProductGrid
							retailerId={retailer._id}
							cart={cart}
							products={page.products}
							storeSlug={retailer.slug}
						/>
					</section>

					<StorefrontFooter
						slug={slug}
						discover={retailer.marketplaceUnlisted !== true}
					/>

					<CartBar cart={cart} storeSlug={retailer.slug} />
				</div>
			</HomeOnlyLabelProvider>
		</OrderingPausedProvider>
	);
}
