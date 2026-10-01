// @vitest-environment jsdom
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { useActAsViewer } from "./useActAsViewer";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (convexQuery passes the ref and args through, useQuery answers).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
// Clerk's raw event stream: the fake keeps each registered listener and its
// options, so a test can emit exactly what clerk-js emits.
const clerkEvents = vi.hoisted(() => ({
	listeners: [] as Array<{
		cb: (r: { session?: unknown; user?: unknown }) => void;
		options?: { skipInitialEmit?: boolean };
	}>,
	unsubscribed: 0,
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: vi.fn(),
	useClerk: () => ({
		addListener: (
			cb: (r: { session?: unknown; user?: unknown }) => void,
			options?: { skipInitialEmit?: boolean },
		) => {
			clerkEvents.listeners.push({ cb, options });
			return () => {
				clerkEvents.unsubscribed += 1;
			};
		},
	}),
}));
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
	clerkEvents.listeners = [];
	clerkEvents.unsubscribed = 0;
});

afterEach(cleanup);

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

describe("useActAsViewer — Clerk's sign-out event", () => {
	function hear() {
		const onSignedOut = vi.fn();
		const hook = renderHook(() => useActAsViewer(onSignedOut));
		const listener = clerkEvents.listeners[clerkEvents.listeners.length - 1];
		return {
			onSignedOut,
			hook,
			listener,
			emit: (r: { session?: unknown; user?: unknown }) => listener.cb(r),
		};
	}

	it("reports a sign-out as clerk-js emits it: both resources undefined, then null", () => {
		// `undefined` is what a UserButton sign-out emits while `useAuth()` reads
		// "loading" — the moment the viewer's own `session` can't carry.
		const { onSignedOut, emit } = hear();
		emit({ session: undefined, user: undefined });
		expect(onSignedOut).toHaveBeenCalledTimes(1);
		emit({ session: null, user: null });
		expect(onSignedOut).toHaveBeenCalledTimes(2);
	});

	it("a signed-in emission — a token refresh, a profile edit — is not a sign-out", () => {
		const { onSignedOut, emit } = hear();
		emit({ session: { id: "sess_1" }, user: { id: "user_admin" } });
		expect(onSignedOut).not.toHaveBeenCalled();
	});

	it("listens for changes only, and stops listening on unmount", () => {
		const { hook, listener } = hear();
		// The state at mount is useAuth()'s to report; this listener exists only
		// for the moment it changes.
		expect(listener.options).toEqual({ skipInitialEmit: true });
		hook.unmount();
		expect(clerkEvents.unsubscribed).toBe(1);
	});
});
