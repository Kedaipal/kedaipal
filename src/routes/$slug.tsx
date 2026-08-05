import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { type Locale, OG_LOCALE } from "../../convex/lib/locale";
import { CartBar } from "../components/storefront/cart-bar";
import { CategoryRail } from "../components/storefront/category-rail";
import { FeaturedProduct } from "../components/storefront/featured-product";
import {
	AllProductsDivider,
	ProductGrid,
} from "../components/storefront/product-grid";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { StorefrontHeader } from "../components/storefront/storefront-header";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { ssrRead } from "../lib/ssr-read";

interface StorefrontLoaderData {
	storeName: string;
	slug: string;
	checkoutPhone: string | undefined;
	locale: Locale;
	// SEO meta/OG/JSON-LD description. Prefers the seller's own store description
	// (single-lined) and falls back to a generated blurb.
	description: string;
	canonicalUrl: string;
	ogImageUrl: string | undefined;
	// Exposed distinctly from `ogImageUrl` (which also falls back to logo/first
	// product) so `head()` can preload ONLY the actual LCP element — the header
	// cover image `StorefrontHeader` renders with `priority` — not whichever
	// URL happens to win the OG-image precedence.
	coverImageUrl: string | undefined;
}

export const Route = createFileRoute("/$slug")({
	loader: async ({ params }): Promise<StorefrontLoaderData | null> => {
		const client = getConvexHttpClient();
		const read = await ssrRead(() =>
			client.query(api.retailers.getRetailerBySlug, { slug: params.slug }),
		);
		// Transient upstream failure: render the shell (head() falls back to
		// defaults, the client's reactive query paints the store) instead of
		// serving the buyer an error page (86eyheqzv). A definitive notFound
		// below still 404s — the two must never be conflated.
		if (!read.ok) return null;
		const result = read.value;

		if (result.status === "redirect") {
			throw redirect({
				to: "/$slug",
				params: { slug: result.to },
				statusCode: 301,
			});
		}
		if (result.status === "notFound") {
			throw notFound();
		}

		const retailer = result.retailer;

		// OG/social-share image precedence: cover banner (wide, ideal for a
		// summary_large_image card) → logo → first product image.
		let ogImageUrl: string | undefined =
			retailer.coverImageUrl ?? retailer.logoUrl;
		if (!ogImageUrl) {
			try {
				const products = await client.query(api.products.list, {
					retailerId: retailer._id,
				});
				ogImageUrl = products.find((p) => p.imageUrls[0])?.imageUrls[0];
			} catch {
				ogImageUrl = undefined;
			}
		}

		// The seller's own description is the stronger trust/SEO signal — prefer it
		// for meta tags, collapsing newlines to a single line. Fall back to the
		// generated blurb when unset.
		const sellerDescription = retailer.storeDescription
			?.replace(/\s+/g, " ")
			.trim();
		const description =
			sellerDescription ||
			`Shop ${retailer.storeName} on Kedaipal — browse the catalog and place your order on WhatsApp.`;

		return {
			storeName: retailer.storeName,
			slug: retailer.slug,
			checkoutPhone: retailer.checkoutPhone,
			locale: retailer.locale ?? "en",
			description,
			canonicalUrl: `${SITE_URL}/${retailer.slug}`,
			ogImageUrl,
			coverImageUrl: retailer.coverImageUrl ?? undefined,
		};
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const {
			storeName,
			description,
			canonicalUrl,
			ogImageUrl,
			coverImageUrl,
			checkoutPhone,
			locale,
		} = loaderData;
		const title = `${storeName} — Order on WhatsApp | Kedaipal`;
		const ogLocale = OG_LOCALE[locale];

		const meta = [
			{ title },
			{ name: "description", content: description },
			{ name: "robots", content: "index, follow" },
			// Open Graph
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Kedaipal" },
			{ property: "og:locale", content: ogLocale },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			// Twitter
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
				{ name: "twitter:image", content: ogImageUrl },
			);
		}

		const jsonLd = {
			"@context": "https://schema.org",
			"@type": "Store",
			name: storeName,
			url: canonicalUrl,
			description,
			...(ogImageUrl ? { image: ogImageUrl } : {}),
			...(checkoutPhone ? { telephone: `+${checkoutPhone}` } : {}),
		};

		return {
			meta,
			links: [
				{ rel: "canonical", href: canonicalUrl },
				// LCP preload — StorefrontHeader renders this URL with `priority`
				// the moment retailer data resolves; hinting the browser before
				// the JS bundle even parses shaves the fetch off the critical path.
				...(coverImageUrl
					? [{ rel: "preload", as: "image", href: coverImageUrl }]
					: []),
			],
			scripts: [
				{
					type: "application/ld+json",
					children: JSON.stringify(jsonLd),
				},
			],
		};
	},
	notFoundComponent: StoreNotFound,
	component: StorefrontRoute,
});

