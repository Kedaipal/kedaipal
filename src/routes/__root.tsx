import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	HeadContent,
	Scripts,
	useMatches,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ConvexProvider } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Toaster } from "sonner";
import { PostHogIdentity } from "../components/app/posthog-identity";
import { useClarity } from "../hooks/useClarity";
import { useGoogleAnalytics } from "../hooks/useGoogleAnalytics";
import { usePostHog } from "../hooks/usePostHog";
import { isBuyerRouteId } from "../lib/buyer-routes";
import { getConvexClient, getQueryClient } from "../lib/convex";
import { clientEnv } from "../lib/env";
import { getLocale } from "../paraglide/runtime";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ name: "theme-color", content: "#0F172A" },
			{ name: "robots", content: "index, follow" },
			{ property: "og:site_name", content: "Kedaipal" },
			{ title: "Kedaipal — Order Hub for Small Retailers" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
			{
				rel: "icon",
				type: "image/png",
				sizes: "16x16",
				href: "/favicon-16x16.png",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "32x32",
				href: "/favicon-32x32.png",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "48x48",
				href: "/favicon-48x48.png",
			},
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: "/apple-touch-icon.png",
			},
			{ rel: "manifest", href: "/site.webmanifest" },
		],
	}),
	shellComponent: RootDocument,
});

function Providers({ children }: { children: React.ReactNode }) {
	// Buyer surfaces (storefront family + /track) render Clerk-free: shoppers
	// can never sign in there, and Clerk's boot cost every buyer page view 8
	// requests to per-IP rate-limited endpoints (86eyheqzv — see
	// lib/buyer-routes.ts). Matched route ids — not raw pathnames — decide the
	// branch, so the router's own precedence keeps `/pricing` vs `/$slug`
	// unambiguous. Crossing between a buyer page and a Clerk page remounts the
	// subtree; that crossing is rare (storefront → landing) and a clean remount
	// is exactly what a provider swap needs.
	const isBuyerSurface = useMatches().some((m) => isBuyerRouteId(m.routeId));
	const publishableKey = clientEnv.VITE_CLERK_PUBLISHABLE_KEY;
	if (!publishableKey || !clientEnv.VITE_CONVEX_URL) {
		return <SetupNotice />;
	}
	// Both constructed only past the env guard above — getQueryClient() reaches
	// getConvexClient(), which throws when VITE_CONVEX_URL is unset.
	const convex = getConvexClient();
	const queryClient = getQueryClient();
	// QueryClientProvider wraps BOTH branches: buyer pages read via
	// useQuery(convexQuery(...)) too, and keeping the provider outside the
	// buyer/Clerk switch means the query cache survives that subtree remount.
	return (
		<QueryClientProvider client={queryClient}>
			{isBuyerSurface ? (
				<ConvexProvider client={convex}>{children}</ConvexProvider>
			) : (
				<ClerkProvider publishableKey={publishableKey}>
					<ConvexProviderWithClerk client={convex} useAuth={useAuth}>
						<PostHogIdentity />
						{children}
					</ConvexProviderWithClerk>
				</ClerkProvider>
			)}
		</QueryClientProvider>
	);
}

function SetupNotice() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 text-sm text-foreground">
			<h1 className="text-2xl font-bold">Setup required</h1>
			<p className="text-muted-foreground">
				Missing env vars. Copy <code>.env.local.example</code> to{" "}
				<code>.env.local</code> and fill in Convex + Clerk keys.
			</p>
			<ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
				<li>
					<code>pnpm dlx convex dev</code> — provisions Convex deployment and
					writes <code>VITE_CONVEX_URL</code>.
				</li>
				<li>
					Create a Clerk app at dashboard.clerk.com and paste the publishable
					key into <code>VITE_CLERK_PUBLISHABLE_KEY</code>.
				</li>
				<li>
					In Clerk, add a JWT template named <code>convex</code> and connect it
					from the Convex dashboard.
				</li>
			</ol>
		</main>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	useGoogleAnalytics();
	useClarity();
	usePostHog();
	return (
		<html lang={getLocale()} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="min-h-dvh bg-background font-sans text-foreground antialiased">
				<Providers>{children}</Providers>
				<Toaster richColors position="top-right" />
				<TanStackDevtools
					config={{ position: "bottom-right" }}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
