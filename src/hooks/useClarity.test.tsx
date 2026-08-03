// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them safely.
const { initMock, envState, routerState } = vi.hoisted(() => ({
	initMock: vi.fn(),
	envState: { projectId: undefined as string | undefined },
	routerState: { pathname: "/" },
}));

vi.mock("@microsoft/clarity", () => ({ default: { init: initMock } }));

vi.mock("@tanstack/react-router", () => ({
	useRouterState: <T,>({
		select,
	}: {
		select: (state: { location: { pathname: string } }) => T;
	}) => select({ location: { pathname: routerState.pathname } }),
}));

vi.mock("../lib/env", () => ({
	clientEnv: {
		get VITE_CLARITY_PROJECT_ID() {
			return envState.projectId;
		},
	},
}));

/**
 * Imports the hook fresh so its module-level "initialized" flag starts clean.
 * Tests asserting on that guard must reuse the returned component rather than
 * calling this twice — a re-import resets the very state under test.
 */
async function loadHarness() {
	const { useClarity } = await import("./useClarity");
	return function Harness() {
		useClarity();
		return null;
	};
}

beforeEach(() => {
	vi.resetModules();
	initMock.mockClear();
	envState.projectId = undefined;
	routerState.pathname = "/";
});

afterEach(cleanup);

describe("useClarity", () => {
	it("does not initialize when the project ID is unset", async () => {
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initMock).not.toHaveBeenCalled();
	});

	it("initializes Clarity with the configured project ID", async () => {
		envState.projectId = "abc123";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initMock).toHaveBeenCalledTimes(1);
		expect(initMock).toHaveBeenCalledWith("abc123");
	});

	// The module-level guard's real job is surviving unmount → remount. A plain
	// rerender() can't catch a missing guard: useEffect(…, deps) doesn't re-run
	// for the same mounted element, so that assertion passes with or without it.
	it("does not re-initialize after an unmount and remount", async () => {
		envState.projectId = "abc123";
		const Harness = await loadHarness();

		const first = render(<Harness />);
		expect(initMock).toHaveBeenCalledTimes(1);
		first.unmount();

		render(<Harness />);

		expect(initMock).toHaveBeenCalledTimes(1);
	});

	it("does not boot on the buyer tracking page — the URL is a capability secret", async () => {
		envState.projectId = "abc123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initMock).not.toHaveBeenCalled();
	});

	it("boots once the visitor leaves the tracking page", async () => {
		envState.projectId = "abc123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		const { rerender } = render(<Harness />);
		expect(initMock).not.toHaveBeenCalled();

		routerState.pathname = "/";
		rerender(<Harness />);

		expect(initMock).toHaveBeenCalledTimes(1);
	});

	it("still boots on routes that merely share the tracking prefix", async () => {
		envState.projectId = "abc123";
		routerState.pathname = "/tracking-guide";
		const Harness = await loadHarness();

		render(<Harness />);

		expect(initMock).toHaveBeenCalledTimes(1);
	});
});
