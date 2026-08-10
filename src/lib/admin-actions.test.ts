import { describe, expect, it } from "vitest";
import { canHardDeleteOrders } from "./admin-actions";

describe("canHardDeleteOrders", () => {
	it("shows the action to an admin acting-as another store", () => {
		expect(canHardDeleteOrders({ actingAsAdmin: true, amIAdmin: true })).toBe(
			true,
		);
	});

	it("shows the action on an admin's OWN store, with no act-as session", () => {
		// The 86eyhz189 case: viewing your own store resolves through the owner
		// branch, so actingAsAdmin is false even though the server would allow it.
		expect(canHardDeleteOrders({ actingAsAdmin: false, amIAdmin: true })).toBe(
			true,
		);
	});

	it("hides the action from a plain seller", () => {
		expect(canHardDeleteOrders({ actingAsAdmin: false, amIAdmin: false })).toBe(
			false,
		);
	});

	it("hides the action while the admin check is still loading", () => {
		// `amIAdmin` is undefined until the query resolves — a seller must never see
		// the erase flash in before it comes back.
		expect(canHardDeleteOrders({ actingAsAdmin: false })).toBe(false);
		expect(canHardDeleteOrders({})).toBe(false);
	});

	it("still shows during load when act-as already proves admin", () => {
		// The fast path: act-as is on the retailer payload, so another store's order
		// detail renders the action without waiting on a second round-trip.
		expect(canHardDeleteOrders({ actingAsAdmin: true })).toBe(true);
	});
});
