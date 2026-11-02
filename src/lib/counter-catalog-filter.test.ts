import { describe, expect, test } from "vitest";
import {
	counterFilterCounts,
	counterFilterEmptyMessage,
	counterFilterIsUseful,
	effectiveCounterFilter,
	matchesCounterFilter,
} from "./counter-catalog-filter";

const physical = { kind: "physical" };
const legacy = {}; // no kind — predates the field, so physical
const service = { kind: "service" };
const serviceEvent = { kind: "service", event: { date: 0 } };
const hiddenService = { kind: "service", hidden: true };

describe("counter catalog filter (z8r3fdkugx)", () => {
	test("Products / Services / Events partition the catalog — an event is an Event whatever its kind", () => {
		expect(matchesCounterFilter(physical, "products")).toBe(true);
		expect(matchesCounterFilter(legacy, "products")).toBe(true);
		expect(matchesCounterFilter(service, "services")).toBe(true);
		expect(matchesCounterFilter(serviceEvent, "events")).toBe(true);
		expect(matchesCounterFilter(serviceEvent, "services")).toBe(false);
		expect(matchesCounterFilter(serviceEvent, "products")).toBe(false);
	});

	test("Hidden is its own axis — a hidden service is in both chips", () => {
		expect(matchesCounterFilter(hiddenService, "hidden")).toBe(true);
		expect(matchesCounterFilter(hiddenService, "services")).toBe(true);
		expect(matchesCounterFilter(service, "hidden")).toBe(false);
	});

	test("counts add up: the kind chips sum to All", () => {
		const counts = counterFilterCounts([
			physical,
			legacy,
			service,
			serviceEvent,
			hiddenService,
		]);
		expect(counts).toEqual({
			all: 5,
			products: 2,
			services: 2,
			events: 1,
			hidden: 1,
		});
		expect(counts.products + counts.services + counts.events).toBe(counts.all);
	});

	test("the row shows only when a chip narrows something", () => {
		// All physical: every live chip equals All — no row.
		expect(counterFilterIsUseful(counterFilterCounts([physical, legacy]))).toBe(
			false,
		);
		// Mixed kinds: a row.
		expect(
			counterFilterIsUseful(counterFilterCounts([physical, service])),
		).toBe(true);
		// One kind, but some hidden: Hidden narrows — a row.
		expect(
			counterFilterIsUseful(
				counterFilterCounts([physical, { ...physical, hidden: true }]),
			),
		).toBe(true);
		expect(counterFilterIsUseful(counterFilterCounts([]))).toBe(false);
	});

	test("a picked chip that empties falls back to All, never an empty list behind a disabled chip", () => {
		const counts = counterFilterCounts([physical, service]);
		expect(effectiveCounterFilter("services", counts)).toBe("services");
		expect(effectiveCounterFilter("hidden", counts)).toBe("all");
		expect(effectiveCounterFilter("all", counts)).toBe("all");
	});

	test("the empty line names the chip and the search", () => {
		expect(counterFilterEmptyMessage("services", " wash ")).toBe(
			"No services match “wash”.",
		);
		expect(counterFilterEmptyMessage("hidden", "tote")).toBe(
			"No hidden products match “tote”.",
		);
		expect(counterFilterEmptyMessage("all", "tote")).toBe(
			"No products match “tote”.",
		);
	});
});
