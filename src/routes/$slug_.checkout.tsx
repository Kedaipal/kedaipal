import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { CheckoutPage } from "../components/storefront/checkout-form";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { getConvexHttpClient } from "../lib/convex-server";

interface CheckoutLoaderData {
	storeName: string;
	slug: string;
}

/**
 * The storefront checkout page — /$slug/checkout (86eybrhrt PR1). A real
 * route instead of the old bottom sheet: browser back returns to the store,
 * refresh keeps the buyer's place (the cart is localStorage), and desktop
 * finally gets a two-column layout instead of a full-width bottom strip.
 * The `$slug_` filename (pathless-parent underscore) gives the URL prefix
 * without nesting under the leaf `$slug.tsx` — same trick as the category
 * page. Noindex: a checkout is transactional, not a landing surface.
 */
export const Route = createFileRoute("/$slug_/checkout")({
	loader: async ({ params }): Promise<CheckoutLoaderData> => {
		const client = getConvexHttpClient();
		const result = await client.query(api.retailers.getRetailerBySlug, {
			slug: params.slug,
		});

		// Renamed store → keep the buyer on checkout under the new slug.
		if (result.status === "redirect") {
			throw redirect({
				to: "/$slug/checkout",
				params: { slug: result.to },
				statusCode: 301,
			});
		}
		if (result.status === "notFound") {
			throw notFound();
		}

		return {
			storeName: result.retailer.storeName,
			slug: result.retailer.slug,
		};
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		return {
			meta: [
				{ title: `Checkout — ${loaderData.storeName} | Kedaipal` },
				{ name: "robots", content: "noindex, nofollow" },
			],
		};
	},
	notFoundComponent: CheckoutNotFound,
	component: CheckoutRoute,
});

function CheckoutNotFound() {
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

function CheckoutSkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-5 pt-6 lg:px-8">
			<div className="flex items-center gap-3">
				<Skeleton className="size-9 rounded-full" />
				<Skeleton className="h-7 w-32" />
			</div>
			<div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
				<Skeleton className="h-64 w-full rounded-2xl lg:order-2 lg:w-96" />
				<div className="flex flex-1 flex-col gap-4 lg:order-1">
					<Skeleton className="h-32 w-full rounded-2xl" />
					<Skeleton className="h-48 w-full rounded-2xl" />
				</div>
			</div>
		</div>
	);
}

function CheckoutRoute() {
	const { slug } = Route.useParams();
	// Live query keeps the page reactive after the SSR'd loader response —
	// same pattern as the store home and category pages.
	const result = useQuery(api.retailers.getRetailerBySlug, { slug });
	const retailer = result?.status === "ok" ? result.retailer : undefined;
	// Same per-retailer cart as the browse pages — this page reviews it.
	const cart = useCart(retailer?._id);
	const pickupLocations = useQuery(api.pickupLocations.listActivePublicBySlug, {
		slug,
	});

	// Hold the skeleton until BOTH the store and the persisted cart are known.
	// Without the cart gate the first committed render shows the empty-cart
	// panel — with a "Browse {store}" button that navigates away from checkout
	// — before the buyer's items hydrate from localStorage.
	if (!retailer || !cart.hydrated) {
		return <CheckoutSkeleton />;
	}

	return (
		// No pb clearance for the CTA bar — it's sticky (in flow), not fixed.
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 pb-6 pt-4 lg:px-8 lg:pb-10 lg:pt-6">
			<header className="flex items-center gap-3">
				<Link
					to="/$slug"
					params={{ slug: retailer.slug }}
					aria-label={`Back to ${retailer.storeName}`}
					className="tap-target flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-4" aria-hidden />
				</Link>
				<h1 className="font-heading text-xl font-extrabold tracking-tight">
					Checkout
				</h1>
			</header>

			<div className="mt-4">
				<CheckoutPage
					cart={cart}
					retailerId={retailer._id}
					storeName={retailer.storeName}
					storeSlug={retailer.slug}
					checkoutPhone={retailer.checkoutPhone}
					offerSelfCollect={retailer.offerSelfCollect ?? false}
					offerDelivery={retailer.offerDelivery ?? true}
					minFulfilmentNoticeDays={retailer.minFulfilmentNoticeDays}
					minOrderValue={retailer.minOrderValue}
					pickupLocations={pickupLocations ?? []}
				/>
			</div>

			{/* Direct flex child so its `mt-auto` anchors it to the bottom of the
			    page — same placement as the store home and category pages. */}
			<StorefrontFooter compact />
		</div>
	);
}
