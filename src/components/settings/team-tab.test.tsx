// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";

// Adapter-pair mock (house pattern — see billing-tab.test.tsx): the component
// reads team.list through convexQuery/useQuery; the fixture below is what the
// server would answer.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
const queryData: { current: unknown } = { current: undefined };
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: queryData.current }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../../hooks/useStoreLock", () => ({
	useStoreLock: () => ({ readOnly: false, reason: "" }),
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60130000000",
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { TeamTab } from "./team-tab";

afterEach(() => {
	cleanup();
	queryData.current = undefined;
});

const RETAILER_ID = "r_team_test" as Id<"retailers">;

type Member = {
	memberId: string;
	status: "invited" | "active";
	email: string;
	displayName?: string;
	permissions?: Record<string, "read" | "write">;
	invitedAt: number;
	acceptedAt?: number;
	expiresAt?: number;
	lastInviteSentAt?: number;
	isSelf: boolean;
};

function teamFixture(overrides: {
	viewerRole?: "owner" | "member" | "admin";
	memberLimit?: number;
	unlimited?: boolean;
	members?: Member[];
}) {
	const members = overrides.members ?? [];
	return {
		viewerRole: overrides.viewerRole ?? "owner",
		seats: {
			memberLimit: overrides.memberLimit ?? 2,
			unlimited: overrides.unlimited ?? false,
			activeCount: members.filter((m) => m.status === "active").length,
			invitedCount: members.filter((m) => m.status === "invited").length,
		},
		members,
	};
}

function mount() {
	return render(<TeamTab retailerId={RETAILER_ID} storeName="Hermoolah" />);
}

describe("TeamTab states", () => {
	it("Starter (0 member seats) renders the locked teaser with the upgrade CTA", () => {
		queryData.current = teamFixture({ memberLimit: 0 });
		mount();
		expect(screen.getByText("Team seats are a Pro feature")).toBeTruthy();
		expect(screen.getByText("Upgrade to Pro")).toBeTruthy();
		// No invite form behind the teaser.
		expect(screen.queryByText("Invite a teammate")).toBeNull();
	});

	it("owner empty state: seat maths counts the owner, explainer + invite form render", () => {
		queryData.current = teamFixture({ memberLimit: 2 });
		mount();
		expect(screen.getByText("1 of 3 seats used")).toBeTruthy();
		expect(screen.getByText(/No teammates yet/)).toBeTruthy();
		expect(screen.getByText("Invite a teammate")).toBeTruthy();
		expect(screen.getByText("Send invitation")).toBeTruthy();
	});

	it("at cap: the invite button is disabled WITH the reason inline", () => {
		queryData.current = teamFixture({
			memberLimit: 2,
			members: [
				{
					memberId: "m1",
					status: "active",
					email: "a@x.com",
					displayName: "Aina",
					permissions: { orders: "write" },
					invitedAt: 1,
					acceptedAt: 2,
					isSelf: false,
				},
				{
					memberId: "m2",
					status: "invited",
					email: "b@x.com",
					invitedAt: 3,
					expiresAt: Date.now() + 86_400_000,
					isSelf: false,
				},
			],
		});
		mount();
		expect(screen.getByText("3 of 3 seats used")).toBeTruthy();
		const button = screen.getByText("Send invitation").closest("button");
		expect(button?.disabled).toBe(true);
		expect(
			screen.getByText(/All 2 member seats are in use/),
		).toBeTruthy();
	});

	it("member view: read-only list with Leave, no invite form, colleagues masked", () => {
		queryData.current = teamFixture({
			viewerRole: "member",
			memberLimit: 2,
			members: [
				{
					memberId: "m1",
					status: "active",
					email: "helper@x.com",
					displayName: "Aina",
					permissions: { orders: "write" },
					invitedAt: 1,
					acceptedAt: 2,
					isSelf: true,
				},
				{
					memberId: "m2",
					status: "active",
					email: "c•••@x.com",
					displayName: "Farid",
					invitedAt: 3,
					acceptedAt: 4,
					isSelf: false,
				},
			],
		});
		mount();
		expect(screen.getByText("Leave")).toBeTruthy();
		expect(screen.queryByText("Invite a teammate")).toBeNull();
		expect(screen.getByText("(you)")).toBeTruthy();
		// Colleague's email arrives masked from the server and renders as-is.
		expect(screen.getByText("c•••@x.com")).toBeTruthy();
	});

	it("pending invite row explains itself (expiry line), expired invite says resend", () => {
		queryData.current = teamFixture({
			memberLimit: 2,
			members: [
				{
					memberId: "m1",
					status: "invited",
					email: "slow@x.com",
					invitedAt: 1,
					expiresAt: Date.now() - 1000,
					isSelf: false,
				},
			],
		});
		mount();
		expect(
			screen.getByText(/Invitation expired — resend/),
		).toBeTruthy();
	});

	it("preset picker prefills the matrix and reports the active preset", () => {
		queryData.current = teamFixture({ memberLimit: 2 });
		mount();
		const helper = screen.getByText("Front-desk helper").closest("button");
		const manager = screen.getByText("Store manager").closest("button");
		expect(helper?.getAttribute("aria-pressed")).toBe("true");
		if (manager) fireEvent.click(manager);
		expect(manager?.getAttribute("aria-pressed")).toBe("true");
		expect(helper?.getAttribute("aria-pressed")).toBe("false");
	});
});
