// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../content/releases";
import { WhatsNewNavItem, WhatsNewProvider } from "./whats-new";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair, matching billing-tab.test.tsx.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

const markSeen = vi.fn().mockResolvedValue({ updated: true });
vi.mock("convex/react", () => ({ useMutation: () => markSeen }));

let pathname = "/app";
vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ pathname }),
	Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

// The running version — the component reads APP_VERSION, which is "dev" under
// vitest (no Vite define). Stub the module so the stamp path is exercised with
// a REAL calendar version; otherwise every test would hit the dev skip and
// prove nothing about stamping.
vi.mock("../../lib/app-version", async () => {
	const actual = await vi.importActual<
		typeof import("../../../convex/lib/appVersion")
	>("../../../convex/lib/appVersion");
	return { ...actual, APP_VERSION: "2026.09.1" };
});

const NOTABLE: Release = {
	version: "2026.09.1",
	date: "2026-09-01",
	notable: true,
	entries: [{ title: { en: "Big thing" }, body: { en: "It is big." } }],
};
const QUIET: Release = {
	version: "2026.08.2",
	date: "2026-08-02",
	notable: false,
	entries: [{ title: { en: "Small thing" }, body: { en: "It is small." } }],
};

vi.mock("../../content/releases", async () => {
	const actual =
		await vi.importActual<typeof import("../../content/releases")>(
			"../../content/releases",
		);
	return {
		...actual,
		get RELEASES() {
			return releasesUnderTest;
		},
	};
});
let releasesUnderTest: Release[] = [];

function mockSeen(value: { seenVersion: string | null } | null | undefined) {
	vi.mocked(useQuery).mockReturnValue({ data: value } as never);
}

function renderShell() {
	return render(
		<WhatsNewProvider locale="en">
			<WhatsNewNavItem variant="row" />
		</WhatsNewProvider>,
	);
}

beforeEach(() => {
	markSeen.mockClear();
	pathname = "/app";
	releasesUnderTest = [NOTABLE, QUIET];
});
afterEach(cleanup);

describe("WhatsNew — silent catch-up", () => {
	it("stamps and shows NOTHING when the seller has no stored version", async () => {
		// Every existing seller on rollout day and every new signup lands here.
		// Replaying a backlog at someone who has used the product for months
		// reads like the product is talking to somebody else.
		mockSeen({ seenVersion: null });
		renderShell();

		await waitFor(() =>
			expect(markSeen).toHaveBeenCalledWith({ version: "2026.09.1" }),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("does nothing at all while the query is still loading", () => {
		mockSeen(undefined);
		renderShell();
		expect(markSeen).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
		// Nothing renders against unknown state, which is why no localStorage
		// mirror is needed to prevent a flash — there is nothing to retract.
		expect(screen.queryByText("What's new")).toBeNull();
	});

	it("renders nothing for a caller with no retailer", () => {
		// Storeless admin — seller release notes have no audience there, and a
		// stamp would fail on every page load.
		mockSeen(null);
		renderShell();
		expect(markSeen).not.toHaveBeenCalled();
		expect(screen.queryByText("What's new")).toBeNull();
	});
});

describe("WhatsNew — who gets interrupted", () => {
	it("opens the modal for an unseen NOTABLE release", async () => {
		mockSeen({ seenVersion: "2026.08.2" });
		renderShell();
		await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
		expect(screen.getByText("Big thing")).toBeTruthy();
	});

	it("does NOT open the modal when the only unseen release is quiet", async () => {
		// The dot is the whole affordance for a non-notable release. A modal on
		// every release trains sellers to dismiss reflexively.
		releasesUnderTest = [QUIET];
		mockSeen({ seenVersion: "2026.08.1" });
		renderShell();
		await waitFor(() => expect(screen.getByLabelText(/unread/i)).toBeTruthy());
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("never opens over the counter checkout flow", async () => {
		// The seller is standing in front of a paying customer — the single worst
		// moment to interrupt. The dot persists, so nothing is lost.
		pathname = "/app/checkout";
		mockSeen({ seenVersion: "2026.08.2" });
		renderShell();
		await waitFor(() => expect(screen.getByLabelText(/unread/i)).toBeTruthy());
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("marks the unseen state in the accessible name, not just a colour dot", async () => {
		// Uses the quiet-release case deliberately: while the modal is open radix
		// marks the background aria-hidden (correctly), so the nav button is out
		// of the accessibility tree and this assertion would be testing the
		// overlay rather than the label.
		releasesUnderTest = [QUIET];
		mockSeen({ seenVersion: "2026.08.1" });
		renderShell();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "What's new (unread updates)" }),
			).toBeTruthy(),
		);
	});

	it("shows no unread marker once the seller is current", async () => {
		mockSeen({ seenVersion: "2026.09.1" });
		renderShell();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "What's new" })).toBeTruthy(),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

describe("WhatsNew — acknowledgement", () => {
	it("stamps when the seller closes the modal", async () => {
		mockSeen({ seenVersion: "2026.08.2" });
		renderShell();
		await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
		expect(markSeen).not.toHaveBeenCalled();

		screen.getByRole("button", { name: "Got it" }).click();
		await waitFor(() =>
			expect(markSeen).toHaveBeenCalledWith({ version: "2026.09.1" }),
		);
	});

	it("still lists past releases the seller has already seen", async () => {
		// Dismissing an announcement must never make it unreadable — that is the
		// entire reason the permanent panel exists alongside the modal.
		mockSeen({ seenVersion: "2026.08.2" });
		renderShell();
		await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
		expect(screen.getByText("Small thing")).toBeTruthy();
	});
});
