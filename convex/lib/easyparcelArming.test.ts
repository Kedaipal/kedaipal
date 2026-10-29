import { describe, expect, it } from "vitest";
import { easyparcelQuoteBlock } from "./easyparcelArming";

// Can EasyParcel price a checkout right now (z8r3fdr5yy)? A live overseas
// lane is offered only while this says yes — so a buyer never meets a
// delivery option that can't be priced.
const READY = {
	conn: {
		enabled: true,
		pickupAddress: { postcode: "50470" },
		balanceCurrency: "MYR",
	},
	configured: true,
	senderPhone: "60123456789",
	storeCurrency: "MYR",
};

describe("easyparcelQuoteBlock", () => {
	it("ready: connected, on, a pickup address, a store number, the store's currency", () => {
		expect(easyparcelQuoteBlock(READY)).toBeNull();
	});

	it("names the first thing missing, in fix order", () => {
		expect(easyparcelQuoteBlock({ ...READY, conn: null })).toBe("not_connected");
		expect(easyparcelQuoteBlock({ ...READY, configured: false })).toBe(
			"not_connected",
		);
		expect(
			easyparcelQuoteBlock({ ...READY, conn: { ...READY.conn, revokedAt: 1 } }),
		).toBe("reconnect_needed");
		expect(
			easyparcelQuoteBlock({ ...READY, conn: { ...READY.conn, enabled: false } }),
		).toBe("disabled");
		expect(
			easyparcelQuoteBlock({
				...READY,
				conn: { ...READY.conn, pickupAddress: undefined },
			}),
		).toBe("no_pickup_address");
		expect(easyparcelQuoteBlock({ ...READY, senderPhone: "" })).toBe(
			"no_sender_phone",
		);
	});

	it("an account in another currency is held, not converted (the MYR sandbox on an SG store)", () => {
		expect(easyparcelQuoteBlock({ ...READY, storeCurrency: "SGD" })).toBe(
			"wrong_currency",
		);
		// Unknown currency makes no claim.
		expect(
			easyparcelQuoteBlock({
				...READY,
				storeCurrency: "SGD",
				conn: { ...READY.conn, balanceCurrency: undefined },
			}),
		).toBeNull();
	});
});
