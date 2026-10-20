// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Country } from "../../../convex/lib/country";
import { BILLING_CURRENCY_FOR_COUNTRY } from "../../../convex/lib/plans";
import { couriersFor, hasParcelCouriers, mockQuotes } from "../../lib/couriers";
import { m } from "../../paraglide/messages";
import { CourierCatalogue, DispatchCard, SHIPPED_BEAT } from "./delivery";

/**
 * The dispatch card and the courier catalogue are phase 03 of the seller-flow
 * walkthrough (`seller-flow.tsx` owns the clock and the region). These tests
 * pin the pieces with the beat and region passed in: MY lists the Malaysian
 * catalogue with the cold badges; SG lists only what is live; the card opens
 * on the asking beat (a state, not a gap), quotes in the region's currency,
 * reads the provider off the quoted row, and ships the courier it booked.
 */

afterEach(cleanup);

/** A chip is either a name (text) or a brand mark (img alt) — one accessor. */
function chipNames(grid: HTMLElement): string[] {
	return Array.from(grid.querySelectorAll("li")).map((li) => {
		const img = li.querySelector("img");
		return img?.getAttribute("alt") || li.textContent || "";
	});
}

function renderCard(country: Country, beat: number, reduced = false) {
	return render(
		<DispatchCard
			beat={beat}
			reduced={reduced}
			currency={BILLING_CURRENCY_FOR_COUNTRY[country]}
			quotes={mockQuotes(country)}
			parcelsLive={hasParcelCouriers(country)}
		/>,
	);
}

describe("CourierCatalogue", () => {
	it("lists every visible Malaysian courier once, cold lanes badged", () => {
		render(<CourierCatalogue couriers={couriersFor("MY")} />);
		const grid = screen.getByRole("list", {
			name: m.delivery_catalogue_label(),
		});
		const names = couriersFor("MY").map((c) => c.name);
		const rendered = chipNames(grid);
		for (const name of names) expect(rendered.join("|")).toContain(name);
		expect(rendered.length).toBe(names.length);
		const coldCount = couriersFor("MY").filter(
			(c) => c.group === "cold",
		).length;
		expect(grid.textContent?.split(m.delivery_cold()).length - 1).toBe(
			coldCount,
		);
	});

	it("lists Singapore only what is live", () => {
		render(<CourierCatalogue couriers={couriersFor("SG")} />);
		const grid = screen.getByRole("list", {
			name: m.delivery_catalogue_label(),
		});
		const rendered = chipNames(grid);
		expect(rendered.length).toBe(couriersFor("SG").length);
		expect(rendered.join("|")).toContain("Lalamove");
		expect(rendered.join("|")).not.toContain("Ninja Cold");
	});
});

describe("DispatchCard", () => {
	it("opens on the asking beat — skeleton rows, a disabled button, no courier named yet", () => {
		renderCard("MY", 0);
		const button = screen.getByTestId("dispatch-button");
		expect(button.textContent).toContain(m.delivery_quote_getting());
		for (const q of mockQuotes("MY")) {
			expect(button.textContent).not.toContain(q.name);
		}
		expect(screen.getByText(m.delivery_quote_asking())).toBeTruthy();
		expect(screen.queryByText(m.delivery_quote_choose())).toBeNull();
		const skeleton = screen.getByTestId("dispatch-skeleton");
		expect(skeleton.className).toContain("opacity-100");
		expect(skeleton.children).toHaveLength(mockQuotes("MY").length);
	});

	it("asks one rider for Singapore and holds one row", () => {
		renderCard("SG", 0);
		expect(screen.getByText(m.delivery_quote_asking_rider())).toBeTruthy();
		expect(screen.getByTestId("dispatch-skeleton").children).toHaveLength(
			mockQuotes("SG").length,
		);
	});

	it("reads the provider off the quoted row: Delyva for MY, Lalamove for SG", () => {
		renderCard("MY", 0);
		expect(screen.getByTestId("dispatch-provider").dataset.provider).toBe(
			"delyva",
		);
		expect(screen.getByText(m.delivery_quote_note())).toBeTruthy();
		cleanup();
		renderCard("SG", 0);
		expect(screen.getByTestId("dispatch-provider").dataset.provider).toBe(
			"lalamove",
		);
		expect(screen.getByText(m.delivery_quote_note_rider())).toBeTruthy();
		expect(screen.queryByText(m.delivery_quote_note())).toBeNull();
	});

	it("offers the chilled and frozen lanes only where a parcel network is live", () => {
		renderCard("MY", 1);
		expect(screen.getByText(m.delivery_quote_chilled())).toBeTruthy();
		expect(screen.getByText(m.delivery_quote_frozen())).toBeTruthy();
		cleanup();
		renderCard("SG", 1);
		expect(screen.queryByText(m.delivery_quote_chilled())).toBeNull();
		expect(screen.queryByText(m.delivery_quote_frozen())).toBeNull();
		expect(screen.getByText(m.delivery_quote_parcel())).toBeTruthy();
	});

	it("quotes in the region's currency", () => {
		// `formatPrice` joins symbol and amount with a non-breaking space.
		const my = renderCard("MY", 1);
		expect(my.container.textContent).toMatch(/RM \d/);
		cleanup();
		const sg = renderCard("SG", 1);
		expect(sg.container.textContent).toMatch(/S\$ \d/);
		expect(sg.container.textContent).not.toMatch(/RM \d/);
	});

	it("walks the button Getting quotes → Book → Booked → Shipped", () => {
		const my = mockQuotes("MY")[0];
		const button = (beat: number) => {
			cleanup();
			renderCard("MY", beat);
			return screen.getByTestId("dispatch-button").textContent ?? "";
		};
		expect(button(0)).toContain(m.delivery_quote_getting());
		expect(button(1)).toContain(`Book ${my.name}`);
		expect(screen.getByTestId("dispatch-skeleton").className).toContain(
			"opacity-0",
		);
		expect(button(3)).toContain(m.delivery_quote_booked({ courier: my.name }));
		expect(button(SHIPPED_BEAT)).toContain(
			m.delivery_quote_shipped({ courier: my.name }),
		);
	});

	it("ships the courier it booked, in both regions — never the hero's J&T", () => {
		const my = renderCard("MY", SHIPPED_BEAT);
		expect(my.container.textContent).toContain(
			m.delivery_quote_shipped({ courier: mockQuotes("MY")[0].name }),
		);
		cleanup();
		const sg = renderCard("SG", SHIPPED_BEAT);
		expect(mockQuotes("SG")[0].name).toBe("Lalamove");
		expect(sg.container.textContent).toContain(
			m.delivery_quote_shipped({ courier: "Lalamove" }),
		);
		expect(sg.container.textContent).not.toContain(m.hero_after_status_4());
	});

	it("shows the shipped frame as a still under reduced motion", () => {
		const { container } = renderCard("MY", 0, true);
		expect(container.textContent).toContain(
			m.delivery_quote_shipped({ courier: mockQuotes("MY")[0].name }),
		);
	});
});
