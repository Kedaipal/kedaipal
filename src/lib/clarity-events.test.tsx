// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them safely.
const { initMock, eventMock, upgradeMock, setTagMock, envState } = vi.hoisted(
	() => ({
		initMock: vi.fn(),
		eventMock: vi.fn(),
		upgradeMock: vi.fn(),
		setTagMock: vi.fn(),
		envState: { projectId: undefined as string | undefined },
	}),
);

vi.mock("@microsoft/clarity", () => ({
	default: {
		init: initMock,
		event: eventMock,
		upgrade: upgradeMock,
		setTag: setTagMock,
	},
}));

vi.mock("./env", () => ({
	clientEnv: {
		get VITE_CLARITY_PROJECT_ID() {
			return envState.projectId;
		},
	},
}));

/**
 * Imports fresh so the module-level "initialized" flag starts clean per test.
 */
async function loadClarityEvents() {
	return await import("./clarity-events");
}

function setPath(path: string) {
	window.history.replaceState(null, "", path);
}

beforeEach(() => {
	vi.resetModules();
	initMock.mockReset();
	eventMock.mockReset();
	upgradeMock.mockReset();
	setTagMock.mockReset();
	envState.projectId = undefined;
	sessionStorage.clear();
	setPath("/");
});

describe("trackClarityEvent", () => {
	it("does nothing when the project ID is unset", async () => {
		const { trackClarityEvent } = await loadClarityEvents();

		trackClarityEvent("view_pricing");

		expect(initMock).not.toHaveBeenCalled();
		expect(eventMock).not.toHaveBeenCalled();
		expect(upgradeMock).not.toHaveBeenCalled();
		expect(setTagMock).not.toHaveBeenCalled();
	});

	it("boots once and sends each named event", async () => {
		envState.projectId = "abc123test";
		const { trackClarityEvent } = await loadClarityEvents();

		trackClarityEvent("land_marketing");
		trackClarityEvent("view_pricing");

		expect(initMock).toHaveBeenCalledTimes(1);
		expect(initMock).toHaveBeenCalledWith("abc123test");
		expect(eventMock).toHaveBeenNthCalledWith(1, "land_marketing");
		expect(eventMock).toHaveBeenNthCalledWith(2, "view_pricing");
	});

	it.each([
		"/track/8f3c09b1a7e24d5c9b0e",
		"/claim/8f3c09b1a7e24d5c9b0e",
	])("never boots or sends on %s — the URL is the buyer's secret", async (path) => {
		envState.projectId = "abc123test";
		setPath(path);
		const { trackClarityEvent } = await loadClarityEvents();

		trackClarityEvent("view_pricing");

		expect(initMock).not.toHaveBeenCalled();
		expect(eventMock).not.toHaveBeenCalled();
	});

	it("upgrades the session on cta_signup_click and on no other event", async () => {
		envState.projectId = "abc123test";
		const { trackClarityEvent, SIGNUP_CTA_UPGRADE_REASON } =
			await loadClarityEvents();

		trackClarityEvent("land_marketing");
		trackClarityEvent("onboarding_start");
		expect(upgradeMock).not.toHaveBeenCalled();

		trackClarityEvent("cta_signup_click");
		expect(eventMock).toHaveBeenCalledWith("cta_signup_click");
		expect(upgradeMock).toHaveBeenCalledTimes(1);
		expect(upgradeMock).toHaveBeenCalledWith(SIGNUP_CTA_UPGRADE_REASON);
	});

	it("tags the session with the captured marketing src", async () => {
		envState.projectId = "abc123test";
		sessionStorage.setItem("kedaipal:marketing-src", "spotlight-thg");
		const { trackClarityEvent } = await loadClarityEvents();

		trackClarityEvent("store_created");

		expect(setTagMock).toHaveBeenCalledWith("src", "spotlight-thg");
		expect(eventMock).toHaveBeenCalledWith("store_created");
	});

	it("sets no src tag on an untagged session", async () => {
		envState.projectId = "abc123test";
		const { trackClarityEvent } = await loadClarityEvents();

		trackClarityEvent("store_created");

		expect(setTagMock).not.toHaveBeenCalled();
	});

	it("never throws when the Clarity library does — analytics must not break the page", async () => {
		envState.projectId = "abc123test";
		eventMock.mockImplementation(() => {
			throw new Error("window.clarity is not a function");
		});
		const { trackClarityEvent } = await loadClarityEvents();

		expect(() => trackClarityEvent("view_pricing")).not.toThrow();
	});
});

describe("ensureClarityInitialized", () => {
	it("reports false without a project ID and never injects", async () => {
		const { ensureClarityInitialized } = await loadClarityEvents();

		expect(ensureClarityInitialized("/")).toBe(false);
		expect(initMock).not.toHaveBeenCalled();
	});

	it("boots exactly once across repeated calls", async () => {
		envState.projectId = "abc123test";
		const { ensureClarityInitialized } = await loadClarityEvents();

		expect(ensureClarityInitialized("/")).toBe(true);
		expect(ensureClarityInitialized("/pricing")).toBe(true);
		expect(initMock).toHaveBeenCalledTimes(1);
	});

	it("refuses a capability-token path but still boots on a prefix-sharing route", async () => {
		envState.projectId = "abc123test";
		const { ensureClarityInitialized } = await loadClarityEvents();

		expect(ensureClarityInitialized("/track/abc")).toBe(false);
		expect(initMock).not.toHaveBeenCalled();
		expect(ensureClarityInitialized("/tracking-guide")).toBe(true);
		expect(initMock).toHaveBeenCalledTimes(1);
	});
});
