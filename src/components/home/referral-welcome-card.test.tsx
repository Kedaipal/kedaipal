// @vitest-environment jsdom
// The referee's welcome card on Home (the 28 Oct 2026 push): shown to a
// referred store until its first invoice is paid, the promise in ORDERS, and
// "Start your plan" lands ON the plan picker, not the top of Billing.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MyReferral } from "../../../convex/referrals";

let referral: MyReferral | null | undefined;
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: referral }),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (_ref: unknown, args: unknown) => args,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		search,
	}: {
		children: ReactNode;
		to: string;
		search?: Record<string, string>;
	}) => (
		<a href={`${to}?${new URLSearchParams(search ?? {}).toString()}`}>
			{children}
		</a>
	),
}));

const { ReferralWelcomeCard } = await import("./referral-welcome-card");
const RID = "r1" as Id<"retailers">;
const base: MyReferral = {
	referrerName: "new new",
	offer: { starter: 30, pro: 60 },
	firstInvoicePaid: false,
	reward: null,
};

afterEach(() => cleanup());

describe("ReferralWelcomeCard", () => {
	test("names who invited them, says the offer in orders, and opens the plan picker", () => {
		referral = base;
		render(<ReferralWelcomeCard retailerId={RID} />);
		const card = screen.getByTestId("referral-welcome");
		expect(card.textContent).toContain(
			"new new invited you — 60 orders are waiting",
		);
		expect(card.textContent).toContain("60 free orders");
		expect(card.textContent).not.toContain("bonus credits");
		const cta = screen.getByRole("link", { name: "Start your plan" });
		expect(cta.getAttribute("href")).toBe(
			"/app/settings?tab=billing&spot=choose_plan",
		);
	});

	test("a deleted referrer still reads as a person", () => {
		referral = { ...base, referrerName: null };
		render(<ReferralWelcomeCard retailerId={RID} />);
		expect(screen.getByText(/a Kedaipal seller invited you/)).toBeTruthy();
	});

	test("gone once the first invoice is paid, and for a store nobody referred", () => {
		referral = { ...base, firstInvoicePaid: true };
		const { container, rerender } = render(
			<ReferralWelcomeCard retailerId={RID} />,
		);
		expect(container.firstChild).toBeNull();
		referral = null;
		rerender(<ReferralWelcomeCard retailerId={RID} />);
		expect(container.firstChild).toBeNull();
	});
});
