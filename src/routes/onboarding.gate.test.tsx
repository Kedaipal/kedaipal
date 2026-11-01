// @vitest-environment jsdom
// The signed-out door into /onboarding (z8r3fdwdvq). The admin's prefilled
// invite used to go straight to SIGN-UP because plain sign-in dead-ended on a
// new address, which just swapped one dead end for another: an invite to an
// address that already had a login hit "email already taken". Now sign-in
// creates the login for an unknown address itself, so EVERY signed-out visitor
// takes that one door, and both legs come back to the exact URL they left from,
// prefill token included.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const location = { href: "/onboarding" };

vi.mock("@clerk/tanstack-react-start", () => ({
	// Signed out: the gate renders its fallback.
	Show: ({ fallback }: { fallback: React.ReactNode }) => fallback,
	RedirectToSignIn: (props: Record<string, string>) => (
		<p data-props={JSON.stringify(props)}>to sign-in</p>
	),
	RedirectToSignUp: () => <p>to sign-up</p>,
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: object) => ({ ...opts, useSearch: () => ({}) }),
	useNavigate: () => vi.fn(),
	useLocation: () => location,
	Link: ({ children }: { children?: React.ReactNode }) => (
		<span>{children}</span>
	),
}));
vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
	useAction: () => vi.fn(),
}));
vi.mock("../components/onboarding/onboarding-top-bar", () => ({
	OnboardingTopBar: () => null,
}));

const { Route } = await import("./onboarding");
const Gate = (Route as unknown as { component: () => React.ReactNode })
	.component;

afterEach(cleanup);

function signInRedirect() {
	render(<Gate />);
	expect(screen.queryByText("to sign-up")).toBeNull();
	return JSON.parse(screen.getByText("to sign-in").dataset.props ?? "{}");
}

describe("/onboarding — signed out", () => {
	test.each([
		["a plain visit", "/onboarding"],
		[
			"the admin's prefilled invite",
			"/onboarding?p=eyJzdG9yZSI6Ik1hayBDaWsgS3VpaCJ9",
		],
	])("%s goes to sign-in, and both legs come back to the same URL", (_, href) => {
		location.href = href;
		expect(signInRedirect()).toEqual({
			signInForceRedirectUrl: href,
			signUpForceRedirectUrl: href,
		});
	});
});
