// A gated order is INVISIBLE, not merely un-actionable (Credits T3.1, ClickUp
// z8r3fdmg4h — Zaki, 6 Oct 2026).
//
// Greying the buttons out leaves the buyer's name, phone and address on
// screen, so a seller out of credits settles the order by hand in WhatsApp and
// the gate collects nothing. That makes the gate a server READ-PATH rule, not
// a UI state: every seller-facing read of an order runs the row through
// `redactGatedOrder` before it crosses the wire, and the client never receives
// what it isn't allowed to show.
//
// The buyer's own door is untouched. `/track/<token>` and every public buyer
// mutation key on `orders.trackingToken`, never on the seller's `shortId`, so
// a buyer sees their order in full at any seller balance — which the storefront
// parity test (+50 vs −50) pins.
//
// ## Why an allowlist
//
// Redaction by deletion ("blank these twelve fields") leaks every field added
// afterwards, silently, and the thing it leaks is a phone number. So this
// builds the gated row from the fields that are KNOWN SAFE and drops
// everything else. A new field on `orders` is therefore invisible to a gated
// row until someone adds it here on purpose.
//
// `orderGate.test.ts` backs that up from the other side: it seeds an order
// whose every buyer-supplied field holds a sentinel, serialises the gated row
// and asserts not one sentinel survives — so a leak fails the suite even if
// the leaking field was added to the allowlist by mistake.
//
// ## What survives, and why that is the right amount
//
// Reference, when it arrived, what it's worth, how it leaves, whether it's
// paid. Nothing that identifies the buyer, nothing that describes what they
// ordered, and above all no capability (`trackingToken`) and no `customerId`,
// either of which would walk the seller straight back to the phone number.
//
// Keeping the MONEY and the DATE is deliberate, not an oversight: "3 orders
// waiting · RM 340 · one due Friday" is both the honest state of the inbox and
// the strongest reason to top up. A row that says nothing at all is just
// confusing, and confusion doesn't sell credits.

import type { Doc } from "../_generated/dataModel";

/**
 * The fields a GATED order still shows. Everything not named here is dropped.
 *
 * Read the companion list in the module header before adding one: the test
 * that guards this is a sentinel sweep, so a field holding buyer-supplied text
 * will fail the suite the moment it is added.
 */
const GATED_ORDER_FIELDS = [
	// Identity of the ROW, not of the buyer.
	"_id",
	"_creationTime",
	"retailerId",
	"shortId",
	"creditSeq",
	// Where it sits in the seller's workflow.
	"status",
	"currentStageId",
	"channel",
	"source",
	"attributionSource",
	"createdByUserId",
	// When.
	"createdAt",
	"updatedAt",
	"statusChangedAt",
	"seenAt",
	"pinnedAt",
	// What it's worth. Money is never the loophole — you can't deliver a cake
	// to a total — and it is the whole reason a seller tops up.
	"subtotal",
	"total",
	"currency",
	"deliveryFee",
	"deliveryFeePending",
	"pickupFee",
	// How it leaves and when it's due, so the inbox's fulfilment cell, the
	// due-today banner and the booking-period chips stay honest. A method and a
	// date reach nobody without an address or a number to go with them.
	"deliveryMethod",
	"deliveryDirection",
	"fulfilmentDate",
	"fulfilmentTimeMinutes",
	"bookingCheckIn",
	"bookingCheckOut",
	"bookingPackaged",
	// Whether the money arrived. The buyer's bank REFERENCE is not here — that
	// is their data and it is how a seller would reconcile by hand.
	"paymentStatus",
	"paymentMethod",
	"paymentClaimedAt",
	"paymentReceivedAt",
	"paymentDueAt",
	// The mockup FLAG only (the inbox counts it); never the images, the note or
	// the quote.
	"mockupStatus",
] as const satisfies readonly (keyof Doc<"orders"> | "_id" | "_creationTime")[];

/**
 * An order row as a SELLER surface returns it.
 *
 * Deliberately the same type as a real order row with two fields added, NOT a
 * union: every field the allowlist drops is optional on `orders`, and the ones
 * that aren't (`items`, `customer`) are blanked rather than removed — so a
 * gated row IS a structurally valid order document. The inbox table, the
 * column registry, the CSV writer and the order page therefore keep working
 * unchanged and render a blank where the data would have been.
 *
 * A union would have made every one of those call sites a type puzzle, and
 * type puzzles are where leaks hide. What keeps the rule honest is not the
 * type but the server-side redaction plus the sentinel sweep in
 * `orderGate.test.ts` — the type's job here is to stay out of the way.
 */
export type SellerOrder = Doc<"orders"> & {
	/** Present and `true` ONLY on a gated row — `row.creditGated === true` is
	 * the single test any surface needs. */
	creditGated?: true;
	/** How many credits open it (`creditsToUnlockOrder`), so the row can say
	 * "waiting on 3 credits" rather than a store-wide sentence. */
	creditsToUnlock?: number;
};

/**
 * Strip a gated order down to what a seller may see. Pass `gated: false` for a
 * funded order and it hands back the row untouched — so a call site reads
 * `redactGatedOrder(o, gate)` once and never grows an `if`.
 */
