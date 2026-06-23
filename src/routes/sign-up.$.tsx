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
				// fallback (not force) so an admin invite's signUpForceRedirectUrl —
				// the prefilled /onboarding?…&via=admin URL — survives account creation.
				// Plain self-signups (no redirect param) still land on /onboarding.
				fallbackRedirectUrl="/onboarding"
			/>
		</main>
	);
}
