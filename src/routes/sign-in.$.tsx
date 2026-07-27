import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../components/auth/auth-page";

export const Route = createFileRoute("/sign-in/$")({
	component: SignInPage,
});

function SignInPage() {
	return (
		<AuthPage>
			<SignIn
				routing="path"
				path="/sign-in"
				signUpUrl="/sign-up"
				fallbackRedirectUrl="/app"
				forceRedirectUrl="/app"
			/>
		</AuthPage>
	);
}
