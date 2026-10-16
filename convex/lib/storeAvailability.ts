// Store availability (`z8r3fdudf7`) — the ONE author of "is this store taking
// orders, and if not, who switched it off?". Every order door, the storefront
// payload, the directory and the dashboard banner resolve through here, so no
// two surfaces can disagree about whether a store is open.
//
// Three authors can switch ordering off, each with its own stamp so one can
// never clear another's:
//   - an ADMIN (moderation): paused, or offline — the store disappears;
//   - Off-Season HOLD (billing, `retailers.orderingPausedAt`, z8r3fday24);
//   - the SELLER: paused only ("not taking orders right now").
// Precedence: admin offline > admin paused > hold > seller paused > open.
// The strongest switch speaks; lifting it reveals the next one down, never a
// store that silently reopened.
//
// Pure on purpose (no ctx) so `src/lib` can import it for the same answer.

import { orderingPausedMessage } from "./seasonalHold";

export type AvailabilityState = "open" | "paused" | "offline";
export type AvailabilityBy = "admin" | "hold" | "seller";

export type StoreAvailability =
	| { state: "open" }
	| {
			state: "paused" | "offline";
			by: AvailabilityBy;
			/** A note for whoever reads it: the seller's to buyers ("Back on 1
			 * Nov"), or Kedaipal's to the seller. Never shown to buyers when
			 * an admin wrote it. */
			note?: string;
	  };

/** The availability row (`storeAvailability`), or the slice of it this
 * module reads. Absent row = nothing switched off by seller or admin. */
export type AvailabilityRow = {
	sellerPausedAt?: number;
	sellerPauseNote?: string;
	adminMode?: "paused" | "offline";
	adminNote?: string;
};

export const STORE_PAUSE_NOTE_MAX = 140;

export function resolveStoreAvailability(input: {
	/** `retailers.orderingPausedAt` — the Off-Season Hold stamp. */
	holdPausedAt?: number;
	row?: AvailabilityRow | null;
}): StoreAvailability {
	const row = input.row ?? undefined;
	if (row?.adminMode === "offline")
		return { state: "offline", by: "admin", note: row.adminNote };
	if (row?.adminMode === "paused")
		return { state: "paused", by: "admin", note: row.adminNote };
	if (input.holdPausedAt !== undefined) return { state: "paused", by: "hold" };
	if (row?.sellerPausedAt !== undefined)
		return { state: "paused", by: "seller", note: row.sellerPauseNote };
	return { state: "open" };
}

/** Is a BUYER order door open? Closed for any switch. */
export function takesBuyerOrders(a: StoreAvailability): boolean {
	return a.state === "open";
}

/**
 * Is the COUNTER open? A seller's own pause stops ONLINE orders — they're
 * standing at the counter, they paused the storefront, not their till. Hold
 * and every admin switch close the counter too.
 */
export function takesCounterOrders(a: StoreAvailability): boolean {
	return a.state === "open" || (a.state === "paused" && a.by === "seller");
}

/**
 * The sentence a refused BUYER sees — the same one the storefront banner
 * shows, so a stale tab's refusal reads like the page it came from. An admin
 * switch is NEUTRAL: never "suspended", never "unpaid" (the
 * `lib/buyerPayments.ts` rule — a buyer is not told a store's business).
 */
export function unavailableMessage(
	a: StoreAvailability,
	storeName: string,
): string {
	if (a.state === "open") return "";
	// Offline: the store itself is gone from view. A Kedaipal PAUSE leaves it
	// browsable, so it reads like a seller's pause with no note — the same
	// calm "not right now", and nothing about why.
	if (a.state === "offline") return `${storeName} isn't available right now.`;
	if (a.by === "hold") return orderingPausedMessage(storeName);
	const note = a.by === "seller" ? a.note?.trim() : undefined;
	return note
		? `${storeName} isn't taking orders right now — ${note}`
		: `${storeName} isn't taking orders right now. Browse the menu and check back soon.`;
}

/**
 * The sentence the SELLER sees when their counter is closed — on the Counter
 * page before they tap, and as the refusal from the counter and claim-link
 * doors. Never the buyer sentence above: "Browse the menu and check back
 * soon" said to the person behind the till reads as nonsense (found
 * hands-on). Says who closed it and the one way back. `""` while the counter
 * is open, including under the seller's own pause (they paused online orders,
 * not their till).
 */
export function counterClosedMessage(a: StoreAvailability): string {
	if (takesCounterOrders(a) || a.state === "open") return "";
	if (a.by === "hold")
		return "Your store is on an Off-Season Hold, so the counter is closed too. Resume your plan in Billing to take orders again.";
	return a.state === "offline"
		? "Kedaipal has taken your store offline, so the counter can't take orders either. Message us from the banner above to ask why."
		: "Kedaipal has paused ordering at your store, so the counter can't take orders either. Message us from the banner above to ask why.";
}

/** Normalise a seller- or admin-typed note: trimmed, capped, blank = none. */
export function cleanAvailabilityNote(note: string | undefined): string | undefined {
	const t = note?.trim().replace(/\s+/g, " ");
	if (!t) return undefined;
	return t.slice(0, STORE_PAUSE_NOTE_MAX);
}
