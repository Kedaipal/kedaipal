import { HOLDING_LEAVES } from "../../convex/lib/orderBuckets";

/**
 * The inbox search that opens EXACTLY the orders a registered/seat count was
 * made of (`z8r3fdjv0d`): one listing, one fulfilment day, and only the
 * statuses that still hold a place. The Schedule row and the event RSVP panel
 * both count with `holdsSeats`, so both open through this one door — without
 * the status scope the inbox listed a cancelled order beside "Open 2 orders",
 * and a seller who doesn't notice the red badge reads a discrepancy.
 *
 * The chip row then reads New + In progress + Completed lit and Cancelled dark,
 * which is the honest picture of what the number excluded, and the seller can
 * tap Cancelled to see the rest.
 */
export function listingOrdersSearch(productId: string, dateMyt: number) {
	return {
		listing: productId,
		ffrom: dateMyt,
		fto: dateMyt,
		st: [...HOLDING_LEAVES],
	};
}
