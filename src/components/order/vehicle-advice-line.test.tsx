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

import {
	riderLoadsLine,
	vehiclePickerHint,
} from "../settings/delivery-pricing";
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
			"A cart over a motorcycle's 10 kg is quoted on a car instead; over a car's 40 kg, riders don't bid: a Delyva courier prices it if one carries that weight, otherwise the buyer is asked to pick up or message you",
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

describe("vehiclePickerHint — the rule where the vehicle is chosen", () => {
	const loads = [
		{ key: "CAR", loadKg: 40 },
		{ key: "MOTORCYCLE", loadKg: 10 },
	];

	it("a motorcycle store hears that heavy carts move up to a car", () => {
		expect(vehiclePickerHint({ loads, vehicle: "MOTORCYCLE" })).toBe(
			"Just the default — switch per order when you book. A cart over a motorcycle's 10 kg is priced on a car at checkout, and booking opens on one.",
		);
	});

	it("before the market has been quoted, the rule without the number", () => {
		expect(vehiclePickerHint({ loads: null, vehicle: "MOTORCYCLE" })).toBe(
			"Just the default — switch per order when you book. A cart too heavy for a motorcycle is priced on a car at checkout, and booking opens on one.",
		);
	});

	it("a car store is never moved, so it hears only the default", () => {
		expect(vehiclePickerHint({ loads, vehicle: "CAR" })).toBe(
			"Just the default — switch per order when you book.",
		);
	});
});

describe("VehicleAdviceLine — too heavy, with a courier tab", () => {
	it("names the courier the buyer paid for", () => {
		const { container } = render(
			<VehicleAdviceLine
				advice={{ kind: "too_heavy", cartKg: 40.6, maxKg: 40 }}
				quotedVehicle="CAR"
				courierOffered
				buyerPaidCourier="DHL eCommerce"
			/>,
		);
		expect(container.textContent).toBe(
			"This order weighs 40.6 kg — over a car's 40 kg, so no rider vehicle here can carry it. Your buyer paid a DHL eCommerce price at checkout — book the courier instead.",
		);
	});
});
