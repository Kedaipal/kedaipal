/**
 * Despatch-label view-model (86eyp63mp) — the pure half of Kedaipal's third
 * PDF document, beside the order receipt and the subscription invoice.
 *
 * Same posture as `document.ts`: plain functions over plain data, no pdf-lib
 * and no Convex imports, so eligibility, party mapping, address lines, weight,
 * COD and batch sorting are all unit-testable in isolation. `render.ts` draws
 * whatever this returns.
 *
 * NOT A COURIER AWB. Kedaipal issues no consignment numbers — that needs a
 * courier booking API (the deferred Delyva/EasyParcel work). This is the
 * seller's OWN despatch label, carrying the courier name + tracking number they
 * already recorded through the manual-courier flow (86eyehvk4). Everything here
 * degrades: no courier, no tracking number, no weight, no date — the label
 * still prints, because sellers print labels BEFORE the courier handover at
 * least as often as after.
 */

import { displayAddressState } from "../address";
import { formatPhone } from "../customer";
import { formatFulfilmentDateTime } from "../fulfilmentDate";
import type { AwbConfig } from "../awbConfig";
import { losesCharacters, printable } from "./latin1";

// --- The document ----------------------------------------------------------

/** One addressed party on the label (sender or recipient). */
export type AwbParty = {
	/** Column heading — direction-aware, see `orderToAwbLabelData`. */
	heading: string;
	name: string;
	phone?: string;
	/** Address lines, already ordered and de-duplicated. May be empty (a store
	 * that never set a business address still gets a label). */
	lines: string[];
	/** Gate/landmark detail from the address itself — always printed, because
	 * it is addressing information, not an order note. */
	notes?: string;
	/** Set when the address lost characters the page cannot carry (see
	 * `./latin1`), so the block says so instead of letting a surviving house
	 * number pass for a whole address. */
	warning?: string;
};

export type AwbLabelData = {
	/** Brand line at the top of the label. */
	storeName: string;
	sender: AwbParty;
	recipient: AwbParty;
	orderShortId: string;
	orderDate: number;
	/** "Deliver on Fri, 21 Aug 2026 · 3:30 PM" — absent on a dateless order. */
	fulfilmentLabel?: string;
	courierName?: string;
	trackingNo?: string;
	/**
	 * Payload for the QR — the STOREFRONT URL (`<APP_URL>/<slug>?src=awb`),
	 * deliberately NOT the buyer's `/track/<token>` page. The tracking token is
	 * the buyer's capability (live order detail + address/phone/payment-claim
	 * mutations), and this QR goes on the OUTSIDE of a parcel where couriers and
	 * neighbours can scan it. The buyer already has their tracking link privately
	 * in WhatsApp; the parcel QR is the reorder loop instead — the store-poster
	 * posture. See docs/despatch-labels.md.
	 */
	storeUrl?: string;
	/**
	 * The payment strip, resolved cause-true at print time — or `undefined` when
	 * the store's template hides payment status entirely.
	 *  - `cod`: genuinely unpaid, so the amount to collect is printed big.
	 *  - `cod_pending`: unpaid AND the total isn't final yet (delivery charge
	 *    still to be agreed) — asks the seller to confirm rather than printing a
	 *    figure the buyer would be wrong to hand over.
	 *  - `paid`: already settled, so the label says so and tells the courier
	 *    there is nothing to collect. Printing a COD figure here is how a seller
	 *    gets paid twice.
	 */
	payment?:
		| { kind: "cod"; amount: number }
		| { kind: "cod_pending" }
		| { kind: "paid" };
	currency: string;
	/** "1.20 kg" — absent when any line has no parcel weight (never a guess). */
	weightLabel?: string;
	/** Line items, when the store's template shows them. The renderer truncates
	 * to whatever the fixed-height label has room for. */
	items?: Array<{ name: string; quantity: number }>;
	/** Total units across the order — printed even when items are hidden. */
	totalUnits: number;
	/** Buyer's order note, when the store's template shows it. */
	note?: string;
	/** Seller's own footer line (returns address, thank-you). */
	footerText?: string;
};

