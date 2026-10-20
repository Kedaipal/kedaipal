// @vitest-environment jsdom
// Home "Refer a kedai" (Referral T3, z8r3fdfp97): every standing renders the
// right card — or none — and the link + share message come from the one author.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { referralShareMessage } from "../../../convex/lib/referral";
import type { MyReferralCard } from "../../../convex/referrals";

let card: MyReferralCard | null | undefined;
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: card }),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (_ref: unknown, args: unknown) => args,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

const { ReferCard } = await import("./refer-card");

afterEach(cleanup);

const RID = "r1" as Id<"retailers">;
const base: MyReferralCard = {
	slug: "siti-kitchen",
	link: "https://kedaipal.com/referral/siti-kitchen",
	standing: { canRefer: true, earnsReward: true },
	offer: { starter: 30, pro: 60 },
	earns: true,
	signedUp: 0,
	started: 0,
	creditsEarned: 0,
	capped: false,
};

describe("ReferCard", () => {
	test("an active store: the offer both ways, the link and a WhatsApp share", () => {
		card = base;
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByRole("heading", { name: "Refer a kedai" })).toBeTruthy();
		expect(screen.getByText("60 bonus credits")).toBeTruthy();
		expect(screen.getByText("and so do you")).toBeTruthy();
		expect(screen.getByText("siti-kitchen")).toBeTruthy();
		const wa = screen.getByRole("link", { name: /Share on WhatsApp/ });
		expect(wa.getAttribute("href")).toBe(
			`https://wa.me/?text=${encodeURIComponent(referralShareMessage(base.link))}`,
		);
		// Zero state says what will appear, not a row of zeros.
		expect(screen.getByText(/No sign-ups through your link yet/)).toBeTruthy();
		expect(screen.getByText(/last 12\s+months/)).toBeTruthy();
	});

	test("with referrals: signed up, started, credits earned", () => {
		card = { ...base, signedUp: 3, started: 1, creditsEarned: 30 };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByText("Signed up").nextSibling?.textContent).toBe("3");
		expect(
			screen.getByText("Started their plan").nextSibling?.textContent,
		).toBe("1");
		expect(screen.getByText("Credits earned").nextSibling?.textContent).toBe(
			"30",
		);
	});

	test("a comped partner is told it earns nothing — and no earnings column", () => {
		card = {
			...base,
			standing: { canRefer: true, earnsReward: false },
			earns: false,
			signedUp: 2,
		};
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByText(/on the house/)).toBeTruthy();
		expect(screen.queryByText(/and so do you/)).toBeNull();
		expect(screen.queryByText("Credits earned")).toBeNull();
	});

	test("a held or lapsed store sees the link PAUSED, with the way back", () => {
		card = { ...base, standing: { canRefer: false, reason: "paused" } };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByText("Your referral link is paused")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Resume in Billing" }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Copy link/ })).toBeNull();
		cleanup();
		card = { ...base, standing: { canRefer: false, reason: "lapsed" } };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByRole("link", { name: "Renew in Billing" })).toBeTruthy();
	});

	test("a trial store sees nothing; nor does anything while loading", () => {
		card = { ...base, standing: { canRefer: false, reason: "trial" } };
		const { container, rerender } = render(<ReferCard retailerId={RID} />);
		expect(container.firstChild).toBeNull();
		card = undefined;
		rerender(<ReferCard retailerId={RID} />);
		expect(container.firstChild).toBeNull();
	});
});
