// @vitest-environment jsdom
import { useAuth } from "@clerk/tanstack-react-start";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPage } from "./auth-page";

// AuthPage is the escape hatch from Clerk's email-link dead end ("Successfully
// signed in / Return to original tab to continue"): once a session exists in
// THIS tab it must move on by itself, never wait for a tab the seller no longer
// has. These pin that behaviour.
vi.mock("@clerk/tanstack-react-start");
vi.mock("@tanstack/react-router");

const CARD = "clerk-card";

function renderPage() {
	return render(
		<AuthPage>
			<div data-testid={CARD}>Clerk sign-in card</div>
		</AuthPage>,
	);
}

describe("AuthPage", () => {
	let navigate: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		navigate = vi.fn();
		vi.mocked(useNavigate).mockReturnValue(navigate as never);
		vi.mocked(useSearch).mockReturnValue({} as never);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the Clerk card mounted while auth is still loading", () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoaded: false,
			isSignedIn: false,
		} as never);

		renderPage();

		// Clerk renders its own skeleton, and on an email-link landing it still has
		// verification work to do — swapping it for a loader would abort that.
		expect(screen.getByTestId(CARD)).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("renders the card for a signed-out visitor", () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoaded: true,
			isSignedIn: false,
		} as never);

		renderPage();

		expect(screen.getByTestId(CARD)).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("redirects an already-signed-in visitor to the dashboard", () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoaded: true,
			isSignedIn: true,
		} as never);

		renderPage();

		expect(navigate).toHaveBeenCalledWith({ href: "/app", replace: true });
		// The dead-end card is gone the moment the session lands.
		expect(screen.queryByTestId(CARD)).toBeNull();
	});

	it("honours Clerk's redirect_url so an admin invite keeps its prefill", () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoaded: true,
			isSignedIn: true,
		} as never);
		vi.mocked(useSearch).mockReturnValue({
			redirect_url: "/onboarding?p=abc123",
		} as never);

		renderPage();

		expect(navigate).toHaveBeenCalledWith({
			href: "/onboarding?p=abc123",
			replace: true,
		});
	});

	it("ignores an off-origin redirect_url", () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoaded: true,
			isSignedIn: true,
		} as never);
		vi.mocked(useSearch).mockReturnValue({
			redirect_url: "https://evil.com/steal",
		} as never);

		renderPage();

		expect(navigate).toHaveBeenCalledWith({ href: "/app", replace: true });
	});
});
