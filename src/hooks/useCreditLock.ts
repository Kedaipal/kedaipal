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

export type CreditLockView = {
	locked: boolean;
	/** The one sentence — same text the server's refusal carries. */
	reason: string;
	route: CreditUnlockRoute;
	ordersWaiting: number;
	since: number | null;
	isMember: boolean;
	/** THIS reader can take the way back — the owner, or a teammate who may
	 * buy packs (Credits write, T2) when a top-up is the way. Surfaces offer
	 * the one button only then; everyone else is told who to ask. */
	canAct: boolean;
};

type LockSource =
	| {
			actingAsAdmin?: boolean;
			creditLock?: {
				locked: boolean;
				unlockRoute: CreditUnlockRoute;
				since: number | null;
				ordersWaiting: number;
			};
	  }
	| null
	| undefined;

/** The lock as a given reader sees it — pure, so a component handed the
 * retailer (the billing tab) needs no provider. Admins and act-as are never
 * locked, mirroring the server. */
export function creditLockView(
	retailer: LockSource,
	who: { isMember: boolean; isAdmin: boolean; canBuyCredits: boolean },
): CreditLockView {
	const lock = retailer?.creditLock;
	const route = lock?.unlockRoute ?? "topup";
	const audience = creditLockAudience({
		isMember: who.isMember,
		canBuyCredits: who.canBuyCredits,
		route,
	});
	return {
		locked:
			lock?.locked === true && retailer?.actingAsAdmin !== true && !who.isAdmin,
		reason: creditLockMessage(route, audience),
		route,
		ordersWaiting: lock?.ordersWaiting ?? 0,
		since: lock?.since ?? null,
		isMember: who.isMember,
		canAct: audience !== "member",
	};
}

/** `creditLockView` for a retailer the caller already holds. */
export function useCreditLockFor(retailer: LockSource): CreditLockView {
	const isMember = useStoreRole() === "member";
	// Credits write lets a teammate buy a pack themselves (T2), so for them a
	// top-up is a way back, not a thing to ask the owner for.
	const canBuyCredits = usePermission("credits").canWrite;
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data === true;
	return creditLockView(retailer, { isMember, isAdmin, canBuyCredits });
}

/**
 * Is the store out of credits right now, and why (Credits T3)? At zero the
 * SELLER can't accept or update orders or edit products; cancelling, refunding
 * and every read stay open, and orders keep arriving. Controls that would be
 * refused must say so before the tap, so the ones the lock covers read this.
 *
 * Reads the lock state the dashboard payload already carries (every teammate
 * gets it — no balance numbers) plus the same cached admin check the view-only
 * lock uses.
 */
export function useCreditLock(): CreditLockView {
	return useCreditLockFor(useDashboardRetailer());
}
