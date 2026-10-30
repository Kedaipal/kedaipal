// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryAtAGlance } from "./delivery-at-a-glance";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		hash: _hash,
		...props
	}: Record<string, unknown> & {
		to?: string;
		search?: Record<string, string>;
	}) => (
		<a
			href={`${to}${search ? `?${new URLSearchParams(search).toString()}` : ""}`}
			{...props}
		/>
	),
}));

afterEach(() => cleanup());

const money = (minor: number) => `S$ ${(minor / 100).toFixed(2)}`;
const NO_COURIERS = {
	lalamove: false,
	delyva: false,
	easyparcelAtHome: false,
	easyparcelReady: false,
};

type Props = Parameters<typeof DeliveryAtAGlance>[0];
function renderCard(over: Partial<Props> = {}) {
	return render(
		<DeliveryAtAGlance
			country="SG"
			offerDelivery
			homePricing="Live courier price"
			couriers={NO_COURIERS}
			destination="MY"
			lane={undefined}
			lanePause={null}
			easyparcelBlock={null}
			offerSelfCollect
			activePickupPoints={1}
			money={money}
			{...over}
		/>,
	);
}

// The one place that says which price and which courier apply to which
// orders (Zaki, 30 Oct) — in the store's own countries.
describe("Delivery at a glance", () => {
	it("speaks in the store's countries: an SG store reads Within Singapore / To Malaysia", () => {
		renderCard({
			couriers: { ...NO_COURIERS, lalamove: true, easyparcelAtHome: true },
		});
		expect(screen.getByText("Within Singapore")).toBeTruthy();
		expect(screen.getByText("To Malaysia")).toBeTruthy();
		expect(screen.getByText("Lalamove riders")).toBeTruthy();
		expect(screen.getByText("EasyParcel couriers")).toBeTruthy();
		expect(screen.queryByText(/Delyva/)).toBeNull();
	});

	it("no overseas price yet: says buyers there can't order, with both ways to price it", () => {
		renderCard();
		expect(screen.getByText(/Buyers in Malaysia can't order yet/)).toBeTruthy();
		expect(screen.getByText("Set your own price").getAttribute("href")).toBe(
			"/app/settings/overseas-delivery?start=own",
		);
		expect(
			screen.getByText("Use EasyParcel live price").getAttribute("href"),
		).toBe("/app/settings/overseas-delivery?start=live");
	});

	it("a live lane shows its price and carrier; a held one says why", () => {
		renderCard({
			lane: { country: "MY", pricing: { kind: "live" } },
			couriers: { ...NO_COURIERS, easyparcelReady: true },
			productsAbroad: { going: 1, total: 2 },
		});
		expect(screen.getByText("Priced live by EasyParcel")).toBeTruthy();
		expect(screen.getByText("EasyParcel")).toBeTruthy();
		expect(screen.getByText("1 of 2 products go")).toBeTruthy();
		cleanup();
		renderCard({
			lane: { country: "MY", pricing: { kind: "live" } },
			lanePause: "awaiting_products",
		});
		expect(
			screen.getByText(/Almost on — choose which products can go to Malaysia/),
		).toBeTruthy();
	});

	it("pickup on with no point says buyers can't use it", () => {
		renderCard({ activePickupPoints: 0 });
		expect(
			screen.getByText(/no pickup point yet — buyers can't choose it/),
		).toBeTruthy();
		expect(screen.queryByText("0 pickup points")).toBeNull();
	});

	it("delivery or pickup off reads off, not a price", () => {
		renderCard({ offerDelivery: false, offerSelfCollect: false });
		expect(screen.getByText(/Delivery is off/)).toBeTruthy();
		expect(screen.getByText("Pickup is off.")).toBeTruthy();
	});
});