// --- Eligibility -----------------------------------------------------------

/** Why an order can't be given a despatch label. */
export type AwbSkipReason = "cancelled" | "no_address" | "not_found";

export const AWB_SKIP_REASONS: readonly AwbSkipReason[] = [
	"cancelled",
	"no_address",
	"not_found",
];

export type AwbSkipCounts = Record<AwbSkipReason, number>;

export function emptySkipCounts(): AwbSkipCounts {
	return { cancelled: 0, no_address: 0, not_found: 0 };
}

type EligibilityOrder = {
	status: string;
	deliveryAddress?: unknown;
};

/**
 * `null` when the order can be labelled, else why not. A parcel label needs a
 * place to send the parcel, so "no delivery address" is the real rule —
 * self-collect and most counter orders fall out of it naturally, rather than
 * being special-cased by `deliveryMethod`/`source`. Cancelled is checked FIRST
 * so a cancelled pickup order reports the more informative reason.
 */
export function labelSkipReason(order: EligibilityOrder): AwbSkipReason | null {
	if (order.status === "cancelled") return "cancelled";
	if (!order.deliveryAddress) return "no_address";
	return null;
}

type ReadyOrder = EligibilityOrder & {
	paymentStatus?: string;
	deliveryMethod?: string;
	deliveryDirection?: string;
};

/**
 * The "ready to ship" queue: packed, paid for, and going out by parcel.
 *
 * `packed` (not `confirmed`) because packing is the step that produces a
 * physical parcel, and NOT `shipped` because those are already gone. Payment
 * received keeps an unpaid order out of a one-click bulk print — the seller
 * decides deliberately whether to send those COD.
 *
 * Collection orders (86eyg0n8e) are excluded: their rider travels buyer →
 * seller, so "packed" there means work in progress, not a parcel awaiting a
 * courier. They can still be printed from an explicit selection.
 *
 * Printing does NOT advance anything — a label in the printer tray is not a
 * parcel in a courier's hands, so the seller still marks them shipped when
 * they actually hand them over.
 */
export function isReadyToShipForLabel(order: ReadyOrder): boolean {
	return (
		order.status === "packed" &&
		(order.paymentStatus ?? "unpaid") === "received" &&
		(order.deliveryMethod ?? "delivery") === "delivery" &&
		order.deliveryDirection !== "collection" &&
		labelSkipReason(order) === null
	);
}

// --- Sorting ---------------------------------------------------------------

export type AwbSort = "fulfilment" | "status" | "courier" | "area";

export const AWB_SORTS: readonly AwbSort[] = [
	"fulfilment",
	"status",
	"courier",
	"area",
];

/** The fields a batch sorts on, carried beside each label so the action can
 * order pages it fetched separately. */
export type AwbSortKey = {
	fulfilmentDate?: number;
	createdAt: number;
	status: string;
	courierName?: string;
	state: string;
	city: string;
	postcode: string;
	shortId: string;
};

export type AwbBatchItem = {
	label: AwbLabelData;
	sort: AwbSortKey;
};

/**
 * Most labels one print job may carry. 100 is 25 A4 sheets — a realistic
 * one-shot print run, and the same batch ceiling `bulkDeleteOrders` uses.
 * Shared client + server so the dialog can disable BEFORE the round-trip and
 * the action can still refuse a hand-rolled call.
 *
 * The two callers handle the ceiling differently ON PURPOSE: an explicit
 * selection over the cap is refused (silently dropping orders a seller
 * deliberately ticked is the worst outcome), while the ready-to-ship queue
 * prints its first 100 and reports the remainder — "everything that's ready"
 * has no subset to narrow to, and a refusal would just block the despatch run.
 */
export const AWB_BATCH_MAX = 100;

