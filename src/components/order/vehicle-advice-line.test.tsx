// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useAction: () => vi.fn(),
	useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
	useNavigate: () => vi.fn(),
}));

import { riderLoadsLine } from "../settings/delivery-pricing";
import { VehicleAdviceLine } from "./book-delivery-card";

afterEach(cleanup);

/** The dispatch card's vehicle reason and the pricing card's rule
 * (25 Oct 2026) — the seller is told why a car was picked, and the rule
 * exists before anything goes wrong. */
describe("VehicleAdviceLine", () => {
	it("is silent when the store's vehicle carries the order", () => {
		const { container } = render(
			<VehicleAdviceLine advice={undefined} quotedVehicle="MOTORCYCLE" />,
		);
		expect(container.textContent).toBe("");
	});

	it("says why a car was picked, muted", () => {
		const { container } = render(
			<VehicleAdviceLine
				advice={{
					kind: "escalated",
					from: "MOTORCYCLE",
					to: "CAR",
					cartKg: 25,
					fromLoadKg: 10,
				}}
				quotedVehicle="CAR"
			/>,
		);
		expect(container.textContent).toBe(
			"Car picked — this order weighs 25 kg, over a motorcycle's 10 kg.",
		);
		expect(container.innerHTML).not.toContain("amber");
	});

	it("warns, amber, when the seller switches back to the motorcycle", () => {
		const { container } = render(
			<VehicleAdviceLine
				advice={{
					kind: "escalated",
					from: "MOTORCYCLE",
					to: "CAR",
					cartKg: 25,
					fromLoadKg: 10,
				}}
				quotedVehicle="MOTORCYCLE"
			/>,
		);
		expect(container.textContent).toContain(
			"over a motorcycle's 10 kg. The rider may refuse it at pickup.",
		);
		expect(container.innerHTML).toContain("amber");
	});

	it("says nothing here fits, and the two ways out", () => {
		const { container } = render(
			<VehicleAdviceLine
				advice={{ kind: "too_heavy", cartKg: 60, maxKg: 40 }}
				quotedVehicle="CAR"
			/>,
		);
		expect(container.textContent).toContain(
			"weighs 60 kg — over a car's 40 kg",
		);
		expect(container.textContent).toContain("Book a van in the Lalamove app");
	});
});

describe("riderLoadsLine", () => {
	const loads = [
		{ key: "CAR", loadKg: 40 },
		{ key: "MOTORCYCLE", loadKg: 10 },
	];

	it("names Lalamove's own limits for a motorcycle store", () => {
		expect(
			riderLoadsLine({ loads, vehicle: "MOTORCYCLE", delyvaArmed: true }),
		).toBe(
			"A cart over a motorcycle's 10 kg is quoted on a car instead; over a car's 40 kg, riders don't bid and your Delyva couriers price it",
		);
	});

	it("a car store only hears the car's limit", () => {
		expect(riderLoadsLine({ loads, vehicle: "CAR", delyvaArmed: false })).toBe(
			"A car carries up to 40 kg — over that, riders don't bid and the buyer is asked to pick up or message you",
		);
	});

	it("before the market has been quoted, the rule without numbers", () => {
		expect(
			riderLoadsLine({
				loads: null,
				vehicle: "MOTORCYCLE",
				delyvaArmed: false,
			}),
		).toMatch(/^A cart too heavy for a motorcycle is quoted on a car instead/);
	});
});