export function redactGatedOrder(
	order: Doc<"orders">,
	gated: { gated: boolean; creditsToUnlock: number },
): SellerOrder {
	if (!gated.gated) return order;
	const safe = {} as Record<string, unknown>;
	for (const key of GATED_ORDER_FIELDS) {
		const value = (order as Record<string, unknown>)[key];
		if (value !== undefined) safe[key] = value;
	}
	// The allowlist above is a runtime loop over string keys, so TS can't see
	// what it produced — hence the cast. But it is cast to `GatedRow`, not
	// straight to the return type, and `GatedRow` is `Pick<Doc<"orders">, …>`:
	// returning it as a `SellerOrder` is therefore an assignment TS checks, so
	// dropping a REQUIRED field name from `GATED_ORDER_FIELDS` (`currency`,
	// `status`, `total`…) breaks the build here rather than producing a row that
	// fails validation in front of a seller.
	//
	// `items` and `customer` are blanked rather than dropped because the
	// validator requires them — and an empty `customer` is also what makes the
	// inbox's name/phone search unable to match a gated order at all. The
	// redaction IS the search rule, rather than a second rule that could
	// disagree with it.
	const row = { ...safe, items: [], customer: {} } as unknown as GatedRow;
	return { ...row, creditGated: true, creditsToUnlock: gated.creditsToUnlock };
}

/** Is this row the gated stand-in? The one test every surface uses. */
export function isGatedOrder(order: {
	creditGated?: boolean;
}): boolean {
	return order.creditGated === true;
}

/** Exactly what the allowlist produces. `redactGatedOrder` casts to this and
 * then returns it as a `SellerOrder`, which is how TS ends up checking that
 * the allowlist still covers every field an order document requires. */
type GatedRow = Pick<Doc<"orders">, (typeof GATED_ORDER_FIELDS)[number]> & {
	items: Doc<"orders">["items"];
	customer: Doc<"orders">["customer"];
};

/**
 * A CUSTOMER whose every order is gated (Credits T3.1). Orders are debited in
 * sequence, so a buyer's first order carries their lowest `creditSeq`: if even
 * that one is above the watermark then every order they have ever placed is
 * gated, and the record must not hand the seller the phone number the gate is
 * holding back — the customer page shows purchase history, which would be the
 * loophole with extra steps.
 *
 * Stamped once, never updated, so ONE funded order makes a buyer known for
 * good: a returning customer the seller already knows is never hidden by a
 * later order going unfunded, which is the same "funded stays funded" promise
 * the order gate makes. Absent ⇒ visible (every customer from before T3.1).
 */
export function isCustomerGated(
	customer: { firstOrderCreditSeq?: number; neverFunded?: boolean },
	fundedThrough: number,
): boolean {
	// The order that created this record was cancelled while gated, so the
	// refund walked the watermark past `firstOrderCreditSeq` and the
	// comparison below would now say "visible" for a buyer the seller has
	// never been shown. Same trap as `orders.neverFunded`, one table over —
	// and the thing it leaks is the phone number.
	if (customer.neverFunded === true) return true;
	return (
		customer.firstOrderCreditSeq !== undefined &&
		customer.firstOrderCreditSeq > fundedThrough
	);
}

/** The fields a gated CUSTOMER still shows: how much they've spent and when,
 * never who they are. Same bargain as the order row — the aggregates are the
 * top-up argument, the identity is what the gate holds. */
const GATED_CUSTOMER_FIELDS = [
	"_id",
	"_creationTime",
	"retailerId",
	"orderCount",
	"totalSpent",
	"firstOrderAt",
	"lastOrderAt",
	"firstOrderCreditSeq",
	"createdAt",
	"updatedAt",
] as const satisfies readonly (
	| keyof Doc<"customers">
	| "_id"
	| "_creationTime"
)[];

/** Same bargain as `SellerOrder`: a real customer document with one flag
 * added, so every surface keeps its types and renders a blank. */
export type SellerCustomer = Doc<"customers"> & { creditGated?: true };

/** The `GatedRow` twin for customers — same load-bearing cast, same proof. */
type GatedCustomerRow = Pick<
	Doc<"customers">,
	(typeof GATED_CUSTOMER_FIELDS)[number]
> & { waPhone: string; searchText: string };

/** Strip a gated customer to their aggregates. */
export function redactGatedCustomer(
	customer: Doc<"customers">,
	gated: boolean,
): SellerCustomer {
	if (!gated) return customer;
	const safe = {} as Record<string, unknown>;
	for (const key of GATED_CUSTOMER_FIELDS) {
		const value = (customer as Record<string, unknown>)[key];
		if (value !== undefined) safe[key] = value;
	}
	// Same load-bearing cast as `redactGatedOrder` — see the note there.
	// Blanking `searchText` is what stops the customer SEARCH finding a gated
	// buyer by name or number: one rule applied once, rather than a filter that
	// could drift from it.
	const row = {
		...safe,
		waPhone: "",
		searchText: "",
	} as unknown as GatedCustomerRow;
	return { ...row, creditGated: true };
}

export function isGatedCustomer(customer: { creditGated?: boolean }): boolean {
	return customer.creditGated === true;
}
