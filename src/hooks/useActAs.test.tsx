// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
	ACT_AS_STORAGE_KEY,
	ActAsProvider,
	resolveActAs,
	serializeActAsRecord,
	useActAs,
} from "./useActAs";
import type { ActAsViewer } from "./useActAsViewer";

// The act-as session answers only to the Clerk session that started it, and
// only once Convex confirms that viewer is an admin (ClickUp z8r3fdkqn6). The
// bug: the id was stored bare, so after an admin signed out, the next person to
// sign in to the tab inherited it and /app hung on a skeleton for good.
//
// The viewer (Clerk session + Convex's admin verdict) is the seam: each test
// says who is looking, then re-renders as Clerk/Convex would move.
const viewer = vi.hoisted(() => ({
	current: { session: undefined, isAdmin: undefined } as ActAsViewer,
}));
vi.mock("./useActAsViewer", () => ({
	useActAsViewer: () => viewer.current,
}));

const STORE = "rt_acted_store" as Id<"retailers">;
const ADMIN = { userId: "user_admin", sessionId: "sess_admin_1" };
const SELLER = { userId: "user_seller", sessionId: "sess_seller_1" };

function prime(record: { userId: string; sessionId: string }) {
	window.sessionStorage.setItem(
		ACT_AS_STORAGE_KEY,
		serializeActAsRecord({ ...record, retailerId: STORE }),
	);
}

const stored = () => window.sessionStorage.getItem(ACT_AS_STORAGE_KEY);

/** Renders what every dashboard screen reads from the session. */
function Probe() {
	const { actAsRetailerId, pending, setActAs } = useActAs();
	return (
		<div>
			<p data-testid="state">
				{pending ? "pending" : (actAsRetailerId ?? "own store")}
			</p>
			<button type="button" onClick={() => setActAs(STORE)}>
				Open store
			</button>
			<button type="button" onClick={() => setActAs(undefined)}>
				Exit
			</button>
		</div>
	);
}

function mount() {
	const view = render(
		<ActAsProvider>
			<Probe />
		</ActAsProvider>,
	);
	return {
		...view,
		/** Clerk/Convex moved: re-render the provider as they would. */
		as(next: ActAsViewer) {
			viewer.current = next;
			view.rerender(
				<ActAsProvider>
					<Probe />
				</ActAsProvider>,
			);
		},
	};
}

const state = () => screen.getByTestId("state").textContent;

beforeEach(() => {
	viewer.current = { session: ADMIN, isAdmin: true };
});

afterEach(() => {
	cleanup();
	window.sessionStorage.clear();
});

describe("ActAsProvider — the session belongs to the admin who started it", () => {
	it("an admin keeps act-as across a refresh", () => {
		prime(ADMIN);
		const first = mount();
		expect(state()).toBe(STORE);
		// A refresh: the page (and provider) remounts, same Clerk session.
		first.unmount();
		mount();
		expect(state()).toBe(STORE);
		expect(stored()).not.toBeNull();
	});

	it("waits — never guesses — until Clerk and Convex have confirmed the admin", () => {
		prime(ADMIN);
		viewer.current = { session: undefined, isAdmin: undefined };
		const view = mount();
		// Clerk still loading: showing the admin's OWN store here would be a
		// window in which a write lands on the wrong store.
		expect(state()).toBe("pending");
		view.as({ session: ADMIN, isAdmin: undefined });
		// Clerk knows who; Convex hasn't confirmed the identity yet.
		expect(state()).toBe("pending");
		expect(stored()).not.toBeNull();
		view.as({ session: ADMIN, isAdmin: true });
		expect(state()).toBe(STORE);
	});

	it("signing out clears it", () => {
		prime(ADMIN);
		const view = mount();
		expect(state()).toBe(STORE);
		// `/app` keeps the provider mounted across its sign-in gate, so it sees
		// Clerk report nobody signed in.
		view.as({ session: null, isAdmin: false });
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});

	it("another user signing in to the tab never inherits it — not even another admin", () => {
		// An admin, so only the ownership rule — not the admin check — can
		// refuse it. (A seller in the same seat: useDashboardRetailer.test.tsx.)
		prime(ADMIN);
		viewer.current = {
			session: { userId: "user_admin_2", sessionId: "sess_admin_2_1" },
			isAdmin: true,
		};
		mount();
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});

	it("the same admin signing in again starts clean — a new sign-in is a new session", () => {
		prime(ADMIN);
		viewer.current = {
			session: { userId: ADMIN.userId, sessionId: "sess_admin_2" },
			isAdmin: true,
		};
		mount();
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});

	it("a viewer Convex says is not an admin never acts as a store, even with a record in their own name", () => {
		// Hand-written into storage, or an admin removed from the allowlist
		// mid-session: `getRetailerForAdmin` would refuse, so never ask it.
		prime(SELLER);
		viewer.current = { session: SELLER, isAdmin: false };
		mount();
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});

	it("a bare id stored before this fix names no owner and is discarded", () => {
		window.sessionStorage.setItem(ACT_AS_STORAGE_KEY, STORE);
		mount();
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});

	it("opening a store stamps the session with who started it; Exit ends it", () => {
		mount();
		expect(state()).toBe("own store");
		act(() => screen.getByRole("button", { name: "Open store" }).click());
		expect(state()).toBe(STORE);
		expect(JSON.parse(stored() ?? "null")).toEqual({
			...ADMIN,
			retailerId: STORE,
		});
		act(() => screen.getByRole("button", { name: "Exit" }).click());
		expect(state()).toBe("own store");
		expect(stored()).toBeNull();
	});
});

describe("resolveActAs — unreadable records name no owner", () => {
	const admin: ActAsViewer = { session: ADMIN, isAdmin: true };

	it.each([
		["a bare id", "rt_acted_store"],
		["JSON null", "null"],
		["a number", "42"],
		[
			"no session id",
			JSON.stringify({ userId: ADMIN.userId, retailerId: STORE }),
		],
		["an empty store id", JSON.stringify({ ...ADMIN, retailerId: "" })],
	])("%s is discarded", (_label, raw) => {
		expect(resolveActAs(raw, admin)).toEqual({ kind: "discard" });
	});

	it("nothing stored is simply the viewer's own store", () => {
		expect(resolveActAs(null, admin)).toEqual({ kind: "none" });
	});
});
