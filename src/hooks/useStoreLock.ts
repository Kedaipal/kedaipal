import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { orderGatedLine } from "../lib/credits-ui";
import { isStoreReadOnly, storeReadOnlyReason } from "../lib/subscription";
import { AREA_COPY, type PermissionArea } from "../lib/team-permissions";
import { useCreditGate } from "./useCreditGate";
import { useDashboardRetailer } from "./useDashboardRetailer";
import { usePermission, useStoreRole } from "./usePermission";

/**
 * Is the dashboard view-only right now, and why (z8r3fdeub2)?
 *
 * A store whose subscription lapsed can read everything and change nothing —
 * the server refuses every seller write, orders included. Controls that would
 * refuse must SAY so before the tap, so this is the one hook they all read.
 *
 * Costs nothing extra: both reads are the same cached queries the app shell
 * already subscribes to, so a component calling this is a cache hit.
 */
export function useStoreLock(): { readOnly: boolean; reason: string } {
	const retailer = useDashboardRetailer();
	const isMember = useStoreRole() === "member";
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data === true;
	return {
		readOnly: isStoreReadOnly(retailer, isAdmin),
		reason: storeReadOnlyReason(retailer?.subscription, isMember),
	};
}

/**
 * Is THIS AREA view-only for the person on screen, and why (86exr91r4)?
 *
 * `useStoreLock` answers the store-wide question: a lapsed subscription
 * freezes every seller write, owner included. A TEAMMATE can be frozen for a
 * second, independent reason — the owner granted them view on this area and
 * not edit — and the matrix offers exactly that, so it is a state the product
 * sells, not an edge case. Both end in the same place (a control that must say
 * why before it is tapped), so they share one shape: a surface that already
 * reads `{ readOnly, reason }` gains permission gating by changing which hook
 * it calls, and every disabled state it already designed keeps working.
 *
 * The SUBSCRIPTION wins when both apply. It is the store-wide fact, it blocks
 * the owner too, and "ask the owner for edit access" would send a teammate
 * chasing a grant that still wouldn't let them save.
 *
 * Reads nothing new: `usePermission` resolves off the same cached retailer
 * payload the shell already holds.
 */
/** Which lock is speaking, so a greyed-out control can name it in its label
 * (`lockLabel`) while the full sentence lives in `reason`. */
export type AreaLockCause = "subscription" | "credits" | "permission";

export function useAreaLock(
	area: PermissionArea,
	opts?: {
		/**
		 * The ORDER this control acts on, when the credit gate applies to it
		 * (Credits T3.1): accepting or moving it forward, taking payment by
		 * hand, booking a courier, printing a label, handing out a receipt.
		 *
		 * An ORDER, not a boolean — that is the whole of T3.1. The gate used to
		 * be store-wide, so a boolean was enough; now the answer depends on
		 * WHICH order, because one that already paid for its credit stays
		 * workable for life. Leave it out for what is never gated: cancel,
		 * refund, pinning, settings, and the catalogue (which the subscription
		 * pays for, not credits).
		 *
		 * `null`/`undefined` reads as "not gated", so a control whose order
		 * hasn't loaded yet never flashes disabled.
		 */
		creditOrder?: { creditSeq?: number; creditGated?: boolean } | null;
	},
): {
	readOnly: boolean;
	reason: string;
	cause: AreaLockCause | null;
} {
	const store = useStoreLock();
	const gate = useCreditGate();
	const { canWrite, role } = usePermission(area);
	if (store.readOnly) return { ...store, cause: "subscription" };
	// The SUBSCRIPTION lock is checked first and wins: it is the store-wide
	// fact, it blocks the owner too, and a seller whose plan lapsed must not be
	// told to buy credits (the two gates compose without double-messaging —
	// `assertSubscriptionActive` runs before `assertOrderCreditAvailable` at
	// every server call site for the same reason).
	if (opts?.creditOrder !== undefined && gate.gatesOrder(opts.creditOrder)) {
		const credits = gate.creditsToUnlock(opts.creditOrder);
		return {
			readOnly: true,
			// The order's OWN position first, then the way back — never a
			// store-wide sentence on a control attached to one order.
			reason: `${orderGatedLine(credits)}. ${gate.reason}`,
			cause: "credits",
		};
	}
	// `role` is undefined until the payload lands — no lock, so nothing flashes
	// disabled for an owner on first paint.
	if (role === "member" && !canWrite)
		return {
			readOnly: true,
			reason: writeBlockReason(area),
			cause: "permission",
		};
	return { ...store, cause: null };
}

/** The few words a greyed-out primary control carries after its label
 * ("Mark as Packed — waiting on credits"); the sentence is `reason`. */
export function lockLabel(cause: AreaLockCause | null): string {
	return cause === "credits" ? "waiting on credits" : "view-only";
}

/** The ONE sentence a teammate reads when they hold view on an area and reach
 * for a control that changes it. Mirrors the server's `refusalMessage`. */
export function writeBlockReason(area: PermissionArea): string {
	return `Ask the store owner for edit access to change ${AREA_COPY[area].label}.`;
}
