import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { CartBar } from "../components/storefront/cart-bar";
import { ProductGrid } from "../components/storefront/product-grid";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { StorefrontHeader } from "../components/storefront/storefront-header";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

interface CategoryLoaderData {
	storeName: string;
	slug: string;
	categoryName: string;
	categorySlug: string;
	description: string;
	canonicalUrl: string;
	ogImageUrl: string | undefined;
	locale: "en" | "ms";
}

/**
 * Nested storefront category page — /$slug/c/$categorySlug. The `$slug_`
 * filename (pathless-parent underscore) gives the URL prefix WITHOUT nesting
 * under $slug.tsx, which is a leaf route with no <Outlet/>. Shares the home
 * page's cart (useCart is keyed per retailerId in localStorage), cards, detail
 * sheet and checkout — only the product set is scoped to the category.
 */
export const Route = createFileRoute("/$slug_/c/$categorySlug")({
	loader: async ({ params }): Promise<CategoryLoaderData> => {
		const client = getConvexHttpClient();
		const result = await client.query(api.retailers.getRetailerBySlug, {
			slug: params.slug,
		});

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
		const retailer = result.retailer;

		// Unknown or archived category → 404, never a silent empty page.
		const page = await client.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: params.categorySlug,
		});
		if (page === null) {
			throw notFound();
		}

		const categoryDescription = page.category.description
			?.replace(/\s+/g, " ")
			.trim();
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
			// Share-image precedence: the category's own image → store cover → logo.
			ogImageUrl:
				page.category.imageUrl ??
				retailer.coverImageUrl ??
				retailer.logoUrl ??
				undefined,
			locale: retailer.locale ?? "en",
		};
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const {
			storeName,
			categoryName,
			description,
			canonicalUrl,
			ogImageUrl,
			locale,
		} = loaderData;
		const title = `${categoryName} — ${storeName} | Kedaipal`;

		const meta = [
			{ title },
			{ name: "description", content: description },
			{ name: "robots", content: "index, follow" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Kedaipal" },
			{ property: "og:locale", content: locale === "ms" ? "ms_MY" : "en_MY" },
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
		return {
			meta,
			links: [{ rel: "canonical", href: canonicalUrl }],
		};
	},
	notFoundComponent: CategoryNotFound,
	component: CategoryRoute,
});

function CategoryNotFound() {
	const { slug } = Route.useParams();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="text-3xl font-bold">Category not found</h1>
			<p className="text-sm text-muted-foreground">
				This category may have been renamed or removed — the store's full
				catalog is still open.
			</p>
			<Link
				to="/$slug"
				params={{ slug }}
				className="mt-1 inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-medium text-background"
			>
				Browse all products
			</Link>
		</main>
	);
}

function CategorySkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-32">
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
			<div className="flex flex-col gap-3 px-5 pt-4 lg:px-8">
				<Skeleton className="h-4 w-28" />
				<Skeleton className="h-8 w-48" />
			</div>
			<section className="mt-2 px-5 lg:px-8">
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
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
	// Live queries keep the page reactive after the SSR'd loader response.
	const result = useQuery(api.retailers.getRetailerBySlug, { slug });
	const retailer = result?.status === "ok" ? result.retailer : undefined;
	const page = useQuery(
		api.categories.getPublicPage,
		retailer ? { retailerId: retailer._id, categorySlug } : "skip",
	);
	// Same per-retailer cart as the store home — items carry across pages.
	const cart = useCart(retailer?._id);
	const pickupLocations = useQuery(api.pickupLocations.listActivePublicBySlug, {
		slug,
	});

	if (!retailer || page === undefined) {
		return <CategorySkeleton />;
	}
	if (page === null) {
		// The category was archived/renamed while the buyer had the page open.
		return <CategoryNotFound />;
	}

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col pb-20">
			{/* Same brand header as the store home (cover/logo/name) — the buyer
			    never loses the sense of whose store they're in. */}
			<StorefrontHeader retailer={retailer} />

			{/* Category identity: a way back, then the category's own name + blurb. */}
			<div className="flex flex-col gap-2 px-5 pt-4 lg:px-8">
				<Link
					to="/$slug"
					params={{ slug: retailer.slug }}
					className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-4" aria-hidden />
					All products
				</Link>
				<div className="flex flex-col gap-1">
					<h2 className="font-heading text-2xl font-extrabold leading-tight tracking-tight">
						{page.category.name}
					</h2>
					{page.category.description ? (
						<p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
							{page.category.description}
						</p>
					) : null}
				</div>
			</div>

			<section className="mt-2 px-5 lg:px-8">
				<ProductGrid
					retailerId={retailer._id}
					cart={cart}
					products={page.products}
					storeSlug={retailer.slug}
				/>
			</section>

			<StorefrontFooter />

			<CartBar
				cart={cart}
				retailerId={retailer._id}
				checkoutPhone={retailer.checkoutPhone}
				offerSelfCollect={retailer.offerSelfCollect ?? false}
				offerDelivery={retailer.offerDelivery ?? true}
				minFulfilmentNoticeDays={retailer.minFulfilmentNoticeDays}
				pickupLocations={pickupLocations ?? []}
			/>
		</div>
	);
}
