import { describe, expect, test } from "vitest";
import { todayMytMidnight } from "./fulfilmentDate";
import {
	isCollectionGateClosed,
	isDefaultedCounterDate,
	isFreeOrder,
	isMockupGateClosed,
	isMockupPriceUnsettled,
} from "./order";

/**
 * The two mockup predicates answer DIFFERENT questions, and the whole
 * one-message-per-order design (86eyd63r8) turns on the difference:
 *
 *   isMockupGateClosed     — "has the buyer signed off?"  → blocks production
 *   isMockupPriceUnsettled — "is there a quote at all?"   → blocks the message
 *
 * They agree at `pending` and diverge from `submitted` onward. Confusing them
 * is the failure mode: gate the message on approval and a made-to-order buyer
 * is never told there's a design waiting, so nothing ever gets approved.
 */
describe("mockup predicates", () => {
	test("a non-custom order is neither gated nor unpriced", () => {
		expect(isMockupGateClosed({})).toBe(false);
		expect(isMockupPriceUnsettled({})).toBe(false);
	});

	test("pending — both true: no quote yet, and no sign-off", () => {
		expect(isMockupGateClosed({ mockupStatus: "pending" })).toBe(true);
		expect(isMockupPriceUnsettled({ mockupStatus: "pending" })).toBe(true);
	});

	test("submitted — THEY DIVERGE: priced, but not yet approved", () => {
		expect(isMockupGateClosed({ mockupStatus: "submitted" })).toBe(true);
		expect(isMockupPriceUnsettled({ mockupStatus: "submitted" })).toBe(false);
	});

	test("changes_requested — still priced (it can only follow a submit)", () => {
		expect(isMockupGateClosed({ mockupStatus: "changes_requested" })).toBe(true);
		expect(isMockupPriceUnsettled({ mockupStatus: "changes_requested" })).toBe(
			false,
		);
	});

	test("approved — both open", () => {
		expect(isMockupGateClosed({ mockupStatus: "approved" })).toBe(false);
		expect(isMockupPriceUnsettled({ mockupStatus: "approved" })).toBe(false);
	});

	test("a waiver settles the price and opens the gate from any state", () => {
		const waived = { mockupStatus: "pending", mockupWaivedAt: 1 } as const;
		expect(isMockupGateClosed(waived)).toBe(false);
		expect(isMockupPriceUnsettled(waived)).toBe(false);
	});
});

describe("isCollectionGateClosed (86eyg0n8e)", () => {
	// The whole safety of this gate rests on it being FALSE for anything that
	// isn't a collection order — a truth table is the cheapest way to keep it
	// that way.
	const directions = [undefined, "standard", "collection"] as const;
	const stamps = [undefined, 1_785_000_000_000] as const;

	for (const deliveryDirection of directions) {
		for (const collectedAt of stamps) {
			const expected =
				deliveryDirection === "collection" && collectedAt === undefined;
			test(`direction=${deliveryDirection ?? "unset"} collectedAt=${
				collectedAt ? "set" : "unset"
			} → ${expected ? "closed" : "open"}`, () => {
				expect(isCollectionGateClosed({ deliveryDirection, collectedAt })).toBe(
					expected,
				);
			});
		}
	}

	test("is independent of the mockup gate — the two block for different reasons", () => {
		const order = {
			deliveryDirection: "collection" as const,
			collectedAt: undefined,
			mockupStatus: "approved" as const,
			mockupWaivedAt: undefined,
		};
		expect(isMockupGateClosed(order)).toBe(false);
		expect(isCollectionGateClosed(order)).toBe(true);
	});
});

describe("isFreeOrder (`z8r3fdff9u`)", () => {
	test("a genuinely free order is free", () => {
		expect(isFreeOrder({ total: 0 })).toBe(true);
	});

	test("anything owed is not free", () => {
		expect(isFreeOrder({ total: 1 })).toBe(false);
	});

	test("an UNQUOTED made-to-order order is NOT free — it's unpriced", () => {
		// The trap this predicate exists for: a custom line sits at total 0 until
		// the seller quotes it on the mockup. Telling that buyer "no payment
		// needed" is how a seller ends up doing RM400 of catering for nothing.
		expect(isFreeOrder({ total: 0, mockupStatus: "pending" })).toBe(false);
	});

	test("a quoted or waived mockup at zero IS free", () => {
		// `submitted` already carries a real total (submitMockup folds the quote
		// in), so a zero there is a real zero.
		expect(isFreeOrder({ total: 0, mockupStatus: "submitted" })).toBe(true);
		expect(
			isFreeOrder({ total: 0, mockupStatus: "pending", mockupWaivedAt: 1 }),
		).toBe(true);
	});

	test("an order awaiting a delivery charge is NOT free", () => {
		expect(isFreeOrder({ total: 0, deliveryFeePending: true })).toBe(false);
	});
});

describe("isDefaultedCounterDate (`z8r3fdff9u` follow-up)", () => {
	const createdAt = 1_770_000_000_000;
	const sameDay = todayMytMidnight(createdAt);
	const DAY = 86_400_000;

	test("a counter date equal to the creation day is the default — noise", () => {
		expect(
			isDefaultedCounterDate({
				source: "counter",
				fulfilmentDate: sameDay,
				createdAt,
			}),
		).toBe(true);
	});

	test("no date at all on a counter order is also the default", () => {
		expect(isDefaultedCounterDate({ source: "counter", createdAt })).toBe(
			true,
		);
	});

	test("a LATER counter date was chosen on purpose (or by an event) — show it", () => {
		expect(
			isDefaultedCounterDate({
				source: "counter",
				fulfilmentDate: sameDay + 3 * DAY,
				createdAt,
			}),
		).toBe(false);
	});

	test("never fires for non-counter orders — their date is buyer-chosen", () => {
		expect(
			isDefaultedCounterDate({
				source: "storefront",
				fulfilmentDate: sameDay,
				createdAt,
			}),
		).toBe(false);
		expect(isDefaultedCounterDate({ fulfilmentDate: sameDay, createdAt })).toBe(
			false,
		);
	});
});
