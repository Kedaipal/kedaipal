// @vitest-environment jsdom
// The sign-in page's redirect contract. Everything here is a Clerk prop, so
// the test reads the props the page hands <SignIn>.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./sign-in.$";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: unknown) => opts,
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	SignIn: (props: Record<string, unknown>) => (
		<p data-props={JSON.stringify(props)}>Clerk sign-in</p>
	),
}));

const SignInPage = (Route as unknown as { component: () => ReactNode })
	.component;

function signInProps(): Record<string, unknown> {
	render(<SignInPage />);
	return JSON.parse(screen.getByText("Clerk sign-in").dataset.props ?? "{}");
}

afterEach(cleanup);

describe("/sign-in", () => {
	it("lets an address with no account carry on into sign-up (z8r3fdwdvq)", () => {
		// The handover email, alert emails and the landing nav all reach this
		// page for people who may have no login. Email-code sign-in refuses an
		// unknown address outright — "Couldn't find your account" — so without
		// the sign-in-or-up flow a brand-new vendor dead-ends here.
		expect(signInProps().withSignUp).toBe(true);
	});

	it("lands a fresh sign-up on /onboarding, where a waiting store is claimed", () => {
		expect(signInProps().signUpFallbackRedirectUrl).toBe("/onboarding");
	});

	it("keeps sign-in a FALLBACK redirect so ?redirect_url= (team invites) still wins", () => {
		const props = signInProps();
		expect(props.fallbackRedirectUrl).toBe("/app");
		expect(props.forceRedirectUrl).toBeUndefined();
		expect(props.signUpForceRedirectUrl).toBeUndefined();
	});
});
