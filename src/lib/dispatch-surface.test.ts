// The shared "does this provider render anything on this order" predicate
// (86eyjpv6z). It exists because the hub and the cards MUST agree — a hub
// that offers a tab the card then declines to fill is a blank pane.
import { describe, expect, it } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
	delyvaSurface,
	lalamoveSurface,
	shipsAsParcel,
} from "./dispatch-surface";

const order = (over: Record<string, unknown> = {}) =>
	({
		deliveryMethod: "delivery",
		status: "confirmed",
		...over,
	}) as unknown as Doc<"orders">;

const lalamove = (over: Record<string, unknown> = {}) =>
	({
		job: null,
		blockReason: null,
		bookingEnabled: true,
		riderOnlyStore: false,
		promptBookOnPacked: false,
		deliveryDirection: "standard",
		...over,
	}) as never;

const delyva = (over: Record<string, unknown> = {}) =>
	({
		job: null,
		blockReason: null,
		bookingEnabled: true,
		defaultItemType: "PARCEL",
		computedWeightKg: 1,
		weightIssue: null,
		...over,
	}) as never;

describe("lalamoveSurface", () => {
	it("is a card on a bookable delivery order", () => {
		expect(lalamoveSurface(order(), lalamove())).toBe("card");
	});

	it("is nothing on a self-collect order", () => {
		expect(
			lalamoveSurface(order({ deliveryMethod: "self_collect" }), lalamove()),
		).toBe("none");
	});

	it("is nothing on a closed order with no history — the blank-pane bug", () => {
		expect(lalamoveSurface(order({ status: "delivered" }), lalamove())).toBe(
			"none",
		);
	});

	it("…but history keeps the card alive on that same closed order", () => {
		expect(
			lalamoveSurface(
				order({ status: "delivered" }),
				lalamove({ job: { status: "completed" } }),
			),
		).toBe("card");
	});

	it("is a hint — never a card — for a seller who never set it up", () => {
		expect(
			lalamoveSurface(order(), lalamove({ blockReason: "booking_disabled" })),
		).toBe("hint");
	});

	it("hides in an unsupported country, unless a rider is still out", () => {
		expect(
			lalamoveSurface(order(), lalamove({ blockReason: "country_unsupported" })),
		).toBe("none");
		expect(
			lalamoveSurface(
				order(),
				lalamove({
					blockReason: "country_unsupported",
					job: { status: "ongoing" },
				}),
			),
		).toBe("card");
	});

	it("is nothing while the query is still loading", () => {
		expect(lalamoveSurface(order(), undefined)).toBe("none");
	});
});

describe("delyvaSurface", () => {
	it("is a card on a bookable delivery order", () => {
		expect(delyvaSurface(order(), delyva())).toBe("card");
	});

	it("is a hint for a store that never connected Delyva", () => {
		expect(delyvaSurface(order(), delyva({ bookingEnabled: false }))).toBe(
			"hint",
		);
	});

	it("keeps the card for a disconnected store that still has a job", () => {
		expect(
			delyvaSurface(
				order(),
				delyva({ bookingEnabled: false, job: { status: "canceled" } }),
			),
		).toBe("card");
	});

	it("hides when there is nowhere to send the parcel", () => {
		expect(delyvaSurface(order(), delyva({ blockReason: "no_address" }))).toBe(
			"none",
		);
	});

	// Unlike Lalamove, a closed order still shows the courier card: it carries
	// the AWB and the delivered/cancelled history the seller comes back for.
	it("keeps a closed order's booking history on screen", () => {
		expect(
			delyvaSurface(
				order({ status: "delivered" }),
				delyva({ blockReason: "bad_status", job: { status: "canceled" } }),
			),
		).toBe("card");
	});
});

describe("a set-up nudge only appears where it can be acted on", () => {
	// PR #247 review: the Delyva hint fired on every order, including ones
	// nobody can book. Lalamove never did — the two now agree.
	it("no Delyva hint on a delivered order", () => {
		expect(
			delyvaSurface(
				order({ status: "delivered" }),
				delyva({ bookingEnabled: false }),
			),
		).toBe("none");
	});

	it("…and none from Lalamove either", () => {
		expect(
			lalamoveSurface(
				order({ status: "delivered" }),
				lalamove({ blockReason: "booking_disabled" }),
			),
		).toBe("none");
	});
});

describe("shipsAsParcel", () => {
	it("is true only for a delivery", () => {
		expect(shipsAsParcel("delivery")).toBe(true);
		expect(shipsAsParcel("self_collect")).toBe(false);
	});

	it("is FALSE for a booking — a stay has no parcel", () => {
		// The reported bug (8 Sep): every shipping surface asked
		// `!isSelfCollect`, so a campsite stay was offered a Shipment-tracking
		// card and an "add tracking" invitation for a parcel that cannot exist.
		expect(shipsAsParcel("booking")).toBe(false);
	});

	it("reads a legacy undefined as a delivery", () => {
		// Orders written before the field existed are parcels. Failing to the
		// parcel side is the safe direction: a real parcel must never lose the
		// place its consignment number goes.
		expect(shipsAsParcel(undefined)).toBe(true);
	});
});

describe("no dispatch card on a booking", () => {
	it("neither provider offers anything on a stay", () => {
		// Both already declined a booking via `deliveryMethod !== "delivery"`;
		// this pins that the shared predicate kept that behaviour, so the hub
		// can guard on it without changing what the cards decide.
		expect(lalamoveSurface(order({ deliveryMethod: "booking" }), lalamove())).toBe(
			"none",
		);
		expect(delyvaSurface(order({ deliveryMethod: "booking" }), delyva())).toBe(
			"none",
		);
	});
});
