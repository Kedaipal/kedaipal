// @vitest-environment jsdom
// The sign-in page's redirect contract. Everything here is a Clerk prop, so
// the test reads the props the page hands <SignIn>.

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

	it("is where every Clerk redirect lands — not Clerk's hosted page", () => {
		// RedirectToSignIn (the /app and /onboarding gates) goes wherever
		// ClerkProvider's signInUrl says. Unset, Clerk falls back to its hosted
		// Account Portal, which never sees `withSignUp`, so the handover email's
		// /app link still dead-ended a new vendor. Found driving the gate signed
		// out; rendering the whole root to prove one prop isn't worth it, so the
		// source carries the contract.
		const root = readFileSync(join(__dirname, "__root.tsx"), "utf8");
		const provider = /<ClerkProvider\b[^>]*>/.exec(root)?.[0] ?? "";
		expect(provider).toContain('signInUrl="/sign-in"');
		expect(provider).toContain('signUpUrl="/sign-up"');
	});
});
