// @vitest-environment jsdom
// Refer & earn (`/app/refer`, the 28 Oct 2026 push): every standing gets a
// page that explains itself, the live page carries the whole share kit, the
// referee list leads with the pending rows, and the list is credits:read.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { MyReferralCard, MyReferralRow } from "../../convex/referrals";

const state: {
	card: MyReferralCard | null | undefined;
	list: { rows: MyReferralRow[]; capped: boolean } | null | undefined;
	creditsRead: boolean;
	role: "owner" | "member";
} = { card: undefined, list: undefined, creditsRead: true, role: "owner" };

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query">; args: unknown }) => {
		if (opts.args === "skip") return { data: undefined };
		const name = getFunctionName(opts.__fn);
		if (name === getFunctionName(api.referrals.myCard))
			return { data: state.card };
		if (name === getFunctionName(api.referrals.myReferrals))
			return { data: state.list };
		return { data: undefined };
	},
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: unknown) => opts,
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
vi.mock("../hooks/useDashboardRetailer", () => ({
	useDashboardRetailer: () => ({
		_id: "r1",
		storeName: "Kek Mak Jah",
		slug: "kekmakjah",
	}),
}));
vi.mock("../hooks/usePermission", () => ({
	usePermission: (area: string) => ({
		canRead: area === "credits" ? state.creditsRead : true,
		canWrite: false,
		role: state.role,
	}),
	useStoreRole: () => state.role,
}));
vi.mock("../lib/ga-events", () => ({ trackReferralShare: vi.fn() }));

const { Route } = await import("./app.refer");
const Page = (Route as unknown as { component: () => React.JSX.Element })
	.component;

afterEach(() => {
	cleanup();
	state.card = undefined;
	state.list = undefined;
	state.creditsRead = true;
	state.role = "owner";
});

const live: MyReferralCard = {
	slug: "kekmakjah",
	link: "https://kedaipal.com/referral/kekmakjah",
	storeName: "Kek Mak Jah",
	standing: { canRefer: true, earnsReward: true },
	offer: { starter: 30, pro: 60 },
	earns: true,
	signedUp: 2,
	started: 1,
	creditsEarned: 60,
	capped: false,
	pending: 1,
	latestPending: { storeName: "Che Ta Nasi Kerabu", createdAt: Date.now() },
};
const rows: MyReferralRow[] = [
	{
		id: "ref2" as MyReferralRow["id"],
		storeName: "Kuih Lab",
		waPhone: null,
		createdAt: Date.now() - 10 * 86_400_000,
		status: "started",
		stage: null,
		rewardedAt: Date.now() - 86_400_000,
		referrerCredits: 60,
		referrerOutcome: "granted",
	},
	{
		id: "ref1" as MyReferralRow["id"],
		storeName: "Che Ta Nasi Kerabu",
		waPhone: "+60 12-345 6789",
		createdAt: Date.now() - 3 * 86_400_000,
		status: "signed_up",
		stage: "invoice_due",
		rewardedAt: null,
		referrerCredits: 0,
		referrerOutcome: null,
	},
];

