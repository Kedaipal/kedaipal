// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { couriersFor } from "../../lib/couriers";
import { m } from "../../paraglide/messages";
import { Delivery } from "./delivery";

/**
 * The region-dependent behaviour the ticket's edge cases name: MY renders the
 * Malaysian catalogue with the cold badges; SG renders only what is live plus
 * the "being enabled" note and drops nothing it can't book; the rider bullet
 * follows the catalogue.
 */

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
			select({ matches: [{ loaderData: { region: "MY" } }] }),
	};
});

/** A chip is either a name (text) or a brand mark (img alt) — one accessor. */
function chipNames(grid: HTMLElement): string[] {
	return Array.from(grid.querySelectorAll("li")).map((li) => {
		const img = li.querySelector("img");
		return img?.getAttribute("alt") || li.textContent || "";
	});
}

function installMatchMedia() {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

describe("Delivery", () => {
	beforeEach(() => {
		installMatchMedia();
		vi.stubGlobal("IntersectionObserver", NeverInViewObserver);
		// Pin Intl so the time-zone fallback can't flip the region under the test.
		vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
			timeZone: "UTC",
		} as Intl.ResolvedDateTimeFormatOptions);
		// biome-ignore lint/suspicious/noDocumentCookie: jsdom keeps cookies across tests in a file; the region pick from one test must not leak into the next.
		document.cookie = "kp_landing_region=; Max-Age=0; Path=/";
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("lists every visible Malaysian courier once in the grid, cold lanes badged", () => {
		render(<Delivery />);
		const grid = screen.getByRole("list", { name: m.delivery_label() });
		const names = couriersFor("MY").map((c) => c.name);
		const rendered = chipNames(grid);
		for (const name of names) expect(rendered.join("|")).toContain(name);
		const coldCount = couriersFor("MY").filter((c) => c.group === "cold").length;
		expect(rendered.length).toBe(names.length);
		expect(grid.textContent?.split(m.delivery_cold()).length - 1).toBe(coldCount);
		expect(screen.getByText(m.delivery_cold_note())).toBeTruthy();
		expect(screen.getByText(m.delivery_point_3())).toBeTruthy();
	});

	it("shows Singapore only what is live, with the being-enabled note", () => {
		render(<Delivery />);
		fireEvent.click(screen.getByRole("button", { name: m.region_sg() }));
		const grid = screen.getByRole("list", { name: m.delivery_label() });
		const rendered = chipNames(grid);
		expect(rendered.length).toBe(couriersFor("SG").length);
		expect(rendered.join("|")).toContain("Lalamove");
		expect(rendered.join("|")).not.toContain("Ninja Cold");
		expect(screen.getByText(m.delivery_sg_note())).toBeTruthy();
		// The rider bullet stays because Lalamove SG is live.
		expect(screen.getByText(m.delivery_point_3())).toBeTruthy();
	});

	it("quotes the mock card in the region's currency", () => {
		const { container } = render(<Delivery />);
		expect(container.textContent).toMatch(/RM \d/);
		fireEvent.click(screen.getByRole("button", { name: m.region_sg() }));
		expect(container.textContent).toMatch(/S\$ \d/);
		expect(container.textContent).not.toMatch(/RM \d/);
	});
});
