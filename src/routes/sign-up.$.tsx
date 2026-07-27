import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../components/auth/auth-page";

export const Route = createFileRoute("/sign-up/$")({
	component: SignUpPage,
});

function SignUpPage() {
	return (
		<AuthPage>
			<SignUp
				routing="path"
				path="/sign-up"
				signInUrl="/sign-in"
				// fallback (not force) so an admin invite's signUpForceRedirectUrl —
				// the prefilled /onboarding?…&via=admin URL — survives account creation.
				// Plain self-signups (no redirect param) still land on /onboarding.
				fallbackRedirectUrl="/onboarding"
			/>
		</AuthPage>
	);
}
