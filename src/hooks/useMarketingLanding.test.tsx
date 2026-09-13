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

/** Fresh import so the module-level "landed once" flag starts clean per test. */
async function loadHarness() {
	const { useMarketingLanding } = await import("./useMarketingLanding");
	return function Harness() {
		useMarketingLanding();
		return null;
	};
}

function setUrl(url: string) {
	window.history.replaceState(null, "", url);
}

beforeEach(() => {
	vi.resetModules();
	initializeMock.mockClear();
	eventMock.mockClear();
	envState.measurementId = "G-TEST123";
	sessionStorage.clear();
	setUrl("/");
});

afterEach(cleanup);

describe("useMarketingLanding", () => {
	it("fires land_marketing on mount", async () => {
		const Harness = await loadHarness();

		render(<Harness />);

		expect(eventMock).toHaveBeenCalledWith("land_marketing", {});
	});

	it("captures the visit's ?src= FIRST so the landing event carries it", async () => {
		setUrl("/pricing?src=spotlight-thg");
		const Harness = await loadHarness();

		render(<Harness />);

		expect(eventMock).toHaveBeenCalledWith("land_marketing", {
			src: "spotlight-thg",
		});
		expect(sessionStorage.getItem("kedaipal:marketing-src")).toBe(
			"spotlight-thg",
		);
	});

	it("fires once per page load — navigating between marketing routes is one landing", async () => {
		const Harness = await loadHarness();

		render(<Harness />);
		cleanup();
		render(<Harness />);

		const landings = eventMock.mock.calls.filter(
			([name]) => name === "land_marketing",
		);
		expect(landings).toHaveLength(1);
	});

	it("still captures src on a later marketing hit even though the landing already fired", async () => {
		const Harness = await loadHarness();

		render(<Harness />);
		cleanup();
		setUrl("/cost?src=qr-poster");
		render(<Harness />);

		expect(sessionStorage.getItem("kedaipal:marketing-src")).toBe("qr-poster");
	});
});
