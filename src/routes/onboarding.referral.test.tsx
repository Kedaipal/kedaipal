// @vitest-environment jsdom
// The referral, restated where the store is born (z8r3fdetf5): the three
// states of the onboarding note — loading, none, an invite.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { referralRefereeOffer } from "../../convex/lib/referral";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
	useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => () => ({}),
	useNavigate: () => vi.fn(),
	useLocation: () => ({ href: "/onboarding" }),
	useRouterState: () => null,
	Link: ({ children }: { children?: React.ReactNode }) => (
		<span>{children}</span>
	),
}));
vi.mock("../components/onboarding/onboarding-top-bar", () => ({
	OnboardingTopBar: () => <div>Kedaipal</div>,
}));

const { ReferralInviteNote } = await import("./onboarding");

afterEach(cleanup);

describe("onboarding referral note", () => {
	test("names the referrer and when the bonus lands", () => {
		render(
			<ReferralInviteNote
				invite={{
					slug: "siti-kitchen",
					storeName: "Siti's Kitchen",
					offer: referralRefereeOffer(),
				}}
			/>,
		);
		expect(screen.getByText("Siti's Kitchen invited you")).toBeTruthy();
		expect(
			screen.getByText(
				/Pay your first invoice and 60 free orders land on Pro, or 30 on Starter/,
			),
		).toBeTruthy();
		expect(screen.getByText(/last 12 months/)).toBeTruthy();
	});

	test("holds its place while the invite resolves", () => {
		const { container } = render(<ReferralInviteNote invite={undefined} />);
		expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});

	test("says nothing without an invite", () => {
		const { container } = render(<ReferralInviteNote invite={null} />);
		expect(container.firstChild).toBeNull();
	});
});

describe("onboarding referred-by chip (the push)", () => {
	test("names the store, confirmed, with one way to change it", async () => {
		const { ReferredByChip } = await import("./onboarding");
		const onChange = vi.fn();
		render(
			<ReferredByChip
				invite={{
					slug: "siti-kitchen",
					storeName: "Siti's Kitchen",
					offer: referralRefereeOffer(),
				}}
				onChange={onChange}
			/>,
		);
		const chip = screen.getByTestId("referred-by-chip");
		expect(chip.textContent).toContain("Siti's Kitchen");
		expect(chip.textContent).toContain("referred you");
		// No input to mistype into — the link already answered the question.
		expect(screen.queryByRole("textbox")).toBeNull();
		// Same label as the field it stands in for; the promise in orders.
		expect(screen.getByText("Which store sent you? (optional)")).toBeTruthy();
		expect(screen.getByText(/Free orders for you both/)).toBeTruthy();
		expect(screen.getByText(/Filled in from the link you opened/)).toBeTruthy();
		screen.getByRole("button", { name: "Not them?" }).click();
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
