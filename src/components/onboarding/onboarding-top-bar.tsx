import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";

/**
 * The onboarding page's brand + account bar. Before this the page was bare —
 * no logo (nothing said "you're at Kedaipal") and no way out of the signed-in
 * account short of creating a store. The bar fixes both, inside the same
 * max-w-md container as the form:
 *
 *  - the Kedaipal mark, linking back to the landing page (the pattern the
 *    marketing nav and storefront header already use);
 *  - the signed-in email + Log out. The email is the real fix for the
 *    "forced to create a store" feeling: the store is about to be owned 1:1
 *    by THIS Clerk account, so the seller should see which account that is —
 *    and have the exit right there if it's the wrong one. Log out redirects
 *    to the landing page (not back here, which would bounce straight into
 *    the sign-in wall).
 */
export function OnboardingTopBar() {
	const { signOut } = useClerk();
	const { user } = useUser();
	const [signingOut, setSigningOut] = useState(false);
	const email = user?.primaryEmailAddress?.emailAddress;

	return (
		<header className="flex items-center justify-between gap-3">
			<Link
				to="/"
				aria-label="Kedaipal home"
				className="flex min-h-11 shrink-0 items-center"
			>
				<AppImage
					src="/logo-3.svg"
					alt="Kedaipal"
					aspect="h-6 w-auto"
					fill={false}
					priority
				/>
			</Link>
			<div className="flex min-w-0 items-center gap-1.5">
				{email ? (
					// Which account the new store will belong to — truncated, with the
					// full address on hover for the long ones.
					<span
						className="min-w-0 truncate text-xs text-muted-foreground"
						title={email}
					>
						{email}
					</span>
				) : null}
				<Button
					type="button"
					variant="ghost"
					disabled={signingOut}
					onClick={() => {
						setSigningOut(true);
						void signOut({ redirectUrl: "/" });
					}}
					className="h-11 shrink-0 gap-1.5 px-3 text-muted-foreground"
				>
					<LogOut className="size-4" aria-hidden />
					{signingOut ? "Logging out…" : "Log out"}
				</Button>
			</div>
		</header>
	);
}
