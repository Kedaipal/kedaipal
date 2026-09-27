import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { BookingCheckoutForm } from "../components/storefront/booking-checkout-form";
import { CheckoutPage } from "../components/storefront/checkout-form";
import {
	OrderingPausedProvider,
	SeasonalBreakNotice,
} from "../components/storefront/seasonal-break";
import { StorefrontAppBar } from "../components/storefront/storefront-app-bar";
import { StorefrontFooter } from "../components/storefront/storefront-footer";
import { Skeleton } from "../components/ui/skeleton";
import { useCart } from "../hooks/useCart";
import { useCaptureAttribution } from "../hooks/useSourceAttribution";
import { getConvexHttpClient } from "../lib/convex-server";
import { ssrRead } from "../lib/ssr-read";

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
	// ?booking=<productSlug> switches this page into the booking-request flow
	// (S2 `86eyn4kbw`): calendar + guest details instead of the cart form. The
	// cart itself is untouched either way — a stay never enters it.
	validateSearch: (search: Record<string, unknown>): { booking?: string } =>
		typeof search.booking === "string" && search.booking.length > 0
			? { booking: search.booking }
			: {},
	loader: async ({ params }): Promise<CheckoutLoaderData | null> => {
		const client = getConvexHttpClient();
		const read = await ssrRead(() =>
			client.query(api.retailers.getRetailerBySlug, { slug: params.slug }),
		);
		// Transient upstream failure: render the shell — the checkout's real data
		// is the client's reactive query — never an error page mid-purchase
		// (86eyheqzv). Definitive notFound below still 404s.
		if (!read.ok) return null;
		const result = read.value;

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
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 text-center">
			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<h1 className="text-3xl font-bold">Store not found</h1>
				<p className="text-sm text-muted-foreground">
					No retailer uses <span className="font-mono">/{slug}</span>.
				</p>
			</div>
			{/* No store to attribute to — the slug names nobody. */}
			<StorefrontFooter />
		</main>
	);
}

function CheckoutSkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
			{/* Mirrors the compact StorefrontAppBar so the swap-in is seamless. */}
			<header className="border-b border-border">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:h-16">
					<Skeleton className="size-6 rounded-full" />
					<Skeleton className="size-8 rounded-[10px]" />
					<Skeleton className="h-4 w-32" />
				</div>
			</header>
			<div className="flex flex-col gap-4 px-5 pt-4 lg:px-8 lg:pt-6">
				<Skeleton className="h-7 w-32" />
				<div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
					<Skeleton className="h-64 w-full rounded-2xl lg:order-2 lg:w-96" />
					<div className="flex flex-1 flex-col gap-4 lg:order-1">
						<Skeleton className="h-32 w-full rounded-2xl" />
						<Skeleton className="h-48 w-full rounded-2xl" />
					</div>
				</div>
			</div>
		</div>
	);
}

