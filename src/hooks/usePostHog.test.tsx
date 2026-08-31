// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them safely.
const { initMock, captureMock, registerMock, envState, routerState } = vi.hoisted(
	() => ({
		initMock: vi.fn(),
		captureMock: vi.fn(),
		registerMock: vi.fn(),
	envState: {
		key: undefined as string | undefined,
		host: undefined as string | undefined,
	},
		routerState: { pathname: "/" },
	}),
);

vi.mock("posthog-js", () => ({
	default: { init: initMock, capture: captureMock, register: registerMock },
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
		get VITE_POSTHOG_KEY() {
			return envState.key;
		},
		get VITE_POSTHOG_HOST() {
			return envState.host;
		},
	},
}));

/**
 * Imports the hook fresh so its module-level boot promise starts clean. Tests
 * asserting on that guard must reuse the returned component rather than calling
 * this twice — a re-import resets the very state under test.
 */
async function loadHarness() {
	const { usePostHog } = await import("./usePostHog");
	return function Harness() {
		usePostHog();
		return null;
	};
}

/**
 * Flush the effect's dynamic import and the .then chain hanging off it. A
 * `vi.waitFor` with an empty body resolves on the first tick — before any of
 * that has run — so this yields real macrotasks instead.
 */
async function settle() {
	for (let i = 0; i < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

beforeEach(() => {
	vi.resetModules();
	initMock.mockClear();
	captureMock.mockClear();
	registerMock.mockClear();
	envState.key = undefined;
	envState.host = undefined;
	routerState.pathname = "/";
});

afterEach(cleanup);

describe("usePostHog", () => {
	it("does not boot when the project key is unset", async () => {
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock).not.toHaveBeenCalled();
	});

	it("boots with the configured key and default host", async () => {
		envState.key = "phc_abc123";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock).toHaveBeenCalledTimes(1);
		expect(initMock.mock.calls[0][0]).toBe("phc_abc123");
		expect(initMock.mock.calls[0][1]).toMatchObject({
			api_host: "https://us.i.posthog.com",
			autocapture: false,
			disable_session_recording: true,
		});
	});

	it("honours a configured host", async () => {
		envState.key = "phc_abc123";
		envState.host = "https://eu.i.posthog.com";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock.mock.calls[0][1]).toMatchObject({
			api_host: "https://eu.i.posthog.com",
		});
	});

	// The tracking URL is the buyer's capability secret and the SDK reads
	// window.location itself, so it must not merely avoid sending — it must not
	// load. Same rule and same predicate as GA and Clarity.
	it("does not boot on the buyer tracking page", async () => {
		envState.key = "phc_abc123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock).not.toHaveBeenCalled();
		expect(captureMock).not.toHaveBeenCalled();
	});

	// /claim carries the STRONGER capability: orderClaims.commit writes a real
	// order and decrements stock. It joined the predicate in PR #227 review.
	it("does not boot on the buyer claim page either", async () => {
		envState.key = "phc_abc123";
		routerState.pathname = "/claim/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock).not.toHaveBeenCalled();
		expect(captureMock).not.toHaveBeenCalled();
	});

	it("boots once the visitor leaves the tracking page", async () => {
		envState.key = "phc_abc123";
		routerState.pathname = "/track/8f3c09b1a7e24d5c9b0e";
		const Harness = await loadHarness();

		const { rerender } = render(<Harness />);
		await settle();
		expect(initMock).not.toHaveBeenCalled();

		routerState.pathname = "/kedai-ali";
		rerender(<Harness />);
		await settle();

		expect(initMock).toHaveBeenCalledTimes(1);
	});

	it("still boots on routes that merely share the tracking prefix", async () => {
		envState.key = "phc_abc123";
		routerState.pathname = "/tracking-guide";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(initMock).toHaveBeenCalledTimes(1);
	});

	// The module-level guard's real job is surviving unmount → remount. A plain
	// rerender() can't catch a missing guard: useEffect(…, deps) doesn't re-run
	// for the same mounted element, so that assertion passes with or without it.
	it("does not re-initialize after an unmount and remount", async () => {
		envState.key = "phc_abc123";
		const Harness = await loadHarness();

		const first = render(<Harness />);
		await settle();
		expect(initMock).toHaveBeenCalledTimes(1);
		first.unmount();

		render(<Harness />);
		await settle();

		expect(initMock).toHaveBeenCalledTimes(1);
	});

	// The guard caches the in-flight PROMISE, so a caller arriving mid-boot
	// awaits the same load and resolves to the same live client — which is what
	// lets it fire its pageview. Swap the cache for a boolean and the second
	// caller resolves to undefined instead, silently dropping that pageview.
	it("hands every caller the same client while the import is in flight", async () => {
		const { bootPostHog } = await import("./usePostHog");

		const [first, second] = await Promise.all([
			bootPostHog("phc_abc123", "https://us.i.posthog.com"),
			bootPostHog("phc_abc123", "https://us.i.posthog.com"),
		]);

		expect(first).toBeDefined();
		expect(second).toBe(first);
		expect(initMock).toHaveBeenCalledTimes(1);
	});

	// PostHog free = ONE project, so dev and prod events share a silo. The super
	// property is the only thing that separates them — and it must be registered
	// before the first $pageview, or that event lands untagged.
	it("tags every event with the environment, before the first pageview", async () => {
		envState.key = "phc_abc123";
		const Harness = await loadHarness();

		render(<Harness />);
		await settle();

		expect(registerMock).toHaveBeenCalledWith({ environment: "development" });
		expect(registerMock.mock.invocationCallOrder[0]).toBeLessThan(
			captureMock.mock.invocationCallOrder[0],
		);
	});

	it("fires a pageview per resolved route", async () => {
		envState.key = "phc_abc123";
		const Harness = await loadHarness();

		const { rerender } = render(<Harness />);
		await settle();
		expect(captureMock).toHaveBeenCalledTimes(1);

		routerState.pathname = "/kedai-ali/p/kuih";
		rerender(<Harness />);
		await settle();

		expect(captureMock).toHaveBeenCalledTimes(2);
		expect(captureMock).toHaveBeenLastCalledWith("$pageview");
	});

	// Buyer routes SSR on the Worker. The effect already guarantees a browser,
	// but the boot seam is where a future caller (a loader, a server route) could
	// get it wrong — and the failure would be a hard SSR crash on a buyer page.
	it("refuses to boot without a window", async () => {
		const { bootPostHog } = await import("./usePostHog");
		vi.stubGlobal("window", undefined);

		await expect(
			bootPostHog("phc_abc123", "https://us.i.posthog.com"),
		).resolves.toBeUndefined();

		expect(initMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
