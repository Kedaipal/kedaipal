// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them safely.
const { initMock, envState } = vi.hoisted(() => ({
	initMock: vi.fn(),
	envState: { projectId: undefined as string | undefined },
}));

vi.mock("@microsoft/clarity", () => ({ default: { init: initMock } }));

vi.mock("../lib/env", () => ({
	clientEnv: {
		get VITE_CLARITY_PROJECT_ID() {
			return envState.projectId;
		},
	},
}));

// Reset the hook's module-level "initialized" flag between tests by reloading
// the module fresh each time.
async function mountClarity() {
	const { useClarity } = await import("./useClarity");
	function Harness() {
		useClarity();
		return null;
	}
	return render(<Harness />);
}

beforeEach(() => {
	vi.resetModules();
	initMock.mockClear();
	envState.projectId = undefined;
});

afterEach(cleanup);

describe("useClarity", () => {
	it("does not initialize when the project ID is unset", async () => {
		envState.projectId = undefined;

		await mountClarity();

		expect(initMock).not.toHaveBeenCalled();
	});

	it("initializes Clarity with the configured project ID", async () => {
		envState.projectId = "abc123";

		await mountClarity();

		expect(initMock).toHaveBeenCalledTimes(1);
		expect(initMock).toHaveBeenCalledWith("abc123");
	});

	it("initializes only once across re-renders", async () => {
		envState.projectId = "abc123";
		const { useClarity } = await import("./useClarity");
		function Harness() {
			useClarity();
			return null;
		}

		const { rerender } = render(<Harness />);
		expect(initMock).toHaveBeenCalledTimes(1);

		rerender(<Harness />);
		expect(initMock).toHaveBeenCalledTimes(1);
	});
});
