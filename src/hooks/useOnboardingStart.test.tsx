// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initializeMock, eventMock, envState } = vi.hoisted(() => ({
	initializeMock: vi.fn(),
	eventMock: vi.fn(),
	envState: { measurementId: "G-TEST123" as string | undefined },
}));

vi.mock("react-ga4", () => ({
	default: { initialize: initializeMock, event: eventMock, send: vi.fn() },
}));

vi.mock("../lib/env", () => ({
	clientEnv: {
		get VITE_GA_MEASUREMENT_ID() {
			return envState.measurementId;
		},
	},
}));

/** Fresh import so ga-events' module-level init flag starts clean per test. */
async function loadHarness() {
	const { useOnboardingStart } = await import("./useOnboardingStart");
	return function Harness({
		retailer,
	}: {
		retailer: object | null | undefined;
	}) {
		useOnboardingStart(retailer);
		return null;
	};
}

function starts() {
	return eventMock.mock.calls.filter(([name]) => name === "onboarding_start");
}

beforeEach(() => {
	vi.resetModules();
	initializeMock.mockClear();
	eventMock.mockClear();
	envState.measurementId = "G-TEST123";
	sessionStorage.clear();
	window.history.replaceState(null, "", "/onboarding");
});

afterEach(cleanup);

describe("useOnboardingStart", () => {
	it("fires once the query resolves to 'no store yet'", async () => {
		const Harness = await loadHarness();

		const { rerender } = render(<Harness retailer={undefined} />);
		rerender(<Harness retailer={null} />);

		expect(starts()).toHaveLength(1);
	});

	it("does NOT fire while the retailer query is still loading", async () => {
		const Harness = await loadHarness();

		render(<Harness retailer={undefined} />);

		expect(starts()).toHaveLength(0);
	});

	it("does NOT fire for an already-onboarded seller (they get redirected, not onboarded)", async () => {
		const Harness = await loadHarness();

		const { rerender } = render(<Harness retailer={undefined} />);
		rerender(<Harness retailer={{ _id: "r1" }} />);

		expect(starts()).toHaveLength(0);
	});

	it("fires only once across re-renders", async () => {
		const Harness = await loadHarness();

		const { rerender } = render(<Harness retailer={null} />);
		rerender(<Harness retailer={null} />);
		rerender(<Harness retailer={null} />);

		expect(starts()).toHaveLength(1);
	});

	it("captures a direct /onboarding?src= tag FIRST so the event carries it", async () => {
		window.history.replaceState(null, "", "/onboarding?src=referral-mimi");
		const Harness = await loadHarness();

		render(<Harness retailer={null} />);

		expect(eventMock).toHaveBeenCalledWith("onboarding_start", {
			src: "referral-mimi",
		});
		expect(sessionStorage.getItem("kedaipal:marketing-src")).toBe(
			"referral-mimi",
		);
	});
});
