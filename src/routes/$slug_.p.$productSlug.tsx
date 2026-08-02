import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProductPageView } from "../components/storefront/product-page";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

interface ProductLoaderData {
	storeName: string;
	slug: string;
	productName: string;
	productSlug: string;
	description: string;
	canonicalUrl: string;
	ogImageUrl: string | undefined;
	// Offer facts for the Product JSON-LD, frozen at load time. Prices in minor
	// units; 0/0 + quote-only means "no offers block" (price is negotiated).
	priceFrom: number;
	priceTo: number;
	currency: string;
	inStock: boolean;
	quoteOnly: boolean;
}

/**
 * The public product page — /$slug/p/<productSlug> (86eybrhrt PR2). The
 * storefront's first per-product URL: shareable in WhatsApp (sellers pasting
 * a product straight into a chat is the growth path), indexable, with a
 * Product JSON-LD offers block. `$slug_` pathless-parent underscore = same
 * routing trick as the category + checkout pages ($slug.tsx is a leaf).
 */
export const Route = createFileRoute("/$slug_/p/$productSlug")({
	loader: async ({ params }): Promise<ProductLoaderData> => {
		const client = getConvexHttpClient();
		const result = await client.query(api.retailers.getRetailerBySlug, {
			slug: params.slug,
		});

		// Renamed store → keep the buyer on the same product under the new slug.
		if (result.status === "redirect") {
			throw redirect({
				to: "/$slug/p/$productSlug",
				params: { slug: result.to, productSlug: params.productSlug },
				statusCode: 301,
			});
		}
		if (result.status === "notFound") {
			throw notFound();
		}
		const retailer = result.retailer;

		// Unknown, archived, hidden or category-suppressed → 404, never a leak.
		const product = await client.query(api.products.getPublicBySlug, {
			retailerId: retailer._id,
			slug: params.productSlug,
		});
		if (product === null) {
			throw notFound();
		}

		const productDescription = product.description?.replace(/\s+/g, " ").trim();
		const description =
			productDescription ||
			`Order ${product.name} from ${retailer.storeName} on WhatsApp via Kedaipal.`;

		return {
			storeName: retailer.storeName,
			slug: retailer.slug,
			productName: product.name,
			productSlug: params.productSlug,
			description,
			canonicalUrl: `${SITE_URL}/${retailer.slug}/p/${params.productSlug}`,
			// Share image precedence: the product's own photo → store cover → logo.
			ogImageUrl:
				product.imageUrls[0] ??
				retailer.coverImageUrl ??
				retailer.logoUrl ??
				undefined,
			priceFrom: product.priceFrom,
			priceTo: product.priceTo,
			currency: product.currency,
			inStock: product.inStock,
			quoteOnly: product.hasQuotePricing && product.priceTo === 0,
		};
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const {
			storeName,
			productName,
			description,
			canonicalUrl,
			ogImageUrl,
			priceFrom,
			priceTo,
			currency,
			inStock,
			quoteOnly,
		} = loaderData;
		const title = `${productName} — ${storeName} | Kedaipal`;

		const meta = [
			{ title },
			{ name: "description", content: description },
			{ name: "robots", content: "index, follow" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Kedaipal" },
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
				{ name: "twitter:image", content: ogImageUrl },
			);
		}

		// Product JSON-LD. Prices convert minor → major units; quote-only
		// products (price negotiated on the mockup) carry no offers block
		// rather than advertising a misleading RM 0.
		const toMajor = (sen: number) => (sen / 100).toFixed(2);
		const availability = inStock
			? "https://schema.org/InStock"
			: "https://schema.org/OutOfStock";
		const jsonLd = {
			"@context": "https://schema.org",
			"@type": "Product",
			name: productName,
			description,
			url: canonicalUrl,
			...(ogImageUrl ? { image: ogImageUrl } : {}),
			...(quoteOnly
				? {}
				: priceFrom === priceTo
					? {
							offers: {
								"@type": "Offer",
								price: toMajor(priceFrom),
								priceCurrency: currency,
								availability,
								url: canonicalUrl,
							},
						}
					: {
							offers: {
								"@type": "AggregateOffer",
								lowPrice: toMajor(priceFrom),
								highPrice: toMajor(priceTo),
								priceCurrency: currency,
								availability,
								url: canonicalUrl,
							},
						}),
		};

		return {
			meta,
			links: [{ rel: "canonical", href: canonicalUrl }],
			scripts: [
				{ type: "application/ld+json", children: JSON.stringify(jsonLd) },
			],
		};
	},
	notFoundComponent: ProductNotFound,
	component: ProductRoute,
});