/** Fulfilment pipeline order — the sequence the seller works through. */
const STATUS_RANK: Record<string, number> = {
	pending: 0,
	confirmed: 1,
	packed: 2,
	shipped: 3,
	delivered: 4,
	cancelled: 5,
};

function compareStrings(a: string, b: string): number {
	return a.localeCompare(b, "en");
}

/** Undefined sorts last in every mode — an unset field is not "before A". */
function compareOptional(
	a: string | undefined,
	b: string | undefined,
): number {
	if (a === b) return 0;
	if (a === undefined) return 1;
	if (b === undefined) return -1;
	return compareStrings(a, b);
}

/** Date-ascending, dateless last — the inbox's own default order. */
function compareByFulfilment(a: AwbSortKey, b: AwbSortKey): number {
	if (a.fulfilmentDate !== b.fulfilmentDate) {
		if (a.fulfilmentDate === undefined) return 1;
		if (b.fulfilmentDate === undefined) return -1;
		return a.fulfilmentDate - b.fulfilmentDate;
	}
	return a.createdAt - b.createdAt;
}

/**
 * Order a printed stack. Every mode falls back to fulfilment date then order
 * number, so the sort is total and a re-print comes out identically.
 *
 * "area" sorts state → city → postcode. That needs no country branch: an SG
 * store's state and city are both the literal "Singapore", so it degrades to
 * postcode order — which in Singapore IS geographic (the first two digits are
 * the postal sector).
 */
export function compareAwbItems(
	a: AwbBatchItem,
	b: AwbBatchItem,
	sort: AwbSort,
): number {
	let primary = 0;
	if (sort === "status") {
		primary = (STATUS_RANK[a.sort.status] ?? 9) - (STATUS_RANK[b.sort.status] ?? 9);
	} else if (sort === "courier") {
		primary = compareOptional(a.sort.courierName, b.sort.courierName);
	} else if (sort === "area") {
		primary =
			compareStrings(a.sort.state, b.sort.state) ||
			compareStrings(a.sort.city, b.sort.city) ||
			compareStrings(a.sort.postcode, b.sort.postcode);
	}
	return (
		primary ||
		compareByFulfilment(a.sort, b.sort) ||
		compareStrings(a.sort.shortId, b.sort.shortId)
	);
}

export function sortAwbItems(
	items: AwbBatchItem[],
	sort: AwbSort,
): AwbBatchItem[] {
	return [...items].sort((a, b) => compareAwbItems(a, b, sort));
}

// --- Mapping ---------------------------------------------------------------

type AddressForAwb = {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postcode: string;
	notes?: string;
};

export type OrderForAwb = {
	shortId: string;
	createdAt: number;
	status: string;
	paymentStatus?: string;
	/** Not read by the label itself (the address is the real rule) — it's here
	 * so one order shape satisfies both the mapper and the ready-to-ship gate. */
	deliveryMethod?: string;
	deliveryDirection?: string;
	deliveryAddress?: AddressForAwb;
	deliveryFeePending?: boolean;
	customer: { name?: string; waPhone?: string };
	items: Array<{ name: string; variantLabel?: string; quantity: number }>;
	total: number;
	currency: string;
	fulfilmentDate?: number;
	fulfilmentTimeMinutes?: number;
	customerNote?: string;
	courierName?: string;
	trackingNo?: string;
};

export type RetailerForAwb = {
	storeName: string;
	waPhone?: string;
	businessAddress?: { label: string };
};

/**
 * Address → lines: street, then "postcode city", then the state (dropped when
 * it just repeats the city — see `displayAddressState`).
 *
 * Composition only. Clamping the result to what the page can draw is
 * `clampLines`' job, deliberately kept separate so this stays a pure statement
 * about how a Malaysian or Singaporean address is laid out.
 */
