import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaAutoOpen, isWhatsAppWebview } from "./wa-auto-open";

describe("isWhatsAppWebview", () => {
	it("detects the WhatsApp token in Android in-app browser UAs", () => {
		expect(
			isWhatsAppWebview(
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WhatsApp/2.25.1.75 A",
			),
		).toBe(true);
	});

	it("detects the WhatsApp token in iOS in-app browser UAs", () => {
		expect(
			isWhatsAppWebview(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 WhatsApp/25.1.78 i",
			),
		).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isWhatsAppWebview("some-ua whatsapp/1.0")).toBe(true);
	});

	it("passes ordinary mobile browsers through (auto-fire keeps working)", () => {
		expect(
			isWhatsAppWebview(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
			),
		).toBe(false);
		expect(
			isWhatsAppWebview(
				"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
			),
		).toBe(false);
	});

	it("does not match other in-app webviews (IG/FB keep today's flow)", () => {
		expect(
			isWhatsAppWebview(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 361.0.0.35.82",
			),
		).toBe(false);
	});
});

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

	it("watchdog still arms when openUrl throws — button never stuck loading", () => {
		const openUrl = vi.fn(() => {
			throw new Error("assign blocked");
		});
		const onSettled = vi.fn();
		const ctrl = createWaAutoOpen({
			openUrl,
			onSettled,
			delayMs: 600,
			timeoutMs: 4000,
		});
		ctrl.start();
		// The throw escapes the timer callback, but the finally must have armed
		// the watchdog first.
		expect(() => vi.advanceTimersByTime(600)).toThrow("assign blocked");
		expect(onSettled).not.toHaveBeenCalled();
		vi.advanceTimersByTime(4000);
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it("start() after cancel() stays dead (unmounted component)", () => {
		const { ctrl, openUrl } = make();
		ctrl.cancel();
		ctrl.start();
		vi.advanceTimersByTime(10_000);
		expect(openUrl).not.toHaveBeenCalled();
	});
});
