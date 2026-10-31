/**
 * "I went to top up" (Arif, 24 Oct — z8r3fdx34j): when the seller opens a
 * courier's site from the top-up sheet, every surface showing that wallet
 * says it is waiting for the top-up to land, until a newer AND HIGHER balance
 * arrives — Lalamove's webhook, or EasyParcel's re-read when the seller comes
 * back.
 *
 * Higher, not just newer: Lalamove's webhook also fires on every deduction,
 * and EasyParcel's re-read lands a fresh reading whether or not anything was
 * paid. Either would otherwise end "waiting" — or announce a top-up — for
 * money that never came in. So the trip out remembers the balance it left
 * at.
 *
 * Remembered per courier for this tab (module state behind
 * `useSyncExternalStore`), so the Home row, the Deliveries row and the
 * dispatch line all agree. Both states are DERIVED from that memory and the
 * wallet's own observation (`awaitingTopUp`, `topUpLanded`), never synced.
 * It lapses after 30 minutes: a seller who never paid shouldn't read
 * "waiting" for the rest of the day.
 */

import { useSyncExternalStore } from "react";
import type { CourierProviderId } from "../../convex/lib/courierProviders";
import { WALLET_PROVIDERS } from "../../convex/lib/courierWallet";
import type { CourierWalletView } from "./courier-wallets";

export const AWAIT_TOP_UP_MS = 30 * 60 * 1000;

/** The trip out: when the seller left, and the balance they left at. */
export type TopUpTrip = { at: number; balanceBefore: number | null };

const trips = new Map<CourierProviderId, TopUpTrip>();
const listeners = new Set<() => void>();

function emit() {
	for (const l of listeners) l();
}

/** The seller just left for this courier's top-up page. */
export function markTopUpStarted(
	provider: CourierProviderId,
	balanceBefore: number | null,
	at: number = Date.now(),
): void {
	trips.set(provider, { at, balanceBefore });
	emit();
}

/** Test seam: forget every pending top-up. */
export function resetTopUpAwaiting(): void {
	trips.clear();
	emit();
}

export function useTopUpTrip(provider: CourierProviderId): TopUpTrip | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => trips.get(provider) ?? null,
		() => null,
	);
}

type Seen = Pick<CourierWalletView, "provider" | "at" | "balanceMinor">;

/** A trip still worth speaking about: one we can hear back on, not lapsed. */
function live(trip: TopUpTrip | null, view: Seen, now: number): boolean {
	return (
		trip !== null &&
		// A refusal-only courier never reports its balance, so there is
		// nothing to wait for (none today — Delyva is askable since 31 Oct).
		WALLET_PROVIDERS[view.provider].model !== "refusal" &&
		now - trip.at <= AWAIT_TOP_UP_MS
	);
}

/** A balance newer than the trip out and higher than where it left. */
function landed(trip: TopUpTrip, view: Seen): boolean {
	return (
		view.at !== null &&
		view.at >= trip.at &&
		view.balanceMinor !== null &&
		(trip.balanceBefore === null || view.balanceMinor > trip.balanceBefore)
	);
}

/** Is this wallet still waiting on a top-up the seller went to make? */
export function awaitingTopUp(
	trip: TopUpTrip | null,
	view: Seen,
	now: number,
): boolean {
	return trip !== null && live(trip, view, now) && !landed(trip, view);
}

/** The other side of waiting — said in the sheet, so a top-up never lands in
 * silence. */
export function topUpLanded(
	trip: TopUpTrip | null,
	view: Seen,
	now: number,
): boolean {
	return trip !== null && live(trip, view, now) && landed(trip, view);
}

/** What a waiting wallet says, per how its courier reports. */
export function topUpWaitingLine(
	view: Pick<CourierWalletView, "provider">,
): string {
	const name = WALLET_PROVIDERS[view.provider].name;
	return WALLET_PROVIDERS[view.provider].model === "pull"
		? `Waiting for your ${name} top-up — we check again when you come back here.`
		: `Waiting for ${name} to report your top-up — this updates by itself.`;
}