function CheckoutRoute() {
	const { slug } = Route.useParams();
	const { booking } = Route.useSearch();
	// A tagged link can land straight on checkout — capture here too.
	useCaptureAttribution(slug);
	// Live query keeps the page reactive after the SSR'd loader response —
	// same pattern as the store home and category pages.
	const result = useQuery(
		convexQuery(api.retailers.getRetailerBySlug, { slug }),
	).data;
	const retailer = result?.status === "ok" ? result.retailer : undefined;
	// Same per-retailer cart as the browse pages — this page reviews it.
	const cart = useCart(retailer?._id);
	const pickupLocations = useQuery(
		convexQuery(api.pickupLocations.listActivePublicBySlug, { slug }),
	).data;

	// Hold the skeleton until BOTH the store and the persisted cart are known.
	// Without the cart gate the first committed render shows the empty-cart
	// panel — with a "Browse {store}" button that navigates away from checkout
	// — before the buyer's items hydrate from localStorage.
	if (!retailer || !cart.hydrated) {
		return <CheckoutSkeleton />;
	}

	// Off-Season Hold (z8r3fday24): no form at all — the server would refuse
	// the order anyway, and a form that can't submit is a trap. The cart is
	// kept (localStorage) for when the store reopens.
	if (retailer.orderingPaused) {
		return (
			<OrderingPausedProvider paused>
				<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col pb-10">
					<StorefrontAppBar retailer={retailer} slug={retailer.slug} />
					<SeasonalBreakNotice storeName={retailer.storeName} />
					<div className="px-5 pt-4 lg:px-8 lg:pt-6">
						<h1 className="font-heading text-xl font-extrabold tracking-tight">
							Checkout
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							{retailer.storeName} isn't taking orders this season, so there's
							nothing to check out yet. Your basket is saved for when they're
							back.
						</p>
						<Link
							to="/$slug"
							params={{ slug: retailer.slug }}
							activeOptions={{ exact: true }}
							className="tap-target mt-4 inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium"
						>
							<ArrowLeft className="size-4" aria-hidden />
							Back to {retailer.storeName}
						</Link>
					</div>
					<StorefrontFooter />
				</div>
			</OrderingPausedProvider>
		);
	}

	if (booking) {
		return (
			<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col pb-[var(--storefront-bar-h,12rem)] lg:pb-10">
				{/* The app bar owns "back" — and here the page sits under a LISTING,
				    so back leads to it rather than the store home (one back control
				    per screen, pointing one level up). */}
				<StorefrontAppBar
					retailer={retailer}
					slug={retailer.slug}
					backToProductSlug={booking}
				/>
				<div className="px-5 pt-4 lg:px-8 lg:pt-6">
					<h1 className="font-heading text-xl font-extrabold tracking-tight">
						Request to book
					</h1>
					<div className="mt-4">
						<BookingCheckoutForm
							retailerId={retailer._id}
							storeName={retailer.storeName}
							storeSlug={retailer.slug}
							productSlug={booking}
							locale={retailer.locale}
							country={retailer.country}
						/>
					</div>
				</div>
				<StorefrontFooter slug={slug} />
			</div>
		);
	}

	return (
		// The bottom padding reserves room for the FIXED mobile CTA bar (out of
		// flow, so it would otherwise cover the footer) — the bar measures itself
		// and publishes --storefront-bar-h, so this is exactly the bar and no
		// dead space under the footer badge. The fallback only applies for the
		// frame before the first measurement. Desktop has no fixed bar.
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col pb-[var(--storefront-bar-h,12rem)] lg:pb-10">
			{/* The compact app bar every subpage renders (z8r3fdegb5). Checkout is
			    not a payment funnel — nothing is charged here and the way out is
			    back to the store (which keeps the cart) — so the seller's identity
			    belongs at the moment of ordering; the bar carries it AND owns
			    "back", replacing the old round back button beside the heading. */}
			<StorefrontAppBar retailer={retailer} slug={retailer.slug} />

			<div className="px-5 pt-4 lg:px-8 lg:pt-6">
				{/* This page's own subject, so it owns the <h1>. */}
				<h1 className="font-heading text-xl font-extrabold tracking-tight">
					Checkout
				</h1>

				<div className="mt-4">
					<CheckoutPage
						cart={cart}
						retailerId={retailer._id}
						storeName={retailer.storeName}
						storeSlug={retailer.slug}
						checkoutPhone={retailer.checkoutPhone}
						locale={retailer.locale}
						country={retailer.country}
						confirmPushEnabled={retailer.confirmPushEnabled ?? false}
						offerSelfCollect={retailer.offerSelfCollect ?? false}
						offerDelivery={retailer.offerDelivery ?? true}
						collectsFromCustomer={
							retailer.deliveryCollectsFromCustomer ?? false
						}
						booksCouriers={retailer.booksCouriers ?? false}
						minFulfilmentNoticeDays={retailer.minFulfilmentNoticeDays}
						openingHours={retailer.openingHours}
						closedDates={retailer.closedDates}
						minOrderValue={retailer.minOrderValue}
						pickupLocations={pickupLocations ?? []}
					/>
				</div>
			</div>

			{/* Direct flex child so its `mt-auto` anchors it to the bottom of the
			    page — same placement as the store home and category pages. */}
			<StorefrontFooter slug={slug} />
		</div>
	);
}