export function addressLines(address: AddressForAwb): string[] {
	const lines = [address.line1.trim()];
	const line2 = address.line2?.trim();
	if (line2) lines.push(line2);
	lines.push(`${address.postcode.trim()} ${address.city.trim()}`.trim());
	const state = displayAddressState(address);
	if (state) lines.push(state);
	return lines.filter((l) => l.length > 0);
}

/**
 * Latin-1 has no warning glyph, so "!" carries the alarm. Two wordings because
 * the two blocks send the reader to two different places to fix it.
 */
const RECIPIENT_ADDRESS_WARNING = "! Address incomplete - check the order";
const SENDER_ADDRESS_WARNING = "! Return address incomplete - check Settings";

/**
 * Clamp a party's address lines to what the page can actually carry.
 *
 * A line that loses everything is DROPPED rather than drawn blank. A line that
 * loses only some of its characters is KEPT — a surviving "#12-345" is still a
 * unit number a courier can use — but either case sets `lost`, because the
 * danger here is not a gap: it is the "238" left behind by "新加坡乌节路238号",
 * which reads like a real address line and is not one. `lost` puts a warning in
 * the block so nobody trusts what survived.
 */
function clampLines(raw: string[]): { lines: string[]; lost: boolean } {
	const lines: string[] = [];
	let lost = false;
	for (const line of raw) {
		if (losesCharacters(line)) lost = true;
		const clean = printable(line);
		if (clean) lines.push(clean);
	}
	return { lines, lost };
}

/** Grams → a printable weight. Grams below a kilo stay grams (a courier's
 * counter scale reads them that way); above, two decimals of a kilo. */
export function formatParcelWeight(grams: number): string | undefined {
	if (!Number.isFinite(grams) || grams <= 0) return undefined;
	const rounded = Math.round(grams);
	if (rounded < 1000) return `${rounded} g`;
	return `${(rounded / 1000).toFixed(2)} kg`;
}

/**
 * Build one label. `weightGrams` is resolved by the caller through
 * `summarizeCartWeight` (the same never-silently-underweigh rule the weight/zone
 * delivery pricing uses), so an unweighable cart arrives here as `undefined`
 * and the weight simply isn't printed.
 */
