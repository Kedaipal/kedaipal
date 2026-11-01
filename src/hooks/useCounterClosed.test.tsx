// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	useCounterClosed,
	useCounterClosedReason,
	useCounterLowCredit,
} from "./useCounterClosed";

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("./useDashboardRetailer", () => ({
	useDashboardRetailer: () => ({ _id: "r1" }),
}));

const OPEN = { availability: { state: "open" } };
const ON_HOLD = { availability: { state: "paused", by: "hold" } };
const CREDIT_CLOSED = {
	closedReason: "You're out of credits, so the counter can't ring up a sale.",
	unlockRoute: "topup",
	audience: "owner",
	lowCreditLine: null,
};
const CREDIT_OPEN = { ...CREDIT_CLOSED, closedReason: null };

/** Answer each of the hook's two reads by the function it asks for (the
 * generated `api` refs are proxies, so they're compared by NAME). */
function mockReads(availability: unknown, credit: unknown) {
	vi.mocked(useQuery).mockImplementation(((q?: { __fn: never }) => {
		const name = q ? getFunctionName(q.__fn) : undefined;
		return {
			data:
				name === "storeAvailability:forSeller"
					? availability
					: name === "creditLock:counterCreditState"
						? credit
						: undefined,
		};
	}) as never);
}

beforeEach(() => vi.mocked(useQuery).mockReset());

describe("useCounterClosed — one closed reason, availability first", () => {
	test("open on both counts → null", () => {
		mockReads(OPEN, CREDIT_OPEN);
		expect(renderHook(() => useCounterClosed()).result.current).toBeNull();
	});

	test("no credit in hand closes it, carrying the way back", () => {
		mockReads(OPEN, CREDIT_CLOSED);
		expect(renderHook(() => useCounterClosed()).result.current).toEqual({
			reason: CREDIT_CLOSED.closedReason,
			creditLock: { unlockRoute: "topup", audience: "owner" },
		});
		// The disabled buttons read the same sentence.
		expect(renderHook(() => useCounterClosedReason()).result.current).toBe(
			CREDIT_CLOSED.closedReason,
		);
	});

	test("a hold OUTRANKS credits — topping up a held store reopens nothing", () => {
		mockReads(ON_HOLD, CREDIT_CLOSED);
		const closed = renderHook(() => useCounterClosed()).result.current;
		expect(closed?.reason).toMatch(/Off-Season Hold/);
		expect(closed?.creditLock).toBeNull();
	});

	test("a store credits don't apply to (null) is never closed for them", () => {
		mockReads(OPEN, null);
		expect(renderHook(() => useCounterClosed()).result.current).toBeNull();
	});
});

describe("useCounterLowCredit", () => {
	test("the heads-up, with a top-up link only for a reader who can take it", () => {
		mockReads(OPEN, { ...CREDIT_OPEN, lowCreditLine: "3 orders left" });
		expect(renderHook(() => useCounterLowCredit()).result.current).toEqual({
			line: "3 orders left",
			canTopUp: true,
		});
		mockReads(OPEN, {
			...CREDIT_OPEN,
			audience: "member",
			lowCreditLine: "3 orders left",
		});
		expect(
			renderHook(() => useCounterLowCredit()).result.current?.canTopUp,
		).toBe(false);
	});

	test("nothing when not low", () => {
		mockReads(OPEN, CREDIT_OPEN);
		expect(renderHook(() => useCounterLowCredit()).result.current).toBeNull();
	});
});
