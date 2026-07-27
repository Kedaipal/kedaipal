import { useAuth } from "@clerk/tanstack-react-start";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { resolveSignedInDestination } from "../../lib/auth-redirect";
import { PageLoader } from "../page-loader";

/**
 * Chrome for `/sign-in` and `/sign-up`: centres the Clerk card, and — the point
 * of this component — takes a visitor who is **already signed in** straight to
 * the dashboard instead of parking them on an auth screen.
 *
 * Why it exists: Clerk's email-link ("magic link") flow completes the sign-in on
 * the *Client*, which every tab of the browser shares — but the card itself stops
 * on "Successfully signed in / Return to original tab to continue", which has no
 * way forward. On a phone the original tab is routinely gone: the link is tapped
 * from the Gmail app, which opens its own browser. That screen is then a dead end,
 * and re-typing kedaipal.com just restarts the loop.
 *
 * Watching `isSignedIn` ourselves means the moment a session exists in *this* tab
 * we move on, so nobody has to hunt for a tab that no longer exists.
 *
 * This is the safety net, not the cure — the cure is verification **codes**
 * instead of links, which is Clerk Dashboard configuration. See `docs/auth.md`.
 */
export function AuthPage({ children }: { children: React.ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	const navigate = useNavigate();
	// `strict: false` — neither auth route declares `validateSearch`; we only want
	// to peek at Clerk's own redirect params, whatever else is on the URL.
	const search = useSearch({ strict: false }) as Record<string, unknown>;
	const destination = resolveSignedInDestination(
		search,
		typeof window === "undefined" ? undefined : window.location.origin,
	);

	useEffect(() => {
		if (!isLoaded || !isSignedIn) return;
		// `replace` so Back doesn't bounce the seller onto the auth card they just
		// cleared, and `href` because the destination is a runtime string.
		navigate({ href: destination, replace: true });
	}, [isLoaded, isSignedIn, destination, navigate]);

	// Hold the Clerk card mounted until auth resolves — it renders its own skeleton,
	// and it still has verification work to do on an email-link landing.
	if (isLoaded && isSignedIn) return <PageLoader />;

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-5 py-12">
			{children}
		</main>
	);
}
