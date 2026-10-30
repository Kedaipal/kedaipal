/**
 * "I went to top up" (Arif, 24 Oct — z8r3fdx34j): when the seller opens a
 * courier's site from the top-up sheet, every surface showing that wallet
 * says it is waiting for the top-up to land, until a NEWER balance arrives —
 * Lalamove's webhook, or EasyParcel's re-read when the seller comes back.
 *
 * Remembered per courier for this tab (module state behind
 * `useSyncExternalStore`), so the Home row, the Deliveries row and the
 * dispatch line all agree. "Waiting" is DERIVED from the start time and the
 * wallet's own observation time (`awaitingTopUp`), never synced, so a landed
 * top-up ends it by itself. It lapses after 30 minutes: a seller who never
 * paid shouldn't read "waiting" for the rest of the day.
 */

import { useSyncExternalStore } from "react";
import type { CourierProviderId } from "../../convex/lib/courierProviders";
import { WALLET_PROVIDERS } from "../../convex/lib/courierWallet";
import type { CourierWalletView } from "./courier-wallets";

export const AWAIT_TOP_UP_MS = 30 * 60 * 1000;

const started = new Map<CourierProviderId, number>();
const listeners = new Set<() => void>();

function emit() {
	for (const l of listeners) l();
}

/** The seller just left for this courier's top-up page. */
export function markTopUpStarted(
	provider: CourierProviderId,
	at: number = Date.now(),
): void {
	started.set(provider, at);
	emit();
}

/** Test seam: forget every pending top-up. */
export function resetTopUpAwaiting(): void {
	started.clear();
	emit();
}

export function useTopUpStartedAt(provider: CourierProviderId): number | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => started.get(provider) ?? null,
		() => null,
	);
}

/**
 * Is this wallet still waiting on a top-up the seller went to make? Only a
 * courier that tells us its balance can be waited on — Delyva never does, so
 * its sheet says so instead of promising an update.
 */
export function awaitingTopUp(
	startedAt: number | null,
	view: Pick<CourierWalletView, "provider" | "at">,
	now: number,
): boolean {
	if (startedAt === null) return false;
	if (WALLET_PROVIDERS[view.provider].model === "refusal") return false;
	if (now - startedAt > AWAIT_TOP_UP_MS) return false;
	return view.at === null || view.at < startedAt;
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