describe("/app/refer", () => {
	test("live: the offer in orders, the whole share kit, the numbers, how it works", () => {
		state.card = live;
		state.list = { rows: [], capped: false };
		render(<Page />);
		expect(screen.getAllByText("Refer & earn").length).toBeGreaterThan(0);
		expect(screen.getByText("60 orders on us. For both of you.")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Share on WhatsApp/ }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Copy invite link" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /Share image/ })).toBeTruthy();
		expect(screen.getByText(/you each get 60 free orders/)).toBeTruthy();
		// The page's own list carries the waiting rows; no duplicate line.
		expect(screen.queryByTestId("refer-pending")).toBeNull();
		expect(screen.getByRole("button", { name: /Copy message/ })).toBeTruthy();
		expect(screen.getByText("kekmakjah")).toBeTruthy();
		expect(screen.getByText("Signed up").nextSibling?.textContent).toBe("2");
		expect(screen.getByText("Orders earned").nextSibling?.textContent).toBe(
			"60",
		);
		expect(screen.getByText("How it works")).toBeTruthy();
		expect(screen.getByText(/"Kek Mak Jah invited you"/)).toBeTruthy();
		expect(screen.getByText(/No sign-ups through your link yet/)).toBeTruthy();
	});

	test("the referee list leads with the pending row, named, with a WhatsApp nudge", () => {
		state.card = live;
		state.list = { rows, capped: false };
		render(<Page />);
		const items = within(screen.getByTestId("referral-list")).getAllByRole(
			"listitem",
		);
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toContain("Che Ta Nasi Kerabu");
		expect(items[0].textContent).toContain("60 waiting");
		// The referee's real stage, never an assumed "free trial".
		expect(items[0].textContent).toContain(
			"free period over · first invoice due",
		);
		expect(items[0].textContent).not.toContain("trial");
		// How a waiting row pays out is said once, above the list.
		expect(items[0].textContent).not.toContain("A word from you helps");
		expect(screen.getByTestId("referral-list-note").textContent).toContain(
			"A word from you helps",
		);
		const nudge = screen.getByRole("link", { name: /Say hi on WhatsApp/ });
		expect(nudge.getAttribute("href")).toBe("https://wa.me/60123456789");
		expect(items[1].textContent).toContain("Kuih Lab");
		expect(items[1].textContent).toContain("+60 landed");
	});

	test("a referral that paid this store nothing says why ON the row — no hover-only reason", () => {
		state.card = live;
		state.list = {
			rows: [
				{
					...rows[0],
					id: "ref3" as MyReferralRow["id"],
					storeName: "Hammock Haus",
					referrerCredits: 0,
					referrerOutcome: "self",
				},
			],
			capped: false,
		};
		render(<Page />);
		const item = within(screen.getByTestId("referral-list")).getByRole(
			"listitem",
		);
		expect(item.textContent).toContain("Same owner");
		expect(item.textContent).toContain("shares your email or WhatsApp number");
		expect(item.querySelector("[title]")).toBeNull();
	});

	test("Share image opens the image dialog", () => {
		state.card = live;
		state.list = { rows: [], capped: false };
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: /Share image/ }));
		expect(screen.getByText("Share as an image")).toBeTruthy();
		expect(screen.getByTestId("share-image-stage")).toBeTruthy();
	});

	test("a teammate without the Credits grant sees the kit but not the list", () => {
		state.card = live;
		state.creditsRead = false;
		state.role = "member";
		render(<Page />);
		expect(
			screen.getByRole("link", { name: /Share on WhatsApp/ }),
		).toBeTruthy();
		expect(screen.getByText(/don't have access to/)).toBeTruthy();
		expect(screen.queryByTestId("referral-list")).toBeNull();
	});

	test("a comped store: the offer is theirs, no earnings, said plainly", () => {
		state.card = {
			...live,
			standing: { canRefer: true, earnsReward: false },
			earns: false,
			creditsEarned: 0,
		};
		state.list = { rows: [], capped: false };
		render(<Page />);
		expect(
			screen.getByText("60 orders on us, for every kedai you refer."),
		).toBeTruthy();
		expect(screen.getAllByText(/on the house/).length).toBeGreaterThan(0);
		expect(screen.queryByText("Orders earned")).toBeNull();
	});

	test("a trial store is told when the link opens, and still how it works", () => {
		state.card = { ...live, standing: { canRefer: false, reason: "trial" } };
		render(<Page />);
		expect(screen.getByTestId("refer-trial")).toBeTruthy();
		expect(screen.getByText("How it works")).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: /Share on WhatsApp/ }),
		).toBeNull();
	});

	test("a paused store sees why and the way back", () => {
		state.card = { ...live, standing: { canRefer: false, reason: "lapsed" } };
		render(<Page />);
		expect(screen.getByTestId("refer-paused")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Renew in Billing" })).toBeTruthy();
	});

	test("loading paints a skeleton, never a zero", () => {
		state.card = undefined;
		const { container } = render(<Page />);
		expect(screen.queryByText(/orders on us/)).toBeNull();
		expect(container.querySelector(".animate-pulse")).not.toBeNull();
	});
});
