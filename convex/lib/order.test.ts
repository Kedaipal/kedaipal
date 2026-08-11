import { describe, expect, test } from "vitest";
import { isMockupGateClosed, isMockupPriceUnsettled } from "./order";

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
