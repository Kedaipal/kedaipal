import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up/$")({
	component: SignUpPage,
});

function SignUpPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-5 py-12">
			<SignUp
				routing="path"
				path="/sign-up"
				signInUrl="/sign-in"
				// fallback (not force) so a ?redirect_url= survives account creation
				// — a team invite's "Create your login" sends /join/<token>. Plain
				// self-signups (no redirect param) land on /onboarding. Every gate
				// that bounces a signed-out visitor goes to /sign-in instead, which
				// creates the login itself for an unknown address (z8r3fdwdvq).
				fallbackRedirectUrl="/onboarding"
			/>
		</main>
	);
}
