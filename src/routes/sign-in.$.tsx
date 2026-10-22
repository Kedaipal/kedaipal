import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in/$")({
	component: SignInPage,
});

function SignInPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-5 py-12">
			<SignIn
				routing="path"
				path="/sign-in"
				signUpUrl="/sign-up"
				// fallback (not force) — team invites (86exr91r4) send an existing
				// account through sign-in with ?redirect_url=/join/<token>, and a
				// FORCED /app would eat that link (an invitee would land on "create
				// your store" instead of the invite). Plain sign-ins still land on
				// /app; only an explicit redirect_url can steer elsewhere — the
				// same posture sign-up has carried since the admin-invite flow.
				fallbackRedirectUrl="/app"
				// Sign-in-or-up (z8r3fdwdvq): an address with no account carries on
				// into creating one instead of dead-ending on "Couldn't find your
				// account". New people reach this page without choosing to — the
				// handover email's /app link, an alert email's order link, the
				// landing nav's "Sign in" — and email-code sign-in can't recover
				// from a wrong door. The continued sign-up honours the same
				// redirect_url; without one it lands on /onboarding like any
				// self-signup, which is also where a waiting pre-built store is
				// claimed.
				withSignUp
				signUpFallbackRedirectUrl="/onboarding"
			/>
		</main>
	);
}
