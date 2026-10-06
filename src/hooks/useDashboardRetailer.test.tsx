// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	ACT_AS_STORAGE_KEY,
	ActAsProvider,
	serializeActAsRecord,
} from "./useActAs";
import type { ActAsViewer } from "./useActAsViewer";
import {
	useDashboardRetailer,
	useDashboardRetailerRead,
} from "./useDashboardRetailer";

// Which store /app operates on — the read every dashboard page waits on. The
// production bug (ClickUp z8r3fdkqn6): an admin acting as a store signed out, a
// seller signed in to the same tab, the stale act-as id sent the dashboard to
// `getRetailerForAdmin`, the server refused ("Not authorized"), and — because
// an adapter read that throws just settles as no data — every /app page sat on
// its skeleton forever. These drive the real ActAsProvider; only the viewer
// (Clerk session + Convex's admin verdict) and the Convex reads are stubbed.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
const viewer = vi.hoisted(() => ({
	current: { session: undefined, isAdmin: undefined } as ActAsViewer,
}));
vi.mock("./useActAsViewer", () => ({
	useActAsViewer: () => viewer.current,
}));

const NAME = {
	own: getFunctionName(api.retailers.getMyRetailer),
	asAdmin: getFunctionName(api.retailers.getRetailerForAdmin),
};
const ACTED = "rt_acted_store" as Id<"retailers">;
const ADMIN = { userId: "user_admin", sessionId: "sess_admin" };
const SELLER = { userId: "user_seller", sessionId: "sess_seller" };
const SELLERS_STORE = { _id: "rt_sellers_own", storeName: "Kuih Lapis Co" };
const ACTED_STORE = {
	_id: ACTED,
	storeName: "Bearcamp Malaysia",
	actingAsAdmin: true,
};

type Answer = { data?: unknown; error?: Error | null };
let answers: Record<string, Answer>;
let asked: Array<{ name: string; args: unknown }>;

beforeEach(() => {
	answers = {
		[NAME.own]: { data: SELLERS_STORE },
		[NAME.asAdmin]: { data: ACTED_STORE },
	};
	asked = [];
	vi.mocked(useQuery).mockImplementation(((q: {
		__fn: FunctionReference<"query">;
		args: unknown;
	}) => {
		const name = getFunctionName(q.__fn);
		asked.push({ name, args: q.args });
		if (q.args === "skip") return { data: undefined, error: null };
		return { data: undefined, error: null, ...answers[name] };
	}) as never);
});

afterEach(() => {
	cleanup();
	window.sessionStorage.clear();
});

function primeAdminSession() {
	window.sessionStorage.setItem(
		ACT_AS_STORAGE_KEY,
		serializeActAsRecord({ ...ADMIN, retailerId: ACTED }),
	);
}

const wrapper = ({ children }: { children: ReactNode }) => (
	<ActAsProvider>{children}</ActAsProvider>
);

/** Every non-skipped read of `name`, by args. */
const readsOf = (name: string) =>
	asked.filter((a) => a.name === name && a.args !== "skip").map((a) => a.args);

describe("useDashboardRetailer — whose store /app operates on", () => {
	it("a non-admin with a stale act-as id resolves their own store", () => {
		primeAdminSession(); // left behind by the admin who used this tab
		viewer.current = { session: SELLER, isAdmin: false };
		const { result } = renderHook(() => useDashboardRetailer(), { wrapper });
		expect(result.current).toEqual(SELLERS_STORE);
		// The question the server refuses is never asked…
		expect(readsOf(NAME.asAdmin)).toEqual([]);
		expect(readsOf(NAME.own)).toEqual([{}]);
		// …and the dead session is gone from the tab.
		expect(window.sessionStorage.getItem(ACT_AS_STORAGE_KEY)).toBeNull();
	});

	it("an admin keeps act-as across a refresh", () => {
		primeAdminSession();
		viewer.current = { session: ADMIN, isAdmin: true };
		const first = renderHook(() => useDashboardRetailer(), { wrapper });
		expect(first.result.current).toEqual(ACTED_STORE);
		first.unmount();
		// The refresh: everything remounts, same Clerk session.
		const again = renderHook(() => useDashboardRetailer(), { wrapper });
		expect(again.result.current).toEqual(ACTED_STORE);
		expect(readsOf(NAME.asAdmin)).toContainEqual({ retailerId: ACTED });
		expect(readsOf(NAME.own)).toEqual([]);
	});

	it("signing out clears it", () => {
		primeAdminSession();
		viewer.current = { session: ADMIN, isAdmin: true };
		const { result, rerender } = renderHook(() => useDashboardRetailer(), {
			wrapper,
		});
		expect(result.current).toEqual(ACTED_STORE);
		viewer.current = { session: null, isAdmin: false };
		rerender();
		expect(window.sessionStorage.getItem(ACT_AS_STORAGE_KEY)).toBeNull();
		// Whoever signs in next starts from their own store.
		asked = [];
		viewer.current = { session: SELLER, isAdmin: false };
		rerender();
		expect(result.current).toEqual(SELLERS_STORE);
		expect(readsOf(NAME.asAdmin)).toEqual([]);
	});

	it("while the admin is being confirmed it loads — asking neither store", () => {
		primeAdminSession();
		viewer.current = { session: ADMIN, isAdmin: undefined };
		const { result } = renderHook(() => useDashboardRetailerRead(), {
			wrapper,
		});
		expect(result.current).toEqual({ retailer: undefined, error: null });
		expect(readsOf(NAME.own)).toEqual([]);
		expect(readsOf(NAME.asAdmin)).toEqual([]);
	});
});

describe("useDashboardRetailerRead — a failed read is said, never an endless load", () => {
	beforeEach(() => {
		viewer.current = { session: SELLER, isAdmin: false };
	});

	it("a read that failed with nothing to show is an error", () => {
		const boom = new Error("Server Error");
		answers[NAME.own] = { data: undefined, error: boom };
		const { result } = renderHook(() => useDashboardRetailerRead(), {
			wrapper,
		});
		expect(result.current).toEqual({ retailer: undefined, error: boom });
	});

	it("the acted-as store failing to load is an error too", () => {
		primeAdminSession();
		viewer.current = { session: ADMIN, isAdmin: true };
		const refused = new Error("Not authorized");
		answers[NAME.asAdmin] = { data: undefined, error: refused };
		const { result } = renderHook(() => useDashboardRetailerRead(), {
			wrapper,
		});
		expect(result.current.error).toBe(refused);
	});

	it("a store that loaded and then errors keeps showing", () => {
		answers[NAME.own] = { data: SELLERS_STORE, error: new Error("blip") };
		const { result } = renderHook(() => useDashboardRetailerRead(), {
			wrapper,
		});
		expect(result.current).toEqual({ retailer: SELLERS_STORE, error: null });
	});

	it("a seller with no store yet is null, not an error", () => {
		answers[NAME.own] = { data: null };
		const { result } = renderHook(() => useDashboardRetailerRead(), {
			wrapper,
		});
		expect(result.current).toEqual({ retailer: null, error: null });
	});
});
