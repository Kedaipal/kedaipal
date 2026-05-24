import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { BottomNav } from "../components/dashboard/bottom-nav";
import { MobileHeader } from "../components/dashboard/mobile-header";
import { Sidebar } from "../components/dashboard/sidebar";
import { useOrderToastNotifications } from "../hooks/useOrderToastNotifications";

export const Route = createFileRoute("/app")({
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
	const retailer = useQuery(api.retailers.getMyRetailer);
	const counts = useQuery(
		api.orders.countActionable,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	const actionableCount = (counts?.pending ?? 0) + (counts?.confirmed ?? 0);
	useOrderToastNotifications(counts);

	useEffect(() => {
		if (retailer === null) navigate({ to: "/onboarding" });
	}, [retailer, navigate]);

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
		if (retailer.notifyEmail && retailer.notifyEmail.trim().length > 0) return;
		triedNotifyEmailBackfill.current = true;
		ensureNotifyEmail({}).catch(() => {
			// Non-fatal — retailer can still set the email manually in settings.
		});
	}, [retailer, ensureNotifyEmail]);

	if (retailer === undefined || retailer === null) {
		return <ShellSkeleton />;
	}

	return (
		<div className="flex min-h-dvh">
			<Sidebar retailer={retailer} actionableCount={actionableCount} />
			<div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:mx-0 lg:max-w-none">
				<MobileHeader retailer={retailer} />
				<main className="flex-1 px-5 py-6 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8 lg:py-8">
					<Outlet />
				</main>
				<BottomNav actionableCount={actionableCount} />
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
