// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them safely.
const { initializeMock, sendMock, envState, routerState } = vi.hoisted(() => ({
	initializeMock: vi.fn(),
	sendMock: vi.fn(),
	envState: { measurementId: undefined as string | undefined },
	routerState: { pathname: "/" },
}));

vi.mock("react-ga4", () => ({
	default: { initialize: initializeMock, send: sendMock },
}));

vi.mock("@tanstack/react-router", () => ({
	useRouterState: <T,>({
		select,
	}: {
		select: (state: { location: { pathname: string } }) => T;
	}) => select({ location: { pathname: routerState.pathname } }),
}));

vi.mock("../lib/env", () => ({
	clientEnv: {
		get VITE_GA_MEASUREMENT_ID() {
			return envState.measurementId;
		},
	},
}));

/**
 * Imports the hook fresh so its module-level "initialized" flag starts clean.
 * Tests asserting on that guard must reuse the returned component rather than
 * calling this twice — a re-import resets the very state under test.
 */
async function loadHarness() {
	const { useGoogleAnalytics } = await import("./useGoogleAnalytics");
	return function Harness() {
		useGoogleAnalytics();
		return null;
	};
}

beforeEach(() => {
	vi.resetModules();
	initializeMock.mockClear();
	sendMock.mockClear();
	envState.measurementId = undefined;
	routerState.pathname = "/";
});

afterEach(cleanup);

describe("useGoogleAnalytics", () => {
	it("does nothing when the measurement ID is unset", async () => {
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initializeMock).not.toHaveBeenCalled();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("initializes once and sends a pageview for the current path", async () => {
		envState.measurementId = "G-TEST123";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initializeMock).toHaveBeenCalledTimes(1);
		expect(initializeMock).toHaveBeenCalledWith("G-TEST123");
		expect(sendMock).toHaveBeenCalledWith({ hitType: "pageview", page: "/" });
	});

	it("never initializes or sends on the buyer tracking page — the URL is a capability secret", async () => {
		envState.measurementId = "G-TEST123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initializeMock).not.toHaveBeenCalled();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("boots on the first non-token path after landing on the tracking page", async () => {
		envState.measurementId = "G-TEST123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		const { rerender } = render(<Harness />);
		expect(sendMock).not.toHaveBeenCalled();

		routerState.pathname = "/k-frozen-food";
		rerender(<Harness />);

		expect(initializeMock).toHaveBeenCalledTimes(1);
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock).toHaveBeenCalledWith({
			hitType: "pageview",
			page: "/k-frozen-food",
		});
	});

	// The guard must sit before send, not only before initialize — an
	// already-booted session navigating onto a token path must stay silent.
	it("does not send the token path even when GA is already initialized", async () => {
		envState.measurementId = "G-TEST123";
		const Harness = await loadHarness();

		const { rerender } = render(<Harness />);
		expect(sendMock).toHaveBeenCalledTimes(1);

		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		rerender(<Harness />);

		expect(sendMock).toHaveBeenCalledTimes(1);
	});

	it("still sends on routes that merely share the tracking prefix", async () => {
		envState.measurementId = "G-TEST123";
		routerState.pathname = "/tracking-guide";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(sendMock).toHaveBeenCalledWith({
			hitType: "pageview",
			page: "/tracking-guide",
		});
	});
});
