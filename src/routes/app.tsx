import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import {
	createFileRoute,
	Outlet,
	retainSearchParams,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { ActingAsBanner } from "../components/admin/acting-as-banner";
import { ConsentBanner } from "../components/app/consent-banner";
import { SendingPausedBanner } from "../components/app/sending-paused-banner";
import { SubscriptionBanner } from "../components/app/subscription-banner";
import { BottomNav } from "../components/dashboard/bottom-nav";
import { MobileHeader } from "../components/dashboard/mobile-header";
import { Sidebar } from "../components/dashboard/sidebar";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useOrderToastNotifications } from "../hooks/useOrderToastNotifications";

export const Route = createFileRoute("/app")({
	// `actAs` is the admin act-as retailer id; retained across every /app/*
	// navigation so an admin doesn't drop out of a seller's store on each click,
	// and it survives refresh (URL-encoded). See docs/admin-console.md.
	validateSearch: (search: Record<string, unknown>): { actAs?: string } => ({
		actAs: typeof search.actAs === "string" ? search.actAs : undefined,
	}),
	search: { middlewares: [retainSearchParams(["actAs"])] },
	head: () => ({
		meta: [{ name: "robots", content: "noindex, nofollow" }],
	}),
	component: AppLayout,
});

function AppLayout() {
	return (
		<Show
			when="signed-in"
			fallback={<RedirectToSignIn signInForceRedirectUrl="/app" />}
		>
			<AppShell />
		</Show>
	);
}

