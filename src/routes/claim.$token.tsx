import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Clock, MessageCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { ClaimPagePayload } from "../../convex/orderClaims";
import { ClaimCheckoutPage } from "../components/claim/claim-checkout-page";
import { ClaimTimerBar } from "../components/claim/claim-timer-bar";
import { AppImage } from "../components/ui/app-image";
import { Skeleton } from "../components/ui/skeleton";
import { MASK_PII } from "../lib/analytics-privacy";
import { getConvexHttpClient } from "../lib/convex-server";
import { formatPrice } from "../lib/format";
import { ssrRead } from "../lib/ssr-read";

/**
 * The buyer's claim-link checkout — /claim/<token> (86eyq0epn,
 * docs/claim-links.md). Token-capability page like /track/<token>: unguessable
 * token, noindex, token never echoed into head/meta. Four states off ONE
 * reactive read (orderClaims.getByToken): open → the price-locked checkout
 * under the variant-A timer bar; expired/cancelled → a calm dead-end with the
 * wa.me + storefront exits; completed → a pointer to the order's track page
 * (the idempotent reopen).
 *
 * Clerk-free buyer surface: listed in BUYER_ROUTE_IDS (86eyheqzv).
 */
export const Route = createFileRoute("/claim/$token")({
	loader: async ({ params }): Promise<{ storeName: string } | null> => {
		const client = getConvexHttpClient();
		const read = await ssrRead(() =>
			client.query(api.orderClaims.getByToken, { token: params.token }),
		);
		// Transient failure: render the shell; the live query paints (86eyheqzv).
		if (!read.ok) return null;
		// An ANSWERED null is a definitive unknown token → 404.
		if (read.value === null) throw notFound();
		return { storeName: read.value.store.storeName };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `Complete your order — ${loaderData.storeName} | Kedaipal`
					: "Complete your order | Kedaipal",
			},
			{ name: "robots", content: "noindex, nofollow" },
		],
	}),
	notFoundComponent: ClaimNotFound,
	component: ClaimRoute,
});

function ClaimNotFound() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="font-heading text-2xl font-extrabold">
				Order link not found
			</h1>
			<p className="text-sm text-muted-foreground">
				This link doesn&apos;t match any order. Check the link in your
				WhatsApp chat, or ask the store to send a fresh one.
			</p>
		</main>
	);
}

function ClaimSkeleton() {
	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
			<div className="flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
				<Skeleton className="size-9 rounded-full" />
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3 w-40" />
				</div>
			</div>
			<Skeleton className="h-9 w-full rounded-none" />
			<div className="flex flex-col gap-4 px-5 pt-4 lg:px-8">
				<Skeleton className="h-56 w-full rounded-2xl" />
				<Skeleton className="h-40 w-full rounded-2xl" />
				<Skeleton className="h-40 w-full rounded-2xl" />
			</div>
		</div>
	);
}

