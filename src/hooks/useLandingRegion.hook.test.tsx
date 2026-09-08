// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLandingRegion } from "./useLandingRegion";

/**
 * The hook's own behaviour, driven through a stubbed router so the root
 * loader's answer can be taken away mid-life — which is what
 * `router.invalidate()` does. The pure resolver and cookie parser are covered
 * in `useLandingRegion.test.ts`; this file exists for the stateful part.
 */
let loaderRegion: unknown = null;

vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
		select({ matches: [{ loaderData: { region: loaderRegion } }] }),
}));

function Probe() {
	const [region] = useLandingRegion();
	return <span data-testid="region">{region}</span>;
}

const shown = () => screen.getByTestId("region").textContent;

beforeEach(() => {
	loaderRegion = null;
	// biome-ignore lint/suspicious/noDocumentCookie: setting up the exact state the hook reads; the Cookie Store API isn't in jsdom.
	document.cookie = "kp_landing_region=; Max-Age=0; Path=/";
	// Pin the time-zone fallback to a NON-Singapore zone so "fell back to the
	// time zone" is distinguishable from "kept the server's SG answer".
	vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
		resolvedOptions: () => ({ timeZone: "UTC" }),
	} as never);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("useLandingRegion", () => {
	it("takes the server's answer when there is one", () => {
		loaderRegion = "SG";
		render(<Probe />);
		expect(shown()).toBe("SG");
	});

	it("falls back to the time zone when the server said nothing", () => {
		render(<Probe />);
		expect(shown()).toBe("MY");
	});

	it("ignores a loader payload that isn't a country", () => {
		loaderRegion = "ID";
		render(<Probe />);
		expect(shown()).toBe("MY");
	});

	/**
	 * `router.invalidate()` — the retry button in `route-error.tsx` — re-runs
	 * the root loader on the CLIENT, where `readVisitorRegion` has no request
	 * and answers null. Re-resolving from that would drop a header-detected SG
	 * visitor with no cookie back to the time-zone guess, flipping the page to
	 * RM on an error retry.
	 */
	it("does not downgrade when a client-side loader re-run answers null", () => {
		loaderRegion = "SG";
		const { rerender } = render(<Probe />);
		expect(shown()).toBe("SG");

		loaderRegion = null;
		rerender(<Probe />);
		expect(shown()).toBe("SG");
	});

	it("still lets the visitor's own cookie win over the server", () => {
		// biome-ignore lint/suspicious/noDocumentCookie: as above — test fixture, not app code.
		document.cookie = "kp_landing_region=MY; Path=/";
		loaderRegion = "SG";
		render(<Probe />);
		expect(shown()).toBe("MY");
	});
});
