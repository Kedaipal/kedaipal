// @vitest-environment jsdom
// Which action prices a live-quote store (z8r3fdbvdy). Calling the wrong one
// prices a seller by rules they haven't been moved to — a deploy must never
// change anyone's fee on its own, only the migration may.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLiveDeliveryQuote } from "./use-live-delivery-quote";

const calls = vi.hoisted(() => ({
	lalamove: vi.fn(),
	live: vi.fn(),
}));

vi.mock("convex/react", async () => {
	const { getFunctionName: name } = await import("convex/server");
	const { api: generated } = await import("../../convex/_generated/api");
	return {
		useAction: (ref: never) =>
			name(ref) === name(generated.liveQuote.quoteForCheckout)
				? calls.live
				: calls.lalamove,
	};
});

const RETAILER = "retailer_1" as Id<"retailers">;

function args(over: Record<string, unknown> = {}) {
	return {
		enabled: true,
		retailerId: RETAILER,
		latitude: 3.139,
		longitude: 101.687,
		getAddressLabel: () => "12 Jalan Ampang, 50450 Kuala Lumpur",
		getAddressParts: () => ({
			city: "Kuala Lumpur",
			state: "Kuala Lumpur",
			postcode: "50450",
		}),
		items: [
			{ variantId: "variant_1" as Id<"productVariants">, quantity: 2 },
		],
		...over,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	calls.lalamove.mockResolvedValue({
		status: "quoted",
		quoteId: "q1",
		fee: 400,
	});
	calls.live.mockResolvedValue({ status: "quoted", quoteId: "q2", fee: 475 });
});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("the store's mode picks the action", () => {
	it("a provider-aware store goes through the multi-provider action", async () => {
		renderHook(() => useLiveDeliveryQuote(args({ providerAware: true })));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.live).toHaveBeenCalledTimes(1);
		expect(calls.lalamove).not.toHaveBeenCalled();
	});

	it("a not-yet-migrated store keeps the single-provider action", async () => {
		renderHook(() => useLiveDeliveryQuote(args({ providerAware: false })));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.lalamove).toHaveBeenCalledTimes(1);
		expect(calls.live).not.toHaveBeenCalled();
	});

	it("defaults to the single-provider action when the mode is unknown", async () => {
		// Absent rather than false — an older client, or a query result that
		// predates the field. Never guess the newer pricing rules.
		renderHook(() => useLiveDeliveryQuote(args()));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.lalamove).toHaveBeenCalledTimes(1);
	});
});

describe("what the provider-aware action is told", () => {
	it("carries the written address, because Delyva prices on the postcode", async () => {
		renderHook(() => useLiveDeliveryQuote(args({ providerAware: true })));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.live.mock.calls[0][0]).toMatchObject({
			postcode: "50450",
			city: "Kuala Lumpur",
			state: "Kuala Lumpur",
		});
	});

	it("carries the cart lines — the server re-reads their weights", async () => {
		renderHook(() => useLiveDeliveryQuote(args({ providerAware: true })));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.live.mock.calls[0][0].items).toEqual([
			{ variantId: "variant_1", quantity: 2 },
		]);
	});

	it("never sends the extra fields to the single-provider action", async () => {
		renderHook(() => useLiveDeliveryQuote(args({ providerAware: false })));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls.lalamove.mock.calls[0][0].postcode).toBeUndefined();
		expect(calls.lalamove.mock.calls[0][0].items).toBeUndefined();
	});
});

describe("the cold-chain refusal reaches the buyer surfaces", () => {
	it("surfaces no_cold_service as its own state, not as a generic failure", async () => {
		calls.live.mockResolvedValue({ status: "no_cold_service" });
		const { result } = renderHook(() =>
			useLiveDeliveryQuote(args({ providerAware: true })),
		);
		// act() flushes the state update the resolved action schedules;
		// waitFor would deadlock, since it polls on real timers.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(result.current).toEqual({ state: "no_cold_service" });
	});

	it("still reports a normal quote", async () => {
		const { result } = renderHook(() =>
			useLiveDeliveryQuote(args({ providerAware: true })),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(result.current).toMatchObject({ state: "quoted", fee: 475 });
	});
});

describe("api surface", () => {
	it("the two actions are distinct functions", () => {
		expect(getFunctionName(api.liveQuote.quoteForCheckout)).not.toBe(
			getFunctionName(api.lalamove.quoteForCheckout),
		);
	});
});
