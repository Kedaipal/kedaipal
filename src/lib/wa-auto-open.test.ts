import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaAutoOpen } from "./wa-auto-open";

describe("createWaAutoOpen", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function make(overrides?: { delayMs?: number; timeoutMs?: number }) {
		const openUrl = vi.fn();
		const onSettled = vi.fn();
		const ctrl = createWaAutoOpen({
			openUrl,
			onSettled,
			delayMs: 600,
			timeoutMs: 4000,
			...overrides,
		});
		return { ctrl, openUrl, onSettled };
	}

	it("navigates after the paint delay, not immediately", () => {
		const { ctrl, openUrl } = make();
		ctrl.start();
		expect(openUrl).not.toHaveBeenCalled();
		vi.advanceTimersByTime(599);
		expect(openUrl).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(openUrl).toHaveBeenCalledTimes(1);
	});

	it("settles via the watchdog when the page never leaves", () => {
		const { ctrl, onSettled } = make();
		ctrl.start();
		vi.advanceTimersByTime(600); // navigate fires
		expect(onSettled).not.toHaveBeenCalled();
		vi.advanceTimersByTime(3999);
		expect(onSettled).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it("settle() (page visible again) stops loading once and kills the watchdog", () => {
		const { ctrl, onSettled } = make();
		ctrl.start();
		vi.advanceTimersByTime(600);
		ctrl.settle(); // buyer came back from WhatsApp
		ctrl.settle(); // duplicate events (pageshow + visibilitychange) are fine
		expect(onSettled).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(10_000); // watchdog must not double-fire
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it("settle() before the delay elapses aborts the navigation", () => {
		const { ctrl, openUrl, onSettled } = make();
		ctrl.start();
		ctrl.settle();
		vi.advanceTimersByTime(10_000);
		expect(openUrl).not.toHaveBeenCalled();
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it("start() is idempotent — one navigation no matter how many calls", () => {
		const { ctrl, openUrl } = make();
		ctrl.start();
		ctrl.start();
		vi.advanceTimersByTime(600);
		expect(openUrl).toHaveBeenCalledTimes(1);
	});

	it("cancel() clears timers and never calls back", () => {
		const { ctrl, openUrl, onSettled } = make();
		ctrl.start();
		ctrl.cancel();
		vi.advanceTimersByTime(10_000);
		expect(openUrl).not.toHaveBeenCalled();
		expect(onSettled).not.toHaveBeenCalled();
	});

	it("start() after cancel() stays dead (unmounted component)", () => {
		const { ctrl, openUrl } = make();
		ctrl.cancel();
		ctrl.start();
		vi.advanceTimersByTime(10_000);
		expect(openUrl).not.toHaveBeenCalled();
	});
});