function AppShell() {
	const navigate = useNavigate();
	const location = useLocation();
	const { actAs } = Route.useSearch();
	const retailer = useDashboardRetailer();
	const actingAsAdmin = retailer?.actingAsAdmin === true;
	const counts = useQuery(
		api.orders.countActionable,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	const actionableCount = (counts?.pending ?? 0) + (counts?.confirmed ?? 0);
	const isAdminResult = useQuery(api.billing.amIAdmin);
	const isAdmin = isAdminResult ?? false;
	useOrderToastNotifications(counts);

	// An admin doesn't need a store of their own — they can run the console and
	// operate other vendors' stores. When they have no store (and aren't acting-as),
	// the dashboard renders in admin-only mode instead of forcing onboarding.
	const onAdminRoute = location.pathname.startsWith("/app/admin");
	const storelessAdmin =
		retailer === null && !actAs && isAdminResult === true && onAdminRoute;

	useEffect(() => {
		if (retailer !== null) return;
		// Stale/foreign act-as id → back to the directory.
		if (actAs) {
			navigate({ to: "/app/admin/sellers", search: { actAs: undefined } });
			return;
		}
		// Wait for the admin check before deciding where a storeless user goes.
		if (isAdminResult === undefined) return;
		// A non-admin with no store still has to onboard.
		if (!isAdminResult) {
			navigate({ to: "/onboarding" });
			return;
		}
		// Storeless admin: keep them within the admin area (seller screens need a
		// store). Landing on `/app` or any seller route bounces to the directory.
		if (!onAdminRoute) navigate({ to: "/app/admin/sellers" });
	}, [retailer, actAs, isAdminResult, onAdminRoute, navigate]);

	// One-shot backfill: if the retailer has no notifyEmail yet, copy it from
	// their Clerk identity email so existing accounts get auto-populated
	// without a manual visit to Settings. Idempotent on the server side; the
	// ref guard just stops us re-firing within the same session.
	const ensureNotifyEmail = useMutation(
		api.retailers.ensureNotifyEmailFromIdentity,
	);
	const triedNotifyEmailBackfill = useRef(false);
	useEffect(() => {
		if (triedNotifyEmailBackfill.current) return;
		if (!retailer) return;
		// Skip in act-as: this backfill resolves by the CALLER's identity, so an
		// admin firing it would touch their own store, never the seller's — pointless
		// and confusing. The seller's own session will run it.
		if (actingAsAdmin) return;
		if (retailer.notifyEmail && retailer.notifyEmail.trim().length > 0) return;
		triedNotifyEmailBackfill.current = true;
		ensureNotifyEmail({}).catch(() => {
			// Non-fatal — retailer can still set the email manually in settings.
		});
	}, [retailer, actingAsAdmin, ensureNotifyEmail]);

	// Render the shell once we have a store (own or act-as) OR the caller is a
	// storeless admin on an admin route. Everything else (loading, or redirecting
	// a non-admin to onboarding) shows the skeleton.
	if (retailer === undefined) return <ShellSkeleton />;
	if (retailer === null && !storelessAdmin) return <ShellSkeleton />;

	return (
		<div className="flex min-h-dvh">
			<Sidebar
				retailer={retailer}
				actionableCount={actionableCount}
				isAdmin={isAdmin}
			/>
			<div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:mx-0 lg:max-w-none">
				{retailer?.actingAsAdmin ? (
					<ActingAsBanner storeName={retailer.storeName} />
				) : null}
				<MobileHeader retailer={retailer} />
				{/* Store-specific banners only when operating a store. */}
				{retailer ? (
					<>
						<SendingPausedBanner
							paused={retailer.sendingPaused}
							reason={retailer.sendingPauseReason}
							slug={retailer.slug}
						/>
						<ConsentBanner
							versions={{
								termsVersion: retailer.termsVersion,
								privacyVersion: retailer.privacyVersion,
								aupVersion: retailer.aupVersion,
							}}
						/>
						<SubscriptionBanner
							subscription={retailer.subscription}
							slug={retailer.slug}
						/>
					</>
				) : null}
				<main className="flex-1 px-5 py-6 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8 lg:py-8">
					<Outlet />
				</main>
				<BottomNav actionableCount={actionableCount} adminOnly={!retailer} />
			</div>
		</div>
	);
}

function ShellSkeleton() {
	return (
		<div className="flex min-h-dvh">
			{/* Desktop sidebar placeholder */}
			<aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
				<div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
					<div className="h-8 w-8 animate-pulse rounded bg-muted" />
					<div className="flex flex-col gap-1">
						<div className="h-3 w-24 animate-pulse rounded bg-muted" />
						<div className="h-2 w-20 animate-pulse rounded bg-muted" />
					</div>
				</div>
				<div className="flex flex-col gap-1 p-2">
					{[0, 1, 2, 3].map((n) => (
						<div
							key={n}
							className="h-10 animate-pulse rounded-lg bg-muted/40"
						/>
					))}
				</div>
			</aside>

			<div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:mx-0 lg:max-w-none">
				{/* Mobile header placeholder */}
				<header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:hidden">
					<div className="flex items-center gap-2.5">
						<div className="h-8 w-8 animate-pulse rounded bg-muted" />
						<div className="flex flex-col gap-1.5">
							<div className="h-4 w-28 animate-pulse rounded bg-muted" />
							<div className="h-3 w-36 animate-pulse rounded bg-muted" />
						</div>
					</div>
					<div className="size-8 animate-pulse rounded-full bg-muted" />
				</header>

				<main className="flex-1 px-5 py-6 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8 lg:py-8">
					<div className="flex flex-col gap-6">
						{/* Desktop page-header placeholder */}
						<div className="hidden lg:block">
							<div className="flex flex-col gap-3 border-b border-border pb-5">
								<div className="flex items-end justify-between gap-6">
									<div className="flex min-w-0 flex-col gap-2">
										<div className="h-7 w-40 animate-pulse rounded bg-muted" />
										<div className="h-4 w-56 animate-pulse rounded bg-muted" />
									</div>
								</div>
							</div>
						</div>
						{/* Mobile title placeholder */}
						<div className="flex flex-col gap-1.5 lg:hidden">
							<div className="h-6 w-28 animate-pulse rounded bg-muted" />
							<div className="h-3 w-40 animate-pulse rounded bg-muted" />
						</div>
						{/* Generic content blocks */}
						<div className="flex flex-col gap-4">
							{[0, 1, 2].map((n) => (
								<div
									key={n}
									className="h-24 animate-pulse rounded-2xl border border-border bg-card"
								/>
							))}
						</div>
					</div>
				</main>
			</div>
		</div>
	);
}
