// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_LOAD_TIMEOUT_MS, useAuthState } from "./useAuthState";

/**
 * "We don't know yet" is its own answer (z8r3fdy2m0): an unresolved Clerk
 * must never read as signed-out, or a signed-in seller watches the landing's
 * sign-up doors flip to their dashboard. But a Clerk that never resolves
 * must not strand a prospect on a placeholder either.
 */

const { auth } = vi.hoisted(() => ({
	auth: { isLoaded: false, isSignedIn: undefined as boolean | undefined },
}));
vi.mock("@clerk/tanstack-react-start", () => ({ useAuth: () => auth }));

beforeEach(() => {
	vi.useFakeTimers();
	auth.isLoaded = false;
	auth.isSignedIn = undefined;
});
afterEach(() => {
	vi.useRealTimers();
});

describe("useAuthState", () => {
	it("is loading until Clerk has loaded — never signed-out by default", () => {
		const { result } = renderHook(() => useAuthState());
		expect(result.current).toBe("loading");
	});

	it("reads Clerk's answer once loaded", () => {
		auth.isLoaded = true;
		auth.isSignedIn = true;
		const { result, rerender } = renderHook(() => useAuthState());
		expect(result.current).toBe("signed-in");
		auth.isSignedIn = false;
		rerender();
		expect(result.current).toBe("signed-out");
	});

	it("falls back to signed-out when Clerk never loads, so the doors appear", () => {
		const { result } = renderHook(() => useAuthState());
		act(() => {
			vi.advanceTimersByTime(AUTH_LOAD_TIMEOUT_MS - 1);
		});
		expect(result.current).toBe("loading");
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe("signed-out");
	});

	it("still moves to signed-in when Clerk loads after the fallback", () => {
		const { result, rerender } = renderHook(() => useAuthState());
		act(() => {
			vi.advanceTimersByTime(AUTH_LOAD_TIMEOUT_MS);
		});
		expect(result.current).toBe("signed-out");
		auth.isLoaded = true;
		auth.isSignedIn = true;
		rerender();
		expect(result.current).toBe("signed-in");
	});

	it("never fires the fallback once Clerk has answered in time", () => {
		const { result, rerender } = renderHook(() => useAuthState());
		auth.isLoaded = true;
		auth.isSignedIn = true;
		rerender();
		act(() => {
			vi.advanceTimersByTime(AUTH_LOAD_TIMEOUT_MS * 2);
		});
		expect(result.current).toBe("signed-in");
	});
});