function StoreNotFound() {
	const { slug } = Route.useParams();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="text-3xl font-bold">Store not found</h1>
			<p className="text-sm text-muted-foreground">
				No retailer uses <span className="font-mono">/{slug}</span>.
			</p>
		</main>
	);
}

function StorefrontSkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-32">
			<header className="flex flex-col gap-4 bg-gradient-to-b from-accent/10 to-background px-5 pb-6 pt-10 lg:rounded-b-3xl lg:px-8">
				<Skeleton className="h-5 w-24" />
				<div className="flex items-center gap-4">
					<Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
					<div className="flex flex-col gap-2">
						<Skeleton className="h-7 w-40" />
						<Skeleton className="h-4 w-48" />
					</div>
				</div>
			</header>
			<section className="mt-4 flex flex-col gap-4 px-5 lg:px-8">
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
						<div
							key={n}
							className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3"
						>
							<Skeleton className="aspect-square w-full rounded-xl" />
							<Skeleton className="h-4 w-3/4" />
							<Skeleton className="h-4 w-1/2" />
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

function StorefrontRoute() {
	const { slug } = Route.useParams();
	// Live query keeps the catalog reactive after the SSR'd loader response.
	const result = useQuery(api.retailers.getRetailerBySlug, { slug });
	const cart = useCart(
		result && result.status === "ok" ? result.retailer._id : undefined,
	);

	if (result === undefined || result.status !== "ok") {
		return <StorefrontSkeleton />;
	}

	const retailer = result.retailer;

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-20">
			{/* Shared brand header (cover/logo/name) — identical on the category
			    pages so buyers always know whose store they're in. */}
			<StorefrontHeader retailer={retailer} />

			<section className="mt-2 px-5 lg:px-8">
				{/* Search first (sticky inside the grid), then the merchandised lead:
				    the category rail + the "Popular this week" shelf, then
				    the full grid (86eybrhrt PR3). Both lead pieces render nothing when
				    they have nothing honest to show (no categories / no qualifying
				    orders), so quiet stores stay search + grid. */}
				<ProductGrid
					retailerId={retailer._id}
					cart={cart}
					storeSlug={retailer.slug}
					beforeGrid={
						<>
							{/* `gap-6` owns the rhythm between the two lead sections
							    rather than either one carrying a trailing margin: each
							    renders null on a store with no categories / no qualifying
							    orders, and a gap only applies between siblings that
							    actually exist — so neither can leave a dangling space.
							    `peer` lets the divider below detect whether either one
							    rendered at all. */}
							<div className="peer flex flex-col gap-6">
								<CategoryRail
									retailerId={retailer._id}
									storeSlug={retailer.slug}
								/>
								<FeaturedProduct
									retailerId={retailer._id}
									storeSlug={retailer.slug}
									cart={cart}
								/>
							</div>
							{/* Shows only when something above it rendered — otherwise the
							    grid follows the search bar directly. */}
							<AllProductsDivider />
						</>
					}
				/>
			</section>

			<StorefrontFooter />

			<CartBar cart={cart} storeSlug={retailer.slug} />
		</div>
	);
}
