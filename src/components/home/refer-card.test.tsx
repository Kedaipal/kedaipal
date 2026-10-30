// @vitest-environment jsdom
// Home "Refer & earn" teaser (Referral T3, z8r3fdfp97; reshaped by the 28 Oct
// 2026 push): every standing renders the right card — or none — the offer is
// said in orders, the pending line shows when a referee is waiting, and the
// WhatsApp link carries the one-author message, personalised.
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
const track = vi.fn();
vi.mock("../../lib/ga-events", () => ({
	trackReferralShare: (...args: unknown[]) => track(...args),
}));

const { ReferCard } = await import("./refer-card");

afterEach(() => {
	cleanup();
	track.mockClear();
});

const RID = "r1" as Id<"retailers">;
const base: MyReferralCard = {
	slug: "siti-kitchen",
	link: "https://kedaipal.com/referral/siti-kitchen",
	storeName: "Siti's Kitchen",
	standing: { canRefer: true, earnsReward: true },
	offer: { starter: 30, pro: 60 },
	earns: true,
	signedUp: 0,
	started: 0,
	creditsEarned: 0,
	capped: false,
	pending: 0,
	latestPending: null,
};

describe("ReferCard", () => {
	test("an active store: the offer in orders, WhatsApp + Copy, and the door to the page", () => {
		card = base;
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByRole("heading", { name: "Refer & earn" })).toBeTruthy();
		expect(screen.getByText("60 orders on us. For both of you.")).toBeTruthy();
		const wa = screen.getByRole("link", { name: /Share on WhatsApp/ });
		expect(wa.getAttribute("href")).toBe(
			`https://wa.me/?text=${encodeURIComponent(referralShareMessage(base.link, "Siti's Kitchen"))}`,
		);
		// "Copy INVITE link" — Home's store-link card above already has a
		// "Copy link" for a different link.
		expect(
			screen.getByRole("button", { name: "Copy invite link" }),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /See all/ }).getAttribute("href"),
		).toBe("/app/refer");
		// The teaser holds the first two channels only; the page has the rest.
		expect(screen.queryByText("Share image")).toBeNull();
		// Zero state says what will appear, not a row of zeros.
		expect(screen.getByText(/No sign-ups through your link yet/)).toBeTruthy();
		expect(screen.queryByTestId("refer-pending")).toBeNull();
	});

	test("a WhatsApp tap is counted, with its surface", () => {
		card = base;
		render(<ReferCard retailerId={RID} />);
		screen.getByRole("link", { name: /Share on WhatsApp/ }).click();
		expect(track).toHaveBeenCalledWith("whatsapp", "home");
	});

	test("a waiting referee is the one line that gets the card opened", () => {
		card = {
			...base,
			signedUp: 3,
			started: 1,
			creditsEarned: 60,
			pending: 2,
			latestPending: {
				storeName: "Che Ta Nasi Kerabu",
				createdAt: Date.now() - 3 * 86_400_000,
			},
		};
		render(<ReferCard retailerId={RID} />);
		const pending = screen.getByTestId("refer-pending");
		expect(pending.textContent).toContain("Che Ta Nasi Kerabu");
		expect(pending.textContent).toContain("signed up 3d ago");
		expect(pending.textContent).toContain("1 more waiting");
		expect(pending.textContent).toContain("60 waiting");
		expect(
			screen.getByText("3 signed up · 1 started · 60 orders earned"),
		).toBeTruthy();
	});

	test("a comped partner is told it earns nothing — and no earnings figure", () => {
		card = {
			...base,
			standing: { canRefer: true, earnsReward: false },
			earns: false,
			signedUp: 2,
			pending: 1,
			latestPending: { storeName: "Kuih Lab", createdAt: Date.now() },
		};
		render(<ReferCard retailerId={RID} />);
		expect(
			screen.getByText("60 orders on us, for every kedai you refer."),
		).toBeTruthy();
		expect(screen.getByText(/on the house/)).toBeTruthy();
		expect(screen.getByText("2 signed up · 0 started")).toBeTruthy();
		// The chip says "waiting", never "60 waiting" — nothing is owed to them.
		expect(screen.getByTestId("refer-pending").textContent).not.toContain(
			"60 waiting",
		);
	});

	test("a held or lapsed store sees the link PAUSED, with the way back", () => {
		card = { ...base, standing: { canRefer: false, reason: "paused" } };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByText("Your referral link is paused")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Resume in Billing" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Copy invite link/ }),
		).toBeNull();
		expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
		cleanup();
		card = { ...base, standing: { canRefer: false, reason: "lapsed" } };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByRole("link", { name: "Renew in Billing" })).toBeTruthy();
	});

	test("a trial store is told the programme exists and when it opens", () => {
		card = { ...base, standing: { canRefer: false, reason: "trial" } };
		render(<ReferCard retailerId={RID} />);
		expect(screen.getByTestId("refer-trial").textContent).toContain(
			"unlocks with your plan",
		);
		expect(screen.getByTestId("refer-trial").textContent).toContain(
			"60 orders",
		);
		// A locked feature always shows its door.
		expect(
			screen.getByRole("link", { name: "Start your plan in Billing" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Copy invite link/ }),
		).toBeNull();
	});

	test("nothing while loading, nothing without a store", () => {
		card = undefined;
		const { container, rerender } = render(<ReferCard retailerId={RID} />);
		expect(container.firstChild).toBeNull();
		card = null;
		rerender(<ReferCard retailerId={RID} />);
		expect(container.firstChild).toBeNull();
	});
});
