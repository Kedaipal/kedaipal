// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarketplaceRegion } from "./useMarketplaceRegion";

/**
 * The stateful half of `/stores`' market (z8r3fdwduz), through a stubbed
 * router. The root loader carries BOTH answers — `region` (pricing, honours
 * the toggle's cookie) and `market` (geo only) — so the stub sets them apart
 * to prove the marketplace reads the right one.
 */
let loaderData: { region?: unknown; market?: unknown } = {};

vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
		select({ matches: [{ loaderData }] }),
}));

function Probe() {
	return <span data-testid="market">{useMarketplaceRegion()}</span>;
}

const shown = () => screen.getByTestId("market").textContent;

beforeEach(() => {
	loaderData = {};
	// biome-ignore lint/suspicious/noDocumentCookie: test fixture — the state a pricing-page visit leaves behind; the Cookie Store API isn't in jsdom.
	document.cookie = "kp_landing_region=; Max-Age=0; Path=/";
	vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
		resolvedOptions: () => ({ timeZone: "UTC" }),
	} as never);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("useMarketplaceRegion", () => {
	it("takes the edge's geo answer", () => {
		loaderData = { market: "SG" };
		render(<Probe />);
		expect(shown()).toBe("SG");
	});

	it("never reads the pricing pick — neither its cookie nor the root's `region`", () => {
		// A Malaysian who checked SG prices on /pricing: cookie says SG, the
		// pricing answer says SG, the IP says MY. The directory follows the IP.
		// biome-ignore lint/suspicious/noDocumentCookie: as above.
		document.cookie = "kp_landing_region=SG; Path=/";
		loaderData = { region: "SG", market: "MY" };
		render(<Probe />);
		expect(shown()).toBe("MY");
	});

	it("does not downgrade when a client-side loader re-run answers null", () => {
		loaderData = { market: "SG" };
		const { rerender } = render(<Probe />);
		loaderData = { market: null };
		rerender(<Probe />);
		expect(shown()).toBe("SG");
	});

	it("ignores a loader payload that isn't a country", () => {
		loaderData = { market: "ID" };
		render(<Probe />);
		expect(shown()).toBe("MY");
	});
});
