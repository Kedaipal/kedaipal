import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { CartBar } from "../components/storefront/cart-bar";
import { CategoryRail } from "../components/storefront/category-rail";
import { ProductGrid } from "../components/storefront/product-grid";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { StorefrontHeader } from "../components/storefront/storefront-header";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

interface StorefrontLoaderData {
	storeName: string;
	slug: string;
	checkoutPhone: string | undefined;
	locale: "en" | "ms";
	// SEO meta/OG/JSON-LD description. Prefers the seller's own store description
	// (single-lined) and falls back to a generated blurb.
	description: string;
	canonicalUrl: string;
	ogImageUrl: string | undefined;
}

export const Route = createFileRoute("/$slug")({
	loader: async ({ params }): Promise<StorefrontLoaderData> => {
		const client = getConvexHttpClient();
		const result = await client.query(api.retailers.getRetailerBySlug, {
			slug: params.slug,
		});

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
		};
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const {
			storeName,
			description,
			canonicalUrl,
			ogImageUrl,
			checkoutPhone,
			locale,
		} = loaderData;
		const title = `${storeName} — Order on WhatsApp | Kedaipal`;
		const ogLocale = locale === "ms" ? "ms_MY" : "en_MY";

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
			links: [{ rel: "canonical", href: canonicalUrl }],
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
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
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
	// Active pickup locations — public, unauthed. Only consulted by the checkout
	// sheet when the retailer has self-collect on. Loading state (undefined) is
	// folded into "no locations" at the call site to avoid blocking storefront
	// render on a sidecar query.
	const pickupLocations = useQuery(api.pickupLocations.listActivePublicBySlug, {
		slug,
	});
	// Checkout sheet open-state lives here (not in CartBar) so the product detail
	// sheet — a sibling under this route — can open checkout directly.
	const [checkoutOpen, setCheckoutOpen] = useState(false);

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
				{/* Search first (sticky inside the grid), then the category hero
				    carousel as the page's main highlight, then the full grid under an
				    "All products" divider. Zero-category stores render no hero — the
				    page stays search + grid, same as pre-categories. */}
				<ProductGrid
					retailerId={retailer._id}
					cart={cart}
					storeSlug={retailer.slug}
					onRequestCheckout={() => setCheckoutOpen(true)}
					beforeGrid={
						<CategoryRail retailerId={retailer._id} storeSlug={retailer.slug} />
					}
				/>
			</section>

			<StorefrontFooter />

			<CartBar
				cart={cart}
				retailerId={retailer._id}
				storeName={retailer.storeName}
				checkoutPhone={retailer.checkoutPhone}
				offerSelfCollect={retailer.offerSelfCollect ?? false}
				offerDelivery={retailer.offerDelivery ?? true}
				minFulfilmentNoticeDays={retailer.minFulfilmentNoticeDays}
				minOrderValue={retailer.minOrderValue}
				pickupLocations={pickupLocations ?? []}
				checkoutOpen={checkoutOpen}
				onCheckoutOpenChange={setCheckoutOpen}
			/>
		</div>
	);
}
