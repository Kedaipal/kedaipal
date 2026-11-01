import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useMatches,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ConvexProvider } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo } from "react";
import { Toaster } from "sonner";
import type { Country } from "../../convex/lib/country";
import { useClarity } from "../hooks/useClarity";
import { useGoogleAnalytics } from "../hooks/useGoogleAnalytics";
import { useTheme, useThemeSync } from "../hooks/useTheme";
import { isBuyerRouteId } from "../lib/buyer-routes";
import { clerkAppearance } from "../lib/clerk-appearance";
import { clientEnv } from "../lib/env";
import { readVisitorMarket, readVisitorRegion } from "../lib/geo-region";
import { notFoundHeadMeta } from "../lib/not-found";
import { readReferralSlugOnServer } from "../lib/referral-cookie";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import { getLocale } from "../paraglide/runtime";
import type { RouterContext } from "../router";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
	/**
	 * The visitor's region — their stored `RegionToggle` pick if they have one,
	 * otherwise Cloudflare's `CF-IPCountry` — read once at SSR and dehydrated
	 * into the HTML, so the public pricing surfaces paint the right currency on
	 * the first byte and hydration cannot mismatch. It lives on the ROOT route because three surfaces need it
	 * (`/`, `/pricing`, `/cost`) and the root loader does not re-run on
	 * client-side navigation, so a visitor pays for this exactly once. The read
	 * is a header lookup — no I/O — so authenticated `/app` renders that never
	 * use it are not measurably slower for carrying it.
	 */
	loader: (): {
		region: Country | null;
		market: Country | null;
		referralSlug: string | null;
	} => ({
		region: readVisitorRegion(),
		// `/stores`' market (z8r3fdwduz): geo-IP ONLY. Unlike `region` it never
		// reads the pricing toggle's cookie — the directory has no switch, so a
		// stored pricing pick must not decide which market a buyer browses.
		market: readVisitorMarket(),
		// The referral the visitor arrived with (z8r3fdetf5), when they hold
		// the cookie — so the landing reserves the invite's place in the first
		// paint rather than pushing the hero down when it resolves. A cookie
		// read, no I/O, same cost posture as the region above.
		referralSlug: readReferralSlugOnServer(),
	}),
	head: ({ match }) => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ name: "theme-color", content: "#0F172A" },
			{ property: "og:site_name", content: "Kedaipal" },
			// A URL nothing claims, with no layout under it to own the miss, is
			// the root's to title (the page itself is `RouteNotFound`).
			...(match.globalNotFound
				? notFoundHeadMeta("site")
				: [
						{ name: "robots", content: "index, follow" },
						{ title: "Kedaipal — Order Hub for Small Retailers" },
					]),
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
			// The vector mark, padded (the Logo Kit bag mark with ~10% air on
			// every side so it never touches the tab edge); modern browsers
			// prefer it over the PNGs below and it stays crisp at any DPR.
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
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
	// Clerk paints its own widgets from its own palette; hand it ours in dark.
	// Memoised on the theme: `Providers` re-renders on every route match, and a
	// fresh appearance object each time is a prop change Clerk has to diff —
	// harmless today, but one line keeps a restyle on navigation impossible
	// (PR #241 review).
	const { resolved } = useTheme();
	const appearance = useMemo(() => clerkAppearance(resolved), [resolved]);
	// The render's own clients (per request on the server, one in the
	// browser — lib/convex.ts). The QueryClientProvider is mounted by the
	// SSR-query integration around the whole router (src/router.tsx), already
	// outside the buyer/Clerk switch below, so the query cache survives that
	// subtree remount and buyer pages' useQuery(convexQuery(...)) reads share it.
	const { convexQueryClient } = Route.useRouteContext();
	const publishableKey = clientEnv.VITE_CLERK_PUBLISHABLE_KEY;
	if (!publishableKey || !convexQueryClient) {
		return <SetupNotice />;
	}
	const convex = convexQueryClient.convexClient;
	return isBuyerSurface ? (
		<ConvexProvider client={convex}>{children}</ConvexProvider>
	) : (
		// signInUrl/signUpUrl point every Clerk redirect (RedirectToSignIn on
		// the /app and /onboarding gates) at OUR pages. Without them Clerk
		// falls back to its hosted Account Portal, which never sees
		// `/sign-in`'s `withSignUp`. So the handover email's /app link
		// dead-ended a brand-new vendor on the hosted page even after the
		// fix (z8r3fdwdvq; caught driving the gate signed-out).
		<ClerkProvider
			publishableKey={publishableKey}
			appearance={appearance}
			signInUrl="/sign-in"
			signUpUrl="/sign-up"
		>
			<ConvexProviderWithClerk client={convex} useAuth={useAuth}>
				{children}
			</ConvexProviderWithClerk>
		</ClerkProvider>
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
	// `resolved` is handed to sonner, which renders its own surfaces outside our
	// token tree and would otherwise be light-on-light in dark mode.
	const { resolved } = useThemeSync();
	return (
		<html lang={getLocale()} suppressHydrationWarning>
			<head>
				{/* Sets the .dark class BEFORE first paint — without it every
				    dark-mode visitor gets a white flash while React hydrates. On
				    every page: the theme applies to the whole site. Sits above
				    <HeadContent /> so it doesn't queue behind the stylesheet link.
				    See lib/theme.ts. */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time constant, no interpolated input
					dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
				/>
				<HeadContent />
			</head>
			<body className="min-h-dvh bg-background font-sans text-foreground antialiased">
				<Providers>{children}</Providers>
				<Toaster richColors position="top-right" theme={resolved} />
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