function ProductNotFound() {
	const { slug } = Route.useParams();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="text-3xl font-bold">Product not found</h1>
			<p className="text-sm text-muted-foreground">
				It may have sold out for good or been renamed — the store&apos;s full
				catalog is still open.
			</p>
			<Link
				to="/$slug"
				params={{ slug }}
				activeOptions={{ exact: true }}
				className="mt-1 inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-medium text-background"
			>
				Browse the store
			</Link>
		</main>
	);
}

function ProductSkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-20">
			{/* Mirrors the shared StorefrontHeader shape so the swap-in is seamless. */}
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
			<div className="mt-4 px-5 lg:flex lg:gap-10 lg:px-8">
				<Skeleton className="aspect-square w-full rounded-2xl lg:w-[44%]" />
				<div className="mt-4 flex flex-1 flex-col gap-3 lg:mt-0">
					<Skeleton className="h-8 w-2/3" />
					<Skeleton className="h-7 w-28" />
					<Skeleton className="h-24 w-full rounded-2xl" />
				</div>
			</div>
		</div>
	);
}

function ProductRoute() {
	const { slug, productSlug } = Route.useParams();
	// Live queries keep the page reactive after the SSR'd loader response —
	// stock, prices and visibility update in place.
	const result = useQuery(api.retailers.getRetailerBySlug, { slug });
	const retailer = result?.status === "ok" ? result.retailer : undefined;
	const product = useQuery(
		api.products.getPublicBySlug,
		retailer ? { retailerId: retailer._id, slug: productSlug } : "skip",
	);
	// Same per-retailer cart as every storefront surface.
	const cart = useCart(retailer?._id);

	// Also wait on the cart: `cartQuantity` seeds the min-quantity stepper's
	// opening value, so mounting the buy box before the persisted cart is read
	// could open it at the wrong number. In practice hydration (a synchronous
	// localStorage read) lands well before the product query, so this costs
	// nothing — it just makes "cart-dependent UI waits for the cart" uniform.
	// The store/category pages deliberately DON'T gate on this: their CartBar
	// degrades additively ("Empty" → filled), and holding the catalog on
	// localStorage would be a worse trade.
	if (!retailer || product === undefined || !cart.hydrated) {
		return <ProductSkeleton />;
	}
	if (product === null) {
		// Archived/hidden while the buyer had the page open.
		return <ProductNotFound />;
	}

	return (
		// No horizontal page padding: the shared header is full-bleed (its cover
		// image must reach the edges, same as the store home + category pages);
		// each section below owns its own px. The bottom padding reserves room
		// for the FIXED mobile purchase bar so it can't cover the footer — the
		// bar publishes its measured height as --storefront-bar-h, so the
		// reservation is exact rather than a guess with dead space under the
		// badge. The fallback only applies for the frame before first measure.
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-[var(--storefront-bar-h,12rem)] lg:pb-10">
			<ProductPageView
				product={product}
				retailerId={retailer._id}
				retailer={retailer}
				storeSlug={retailer.slug}
				cart={cart}
				canonicalUrl={`${SITE_URL}/${retailer.slug}/p/${productSlug}`}
			/>
			{/* Direct flex child so its `mt-auto` anchors it to the bottom of the
			    page — same placement as the store home and category pages. */}
			<StorefrontFooter />
		</div>
	);
}
