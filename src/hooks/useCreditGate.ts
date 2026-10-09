import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import {
	type CreditUnlockRoute,
	creditLockAudience,
	creditLockMessage,
} from "../lib/credits-ui";
import { useDashboardRetailer } from "./useDashboardRetailer";
import { usePermission, useStoreRole } from "./usePermission";

export type CreditGateView = {
	/** Any order in this store is waiting on credits — what the banner, the
	 * meter's badge and the inbox chip read. NOT a store-wide lock: an
	 * individual control asks `gatesOrder` about its own order. */
	anyWaiting: boolean;
	/** The watermark. An order is workable iff its `creditSeq` is at or below
	 * this; the server sends it once per payload so the inbox can answer per
	 * row without a read. */
	fundedThrough: number;
	/** LIVE orders waiting on credits (capped at 99 by the server). */
	ordersWaiting: number;
	/** The one sentence — same text the server's refusal carries. */
	reason: string;
	route: CreditUnlockRoute;
	isMember: boolean;
	/** THIS reader can take the way back — the owner, or a teammate who may
	 * buy packs (Credits write, T2) when a top-up is the way. Surfaces offer
	 * the one button only then; everyone else is told who to ask. */
	canAct: boolean;
	/** Is THIS order waiting on credits? The per-row question every control
	 * and every row asks — one comparison, no read. An order with no
	 * `creditSeq` never spent a credit through the gate and is always
	 * workable (the gate fails open, mirroring the server). */
	gatesOrder: (order: { creditSeq?: number } | null | undefined) => boolean;
	/** How many credits open THIS order — "waiting on 3 credits". 0 when it is
	 * already workable. */
	creditsToUnlock: (order: { creditSeq?: number } | null | undefined) => number;
};

type GateSource =
	| {
			actingAsAdmin?: boolean;
			creditGate?: {
				exempt: boolean;
				fundedThrough: number;
				creditsOwed: number;
				ordersWaiting: number;
				unlockRoute: CreditUnlockRoute;
			};
	  }
	| null
	| undefined;

/**
 * The gate as a given reader sees it — pure, so a component handed the
 * retailer (the billing tab) needs no provider.
 *
 * Admins and act-as are never gated. The SERVER already opens the gate for
 * them (`resolveCreditGate` checks `isAdmin` before anything else, so a
 * white-glove admin receives un-redacted rows), and this mirrors it so the
 * client's disabled states agree with the data it was sent rather than
 * greying out controls that would in fact work.
 */
export function creditGateView(
	retailer: GateSource,
	who: { isMember: boolean; isAdmin: boolean; canBuyCredits: boolean },
): CreditGateView {
	const gate = retailer?.creditGate;
	const route = gate?.unlockRoute ?? "topup";
	const audience = creditLockAudience({
		isMember: who.isMember,
		canBuyCredits: who.canBuyCredits,
		route,
	});
	const bypass =
		retailer?.actingAsAdmin === true || who.isAdmin || gate?.exempt === true;
	// Absent payload (first paint) reads as "nothing is gated": nothing may
	// flash disabled or redacted before the answer lands. `Infinity` is also
	// what the server sends for an exempt store, so one spelling covers both.
	const fundedThrough =
		bypass || gate === undefined
			? Number.POSITIVE_INFINITY
			: gate.fundedThrough;
	const ordersWaiting = bypass ? 0 : (gate?.ordersWaiting ?? 0);
	const gatesOrder = (order: { creditSeq?: number } | null | undefined) =>
		order?.creditSeq !== undefined && order.creditSeq > fundedThrough;
	return {
		anyWaiting: ordersWaiting > 0,
		fundedThrough,
		ordersWaiting,
		reason: creditLockMessage(route, audience, ordersWaiting),
		route,
		isMember: who.isMember,
		canAct: audience !== "member",
		gatesOrder,
		creditsToUnlock: (order) =>
			gatesOrder(order) ? (order?.creditSeq as number) - fundedThrough : 0,
	};
}

/** `creditGateView` for a retailer the caller already holds. */
export function useCreditGateFor(retailer: GateSource): CreditGateView {
	const isMember = useStoreRole() === "member";
	// Credits write lets a teammate buy a pack themselves (T2), so for them a
	// top-up is a way back, not a thing to ask the owner for.
	const canBuyCredits = usePermission("credits").canWrite;
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data === true;
	return creditGateView(retailer, { isMember, isAdmin, canBuyCredits });
}

/**
 * Which of this store's orders are waiting on credits, and what to say about
 * it (Credits T3.1).
 *
 * An order is workable once its own credit is paid for, and stays workable
 * for life. Only orders that arrived while the balance was at or below zero
 * wait, and those are INVISIBLE — the server redacts them, so a row's buyer
 * fields are already empty by the time this hook is consulted. What this adds
 * is the words and the per-row predicate: a control that would be refused must
 * say so before the tap, and a row that is holding back a buyer must say what
 * it is waiting for.
 *
 * Reads the gate state the dashboard payload already carries (every teammate
 * gets it — no balance numbers; a debit sequence number is not a balance) plus
 * the same cached admin check the view-only lock uses.
 */
export function useCreditGate(): CreditGateView {
	return useCreditGateFor(useDashboardRetailer());
}
