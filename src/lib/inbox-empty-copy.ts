/**
 * What the empty inbox says — pure, because the bug it replaced was a wiring
 * one: the route fed `filtersActive` a condition that included the status axis,
 * which made the per-bucket copy ("No new orders…") and the "Nothing in those
 * statuses" arm unreachable — every chip tap rendered the generic "No orders
 * match your filters" (PR #243 review). Deriving the answer here, from the raw
 * state slices, is what lets a test pin each arm's reachability.
 *
 * Priority is part of the contract, most-specific claim last:
 *
 * 1. searching — the term explains the emptiness, whatever else is on;
 * 2. pinned-only — reaching an empty list with it on means the pin set is the
 *    binding constraint (pins that matched would be showing), and it outranks
 *    the arms below because each of those would then be a lie: "no orders need
 *    a mockup" is false when unpinned mockup orders exist. It is also the
 *    easiest constraint to enter by accident — the Pinned chip is a THREE-way
 *    cycle and "only" is its second position;
 * 3. mockup — its own cross-cutting toggle, with its own "caught up" copy;
 * 4. any NON-status filter — the generic line plus the clear affordance. The
 *    status axis deliberately does NOT count here: the chip row is the
 *    seller's PLACE (the old bucket segment control's successor), and telling
 *    someone who tapped one chip to "adjust or clear the filters" hides the
 *    copy written for exactly that state;
 * 5. a status selection that is NOT exactly one whole bucket (a partial group,
 *    a mix, or any booking period) — "nothing in those statuses", because the
 *    per-bucket copy would be false for it and the generic "no orders yet"
 *    would tell a seller with 118 orders that they have none;
 * 6. exactly one whole bucket — that bucket's own copy, the state one chip tap
 *    produces;
 * 7. nothing at all — the true "no orders yet".
 */

import type { BookingPeriod } from "../../convex/lib/bookingPeriod";
import { wholeBucketSelected } from "./inbox-status-chips";

export type InboxEmptyCopy = { title: string; body: string };

export function inboxEmptyCopy(args: {
	searching: boolean;
	mockup: boolean;
	/** Any active filter OUTSIDE the status axis — payment, method, dates,
	 * due window, order type, categories, origin. See rule 4 above. */
	filtersActive: boolean;
	/** `pinMode === "only"` — the seller asked for pinned orders alone. */
	pinOnly: boolean;
	/** Whether the seller has ANY pinned orders. Splits "your pins are all
	 * outside this filter" from "you haven't pinned anything" — the second is
	 * reachable by unpinning the last row while in "only" mode, and the first
	 * sentence would be false there. */
	anyPinned: boolean;
	/** The status axis, exactly as the chip rules read it. */
	statuses: readonly string[];
	periods: readonly BookingPeriod[];
}): InboxEmptyCopy {
	const {
		searching,
		pinOnly,
		anyPinned,
		mockup,
		filtersActive,
		statuses,
		periods,
	} = args;
	if (searching)
		return {
			title: "No matches",
			body: "No orders match your search. Try an order #, name, phone, or item.",
		};
	if (pinOnly)
		return anyPinned
			? {
					title: "No pinned orders match",
					body: "Only your pinned orders are showing, and none of them is in the statuses or filters you picked. Tap Pinned only again to switch it off.",
				}
			: {
					// Reachable by unpinning the last row while in "only" mode — the
					// list empties under you. The sentence above would be a lie here,
					// and the way out is the chip, since the list has no row left to
					// unpin.
					title: "No pinned orders",
					body: "You haven't pinned anything yet. Tap Pinned only to switch the filter off — then pin an order from its row to keep it handy.",
				};
	if (mockup)
		return {
			title: "No orders need a mockup",
			body: "You're all caught up — nothing is waiting on a design right now.",
		};
	if (filtersActive)
		return {
			title: "No orders match your filters",
			body: "Adjust or clear the filters to see more.",
		};
	const wholeBucket = wholeBucketSelected(statuses, periods);
	if ((statuses.length > 0 || periods.length > 0) && wholeBucket === null)
		return {
			title: "Nothing in those statuses",
			body: "None of the statuses you picked has an order right now. Each chip shows its own count.",
		};
	switch (wholeBucket) {
		case "new":
			return {
				title: "No new orders",
				body: "You're all caught up 🎉 New WhatsApp orders land here first.",
			};
		case "in_progress":
			return {
				title: "Nothing in progress",
				body: "Orders you've confirmed, packed, or shipped will show here.",
			};
		case "completed":
			return {
				title: "No completed orders yet",
				body: "Delivered orders move here once you mark them done.",
			};
		case "cancelled":
			return {
				title: "No cancelled orders",
				body: "Nothing cancelled — good.",
			};
		default:
			return {
				title: "No orders yet",
				body: "When shoppers checkout via WhatsApp, orders will appear here.",
			};
	}
}