export function orderToAwbLabelData(args: {
	order: OrderForAwb;
	retailer: RetailerForAwb;
	config: AwbConfig;
	/** `${APP_URL}/<slug>?src=awb` — see `AwbLabelData.storeUrl`. */
	storeUrl?: string;
	weightGrams?: number;
}): AwbLabelData {
	const { order, retailer, config, storeUrl, weightGrams } = args;
	const address = order.deliveryAddress;
	const collection = order.deliveryDirection === "collection";

	// EVERY string below is clamped BEFORE it is tested for emptiness — the whole
	// point of `printable`. Testing the raw string first is the bug this file
	// used to carry: "陈大文" is a perfectly non-empty name that draws as nothing,
	// so the fallback never fired and the courier got a blank line where they
	// look first.
	const storeName = printable(retailer.storeName) ?? "Store";
	const storeAddress = clampLines(
		retailer.businessAddress ? [retailer.businessAddress.label] : [],
	);
	const storeParty: Omit<AwbParty, "heading"> = {
		name: storeName,
		phone: retailer.waPhone ? formatPhone(retailer.waPhone) : undefined,
		lines: storeAddress.lines,
		warning: storeAddress.lost ? SENDER_ADDRESS_WARNING : undefined,
	};

	const buyerAddress = clampLines(address ? addressLines(address) : []);
	// Address notes are addressing information (gate codes, landmarks), so losing
	// them counts against the same warning as losing a street.
	const notesLost = address?.notes !== undefined && losesCharacters(address.notes);
	const buyerName = recipientDisplayName(order.customer);
	const buyerPhone = order.customer.waPhone
		? formatPhone(order.customer.waPhone)
		: undefined;
	const buyerParty: Omit<AwbParty, "heading"> = {
		name: buyerName,
		// When the name FELL BACK to the phone (an unnamed buyer, or one whose
		// name the page can't draw), printing the same digits again underneath
		// reads as a glitch. One identity, stated once.
		phone: buyerPhone === buyerName ? undefined : buyerPhone,
		lines: buyerAddress.lines,
		notes: printable(address?.notes),
		warning:
			buyerAddress.lost || notesLost ? RECIPIENT_ADDRESS_WARNING : undefined,
	};

	// A collection trip runs buyer → seller, so the parcel's two ends swap.
	// Same layout, honest headings — never a label that says "deliver to" for a
	// journey going the other way.
	const sender: AwbParty = collection
		? { heading: "Collect from", ...buyerParty }
		: { heading: "From", ...storeParty };
	const recipient: AwbParty = collection
		? { heading: "Return to", ...storeParty }
		: { heading: "Deliver to", ...buyerParty };

	const paid = (order.paymentStatus ?? "unpaid") === "received";
	const units = order.items.reduce((sum, i) => sum + i.quantity, 0);
	const payment: AwbLabelData["payment"] = !config.showCod
		? undefined
		: paid
			? { kind: "paid" }
			: order.deliveryFeePending
				? { kind: "cod_pending" }
				: { kind: "cod", amount: order.total };

	return {
		storeName,
		sender,
		recipient,
		orderShortId: order.shortId,
		orderDate: order.createdAt,
		fulfilmentLabel:
			order.fulfilmentDate === undefined
				? undefined
				: `${collection ? "Collect on" : "Deliver on"} ${formatFulfilmentDateTime(
						order.fulfilmentDate,
						order.fulfilmentTimeMinutes,
					)}`,
		courierName: printable(order.courierName),
		trackingNo: printable(order.trackingNo),
		storeUrl,
		payment,
		currency: order.currency,
		weightLabel:
			config.showWeight && weightGrams !== undefined
				? formatParcelWeight(weightGrams)
				: undefined,
		items: config.showItems
			? order.items.map((i) => {
					// Composed from clamped parts, so a Chinese product name can never
					// print as a bare "2 x" or a variant as "Ribeye ()".
					const name = printable(i.name) ?? "Item";
					const variant = printable(i.variantLabel);
					return {
						name: variant ? `${name} (${variant})` : name,
						quantity: i.quantity,
					};
				})
			: undefined,
		totalUnits: units,
		note: config.showNote ? printable(order.customerNote) : undefined,
		footerText: printable(config.footerText),
	};
}

/**
 * Who the parcel is for — the buyer's PRINTABLE name, else the phone a courier
 * can call, else a neutral word (mirrors `orderCustomerLabel`'s walk-in
 * posture).
 *
 * "Printable" is load-bearing, not decoration. A name written in Chinese — the
 * norm in Singapore, and this stack onboards Singapore — is non-empty in the
 * database and empty on the page, so a fallback chosen on the raw string leaves
 * the recipient block blank at the exact spot a courier reads first. Clamping
 * first means such a buyer gets their phone number printed instead: still
 * deliverable, and honest about what the page can carry.
 *
 * Shared by the label's recipient block and the print-queue rows, so the modal
 * names an order exactly the way its label will — a seller who sees a phone
 * number where they expected a name has learned something true before they
 * print forty of them.
 */
export function recipientDisplayName(customer: {
	name?: string;
	waPhone?: string;
}): string {
	const name = printable(customer.name);
	if (name) return name;
	const phone = customer.waPhone?.trim();
	return phone ? formatPhone(phone) : "Customer";
}

/** The sort key that travels with a label through a paginated batch. */
export function awbSortKey(order: OrderForAwb): AwbSortKey {
	return {
		fulfilmentDate: order.fulfilmentDate,
		createdAt: order.createdAt,
		status: order.status,
		courierName: order.courierName?.trim() || undefined,
		state: order.deliveryAddress?.state ?? "",
		city: order.deliveryAddress?.city ?? "",
		postcode: order.deliveryAddress?.postcode ?? "",
		shortId: order.shortId,
	};
}
