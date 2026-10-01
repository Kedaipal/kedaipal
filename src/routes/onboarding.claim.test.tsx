// @vitest-environment jsdom
// The vendor's half of the pre-built store handover (docs/prebuilt-stores.md):
// the screen they land on, and the one they land on when they CAN'T take the
// store. Both are states nobody can reach by hand — they need a store built for
// a specific address — so the states are pinned here rather than left to be
// discovered by the one vendor who hits them.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const claimStore = vi.fn(async () => ({ ok: true, slug: "mak-cik-kuih" }));
const navigate = vi.fn();

vi.mock("convex/react", () => ({
	useMutation: () => claimStore,
	useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => () => ({}),
	useNavigate: () => navigate,
	useLocation: () => ({ href: "/onboarding" }),
	Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
	RedirectToSignIn: () => null,
	RedirectToSignUp: () => null,
}));
vi.mock("../components/onboarding/onboarding-top-bar", () => ({
	OnboardingTopBar: () => <div>Kedaipal</div>,
}));

const { ClaimStoreScreen, HandoverBlockedBanner } = await import(
	"./onboarding"
);

afterEach(() => {
	cleanup();
	claimStore.mockClear();
	navigate.mockClear();
});

describe("ClaimStoreScreen", () => {
	function open() {
		render(<ClaimStoreScreen storeName="Mak Cik Kuih" slug="mak-cik-kuih" />);
		return {
			button: screen.getByRole("button", { name: /take over mak cik kuih/i }),
			consent: screen.getByRole("checkbox"),
		};
	}

	test("names the store and shows the real storefront link to open", () => {
		open();
		expect(screen.getByText(/mak cik kuih is set up/i)).toBeTruthy();
		const link = screen.getByRole("link", {
			name: /kedaipal\.com\/mak-cik-kuih/i,
		});
		expect(link.getAttribute("href")).toBe("https://kedaipal.com/mak-cik-kuih");
	});

	test("consent is NOT pre-ticked, and the button says why it's disabled", () => {
		// Consent is the one thing `createUnclaimedStore` deliberately could not
		// give on the vendor's behalf, so this box is the whole of it — a
		// pre-ticked box would make the stamp meaningless.
		const { button, consent } = open();
		expect((consent as HTMLInputElement).checked).toBe(false);
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/tick the box above to continue/i)).toBeTruthy();
		expect(claimStore).not.toHaveBeenCalled();
	});

	test("ticking it enables the claim and states when the trial starts", () => {
		const { button, consent } = open();
		fireEvent.click(consent);
		expect((button as HTMLButtonElement).disabled).toBe(false);
		// The seller is told the clock starts now, not when we built it — the
		// one billing fact that differs from an ordinary signup.
		expect(
			screen.getByText(/free trial starts when you take it over/i),
		).toBeTruthy();
	});

	test("claiming passes the consent through and lands them in the dashboard", async () => {
		const { button, consent } = open();
		fireEvent.click(consent);
		fireEvent.click(button);
		await vi.waitFor(() =>
			expect(claimStore).toHaveBeenCalledWith({ acceptedLegal: true }),
		);
		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/app" }));
	});
});

describe("HandoverBlockedBanner", () => {
	test("renders nothing when no store is waiting", () => {
		const { container } = render(
			<HandoverBlockedBanner claimable={{ state: "none" }} />,
		);
		expect(container.innerHTML).toBe("");
	});

	test("an owner is told WHICH store blocks them and how to clear it", () => {
		// Without this the vendor sees the bare wizard and has no idea the store
		// we built them exists.
		render(
			<HandoverBlockedBanner
				claimable={{
					state: "blocked",
					storeName: "Mak Cik Kuih",
					refusal: { reason: "own_store", storeName: "Their Own Shop" },
				}}
			/>,
		);
		expect(
			screen.getByText(/mak cik kuih is waiting for you — but not on this login/i),
		).toBeTruthy();
		expect(screen.getByText(/already runs Their Own Shop/i)).toBeTruthy();
	});

	test("a teammate is pointed at Settings → Team, the one way out", () => {
		render(
			<HandoverBlockedBanner
				claimable={{
					state: "blocked",
					storeName: "Mak Cik Kuih",
					refusal: { reason: "other_membership", storeName: "Host Store" },
				}}
			/>,
		);
		expect(screen.getByText(/on the team at Host Store/i)).toBeTruthy();
		expect(screen.getByText(/Settings → Team/i)).toBeTruthy();
	});

	test("an unverified email is named as the thing to fix", () => {
		render(
			<HandoverBlockedBanner
				claimable={{
					state: "blocked",
					storeName: "Mak Cik Kuih",
					refusal: { reason: "unverified_email" },
				}}
			/>,
		);
		expect(screen.getByText(/isn't verified yet/i)).toBeTruthy();
		// Never names the auth vendor — a seller has never heard of it.
		expect(screen.queryByText(/clerk/i)).toBeNull();
	});
});
