// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RouteErrorCard } from "./route-error";

const invalidate = vi.fn(() => Promise.resolve());

// The card only needs router.invalidate; stub the router context so the
// component renders in isolation.
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));

afterEach(() => {
	cleanup();
	invalidate.mockClear();
});

describe("RouteErrorCard", () => {
	test("renders calm copy with a retry CTA — never a bare stack trace", () => {
		render(<RouteErrorCard error={new Error("boom")} reset={() => {}} />);
		expect(screen.getByText("Something went wrong")).toBeTruthy();
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});

	test("try again clears the boundary, then re-runs loaders", () => {
		const reset = vi.fn();
		render(<RouteErrorCard error={new Error("boom")} reset={reset} />);
		fireEvent.click(screen.getByRole("button", { name: /try again/i }));
		expect(reset).toHaveBeenCalledOnce();
		expect(invalidate).toHaveBeenCalledOnce();
		// Boundary must clear BEFORE loaders re-run, or the re-render lands on
		// the stale error state.
		expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
			invalidate.mock.invocationCallOrder[0],
		);
	});
});
