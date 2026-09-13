// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBeatLoop } from "./useBeatLoop";

const BEATS = [100, 200, 300] as const;

describe("useBeatLoop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
	});
	afterEach(() => vi.useRealTimers());

	it("advances through the beats and wraps", () => {
		const { result } = renderHook(() => useBeatLoop(true, BEATS));
		expect(result.current).toBe(0);
		act(() => vi.advanceTimersByTime(100));
		expect(result.current).toBe(1);
		act(() => vi.advanceTimersByTime(200));
		expect(result.current).toBe(2);
		act(() => vi.advanceTimersByTime(300));
		expect(result.current).toBe(0);
	});

	it("holds still while inactive", () => {
		const { result } = renderHook(() => useBeatLoop(false, BEATS));
		act(() => vi.advanceTimersByTime(5000));
		expect(result.current).toBe(0);
	});

	it("freezes in a hidden tab and resumes when it is visible again", () => {
		let visibility: DocumentVisibilityState = "hidden";
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => visibility,
		});
		const { result } = renderHook(() => useBeatLoop(true, BEATS));
		act(() => vi.advanceTimersByTime(3000));
		expect(result.current).toBe(0);
		visibility = "visible";
		act(() => vi.advanceTimersByTime(1000));
		expect(result.current).toBe(1);
	});
});