/** The compact store header every claim state shares. */
function ClaimStoreHeader({
	store,
	subtitle,
}: {
	store: ClaimPagePayload["store"];
	/** ReactNode, not string: the OPEN state puts the buyer's name in here and
	 * it has to be wrapped in a masked span (Clarity's Balanced mode records
	 * every rendered string verbatim). */
	subtitle?: React.ReactNode;
}) {
	return (
		<div className="border-b border-border bg-card">
			<div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3.5 lg:px-8">
				{store.logoUrl ? (
					<AppImage
						src={store.logoUrl}
						alt={`${store.storeName} logo`}
						aspect="aspect-square"
						className="size-9 shrink-0 overflow-hidden rounded-full"
					/>
				) : (
					<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
						{store.storeName.slice(0, 1).toUpperCase()}
					</span>
				)}
				<div className="min-w-0">
					<p className="truncate font-heading text-[15px] font-extrabold">
						{store.storeName}
					</p>
					{subtitle ? (
						<p className="truncate text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

/** Calm dead-end for a link that can no longer be completed. */
function ClaimDeadEnd({
	store,
	title,
	body,
}: {
	store: ClaimPagePayload["store"];
	title: string;
	body: string;
}) {
	// Straight into the seller's chat, with context prefilled — the ticket's
	// "friendly dead-end + wa.me to the seller".
	const waUrl = store.waPhone
		? `https://wa.me/${store.waPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
				`Hi ${store.storeName}! My order link expired — could you send me a fresh one?`,
			)}`
		: undefined;
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
			<ClaimStoreHeader store={store} />
			<div className="flex flex-1 flex-col items-center gap-4 px-6 pb-16 pt-14 text-center">
				<span className="flex size-16 items-center justify-center rounded-full bg-muted">
					<Clock className="size-7 text-muted-foreground" aria-hidden />
				</span>
				<div className="flex flex-col gap-2">
					<h1 className="font-heading text-xl font-extrabold tracking-tight">
						{title}
					</h1>
					<p className="max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
						{body}
					</p>
				</div>
				<div className="mt-2 flex w-full max-w-xs flex-col gap-2.5">
					{waUrl ? (
						<a
							href={waUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="tap-target flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground"
						>
							<MessageCircle className="size-4" aria-hidden />
							Ask {store.storeName} to resend
						</a>
					) : null}
					<Link
						to="/$slug"
						params={{ slug: store.slug }}
						className="tap-target flex h-11 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold"
					>
						Browse the store instead
					</Link>
				</div>
				{waUrl ? (
					<p className="text-xs text-muted-foreground">
						Opens your WhatsApp chat with the store.
					</p>
				) : null}
			</div>
		</main>
	);
}

function ClaimRoute() {
	const { token } = Route.useParams();
	const payload = useQuery(
		convexQuery(api.orderClaims.getByToken, { token }),
	).data;
	// The countdown reaching zero flips the page immediately — the server
	// judges expiry independently (commit refuses), this is the honest UI.
	const [locallyExpired, setLocallyExpired] = useState(false);
	const handleExpired = useCallback(() => setLocallyExpired(true), []);
	// The claim page reuses the storefront's public pickup list, keyed by slug.
	const pickupLocations = useQuery(
		convexQuery(
			api.pickupLocations.listActivePublicBySlug,
			payload?.status === "open" ? { slug: payload.store.slug } : "skip",
		),
	).data;

	if (payload === undefined) return <ClaimSkeleton />;
	if (payload === null) return <ClaimNotFound />;

	const { store } = payload;
	const status =
		payload.status === "open" && locallyExpired ? "expired" : payload.status;

	if (status === "expired") {
		return (
			<ClaimDeadEnd
				store={store}
				title="This order link has expired"
				body={`${store.storeName}'s price hold on this order has ended — nothing was charged. Message them to get a fresh link.`}
			/>
		);
	}
	if (status === "cancelled") {
		return (
			<ClaimDeadEnd
				store={store}
				title="This order link was withdrawn"
				body={`${store.storeName} released this order — nothing was charged. If that's unexpected, message them and they can send a new link.`}
			/>
		);
	}
	if (status === "completed") {
		return (
			<main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
				<ClaimStoreHeader store={store} />
				<div className="flex flex-1 flex-col items-center gap-4 px-6 pb-16 pt-14 text-center">
					<span className="flex size-16 items-center justify-center rounded-full bg-accent/10 text-2xl">
						✓
					</span>
					<div className="flex flex-col gap-2">
						<h1 className="font-heading text-xl font-extrabold tracking-tight">
							This order is already confirmed
						</h1>
						<p className="max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
							{payload.completed
								? `Order ${payload.completed.shortId} is in — track it and pay from your order page.`
								: "You've already completed this order."}
						</p>
					</div>
					{payload.completed?.trackingToken ? (
						<Link
							to="/track/$token"
							params={{ token: payload.completed.trackingToken }}
							className="tap-target mt-2 flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground"
						>
							Open my order
						</Link>
					) : null}
				</div>
			</main>
		);
	}

	// OPEN — the price-locked checkout under the timer bar (variant A).
	const open = payload.open;
	if (!open) return <ClaimSkeleton />; // shape defence; server always sends it

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-none flex-col pb-[var(--storefront-bar-h,12rem)] lg:pb-10">
			<ClaimStoreHeader
				store={store}
				subtitle={
					<>
						Ready to complete
						{open.buyerName ? (
							<>
								{" — "}
								<span {...MASK_PII}>{open.buyerName}</span>
							</>
						) : null}
						{` · ${formatPrice(open.itemsTotal, store.currency)}`}
					</>
				}
			/>
			<ClaimTimerBar
				expiresAt={open.expiresAt}
				windowMinutes={open.windowMinutes}
				onExpired={handleExpired}
			/>
			<div className="mx-auto w-full max-w-5xl px-5 pt-4 lg:px-8 lg:pt-6">
				<ClaimCheckoutPage
					token={token}
					store={store}
					open={open}
					pickupLocations={pickupLocations ?? []}
				/>
			</div>
		</div>
	);
}
