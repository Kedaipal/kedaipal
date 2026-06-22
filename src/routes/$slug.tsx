import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CartBar } from "../components/storefront/cart-bar";
import { FoundingMemberBadge } from "../components/storefront/founding-member-badge";
import { ProductGrid } from "../components/storefront/product-grid";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";

interface StorefrontLoaderData {
	storeName: string;
	slug: string;
	checkoutPhone: string | undefined;
	locale: "en" | "ms";
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

		// Logo wins for OG image; fall back to first product image.
		let ogImageUrl: string | undefined = retailer.logoUrl;
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

		return {
			storeName: retailer.storeName,
			slug: retailer.slug,
			checkoutPhone: retailer.checkoutPhone,
			locale: retailer.locale ?? "en",
			description: `Shop ${retailer.storeName} on Kedaipal — browse the catalog and place your order on WhatsApp.`,
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
		<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-32">
			<header className="flex flex-col gap-4 bg-gradient-to-b from-accent/10 to-background px-5 pb-6 pt-10">
				<Skeleton className="h-5 w-24" />
				<div className="flex items-center gap-4">
					<Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
					<div className="flex flex-col gap-2">
						<Skeleton className="h-7 w-40" />
						<Skeleton className="h-4 w-48" />
					</div>
				</div>
			</header>
			<section className="mt-4 flex flex-col gap-4 px-5">
				<div className="grid grid-cols-2 gap-3">
					{[0, 1, 2, 3].map((n) => (
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

	if (result === undefined || result.status !== "ok") {
		return <StorefrontSkeleton />;
	}

	const retailer = result.retailer;

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-32">
			<header className="flex flex-col gap-4 bg-gradient-to-b from-accent/10 to-background px-5 pb-6 pt-10">
				<img src="/logo-3.svg" alt="Kedaipal" className="h-5 w-auto" />
				<div className="flex items-center gap-4">
					{retailer.logoUrl ? (
						<img
							src={retailer.logoUrl}
							alt={`${retailer.storeName} logo`}
							className="h-16 w-16 shrink-0 rounded-2xl border-2 border-accent/20 bg-background object-contain shadow-sm"
						/>
					) : null}
					<div className="flex flex-col gap-1">
						<h1 className="text-2xl font-bold leading-tight tracking-tight">
							{retailer.storeName}
						</h1>
						{retailer.isFoundingMember ? (
							<FoundingMemberBadge rank={retailer.foundingMemberRank} />
						) : null}
						<p className="text-sm text-muted-foreground">
							Browse &amp; order on WhatsApp
						</p>
					</div>
				</div>
			</header>

			<section className="mt-4 px-5">
				<ProductGrid retailerId={retailer._id} cart={cart} />
			</section>

			<CartBar
				cart={cart}
				retailerId={retailer._id}
				storeName={retailer.storeName}
				checkoutPhone={retailer.checkoutPhone}
				offerSelfCollect={retailer.offerSelfCollect ?? false}
				pickupLocations={pickupLocations ?? []}
			/>
		</div>
	);
}
