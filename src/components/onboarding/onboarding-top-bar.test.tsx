// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingTopBar } from "./onboarding-top-bar";

const { signOutMock, userState } = vi.hoisted(() => ({
	signOutMock: vi.fn(),
	userState: {
		user: {
			primaryEmailAddress: { emailAddress: "seller@example.com" },
		} as { primaryEmailAddress: { emailAddress: string } | null } | null,
	},
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useClerk: () => ({ signOut: signOutMock }),
	useUser: () => ({ user: userState.user }),
}));

afterEach(() => {
	cleanup();
	signOutMock.mockReset();
	userState.user = {
		primaryEmailAddress: { emailAddress: "seller@example.com" },
	};
});

/** Real router, not a mock — the logo's landing-page link IS part of what's
 * under test (same harness as product-card.test.tsx). */
function renderBar() {
	const rootRoute = createRootRoute({ component: () => <OnboardingTopBar /> });
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
}

describe("OnboardingTopBar", () => {
	it("brands the page: the Kedaipal mark links back to the landing page", async () => {
		renderBar();
		const home = await screen.findByRole("link", { name: "Kedaipal home" });
		expect(home.getAttribute("href")).toBe("/");
		expect(screen.getByAltText("Kedaipal")).toBeTruthy();
	});

	it("names the signed-in account the store will belong to", async () => {
		renderBar();
		expect(await screen.findByText("seller@example.com")).toBeTruthy();
	});

	it("logs out to the landing page — never back into the sign-in wall", async () => {
		renderBar();
		const btn = await screen.findByRole("button", { name: /log out/i });
		fireEvent.click(btn);
		expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: "/" });
		// Re-clicking mid-sign-out can't fire a second call.
		await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
		expect(screen.getByText("Logging out…")).toBeTruthy();
	});

	it("renders without an email while Clerk is still resolving the user", async () => {
		userState.user = null;
		renderBar();
		expect(
			await screen.findByRole("button", { name: /log out/i }),
		).toBeTruthy();
		expect(screen.queryByText(/@/)).toBeNull();
	});
});
