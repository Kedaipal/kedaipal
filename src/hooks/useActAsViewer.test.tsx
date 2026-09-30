// @vitest-environment jsdom
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { useActAsViewer } from "./useActAsViewer";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (convexQuery passes the ref and args through, useQuery answers).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@clerk/tanstack-react-start", () => ({ useAuth: vi.fn() }));
vi.mock("convex/react", () => ({ useConvexAuth: vi.fn() }));

const AMI_ADMIN = getFunctionName(api.billing.amIAdmin);
let amIAdmin: boolean | undefined;
let askedWith: unknown[];

function clerk(state: {
	isLoaded: boolean;
	userId?: string | null;
	sessionId?: string | null;
}) {
	vi.mocked(useAuth).mockReturnValue(state as never);
}

function convexAuth(isLoading: boolean, isAuthenticated: boolean) {
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading, isAuthenticated });
}

beforeEach(() => {
	amIAdmin = undefined;
	askedWith = [];
	vi.mocked(useQuery).mockImplementation(((q: {
		__fn: FunctionReference<"query">;
		args: unknown;
	}) => {
		if (getFunctionName(q.__fn) === AMI_ADMIN) askedWith.push(q.args);
		return { data: q.args === "skip" ? undefined : amIAdmin };
	}) as never);
	clerk({ isLoaded: true, userId: "user_admin", sessionId: "sess_1" });
	convexAuth(false, true);
});

const view = () => renderHook(() => useActAsViewer()).result.current;

describe("useActAsViewer", () => {
	it("names the Clerk session — the thing an act-as session is bound to", () => {
		amIAdmin = true;
		expect(view()).toEqual({
			session: { userId: "user_admin", sessionId: "sess_1" },
			isAdmin: true,
		});
	});

	it("an anonymous answer from before Convex confirmed the identity is not a verdict", () => {
		// The refresh race: the query goes out before Convex attaches the token
		// and is answered for an anonymous caller. Believing it would end an
		// admin's act-as session on every refresh.
		convexAuth(true, false);
		amIAdmin = false;
		expect(view().isAdmin).toBeUndefined();
	});

	it("once Convex has confirmed the identity, its answer is the verdict", () => {
		amIAdmin = false;
		expect(view().isAdmin).toBe(false);
		amIAdmin = undefined; // still in flight
		expect(view().isAdmin).toBeUndefined();
	});

	it("an identity Convex rejected is not an admin — no waiting on it forever", () => {
		convexAuth(false, false);
		amIAdmin = true; // a stale cache entry must not count either
		expect(view().isAdmin).toBe(false);
	});

	it("is undefined while Clerk loads, and asks nothing", () => {
		clerk({ isLoaded: false });
		convexAuth(true, false);
		expect(view()).toEqual({ session: undefined, isAdmin: undefined });
		expect(askedWith).toEqual(["skip"]);
	});

	it("is nobody when signed out, and asks nothing", () => {
		clerk({ isLoaded: true, userId: null, sessionId: null });
		convexAuth(false, false);
		expect(view()).toEqual({ session: null, isAdmin: false });
		expect(askedWith).toEqual(["skip"]);
	});
});
