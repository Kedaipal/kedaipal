import type { FunctionReference } from "convex/server";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { useActAsRetailerId } from "./useActAs";

/**
 * Fire a setup-checklist progress stamp — and do NOTHING while an admin is
 * acting-as.
 *
 * These mutations (`markLinkShared`, `markPickupSetupSeen`,
 * `markGreetingSetupDone`) take no arguments and resolve the store from the
 * CALLER's identity via `resolveMyRetailer`. Act-as is a client-side session
 * passed per call as an explicit `retailerId`, so a zero-arg mutation cannot
 * see it: fired from an act-as session it stamps the ADMIN'S OWN store, never
 * the seller's. The server cannot defend itself here — an admin sharing their
 * own store's link is legitimate — so the guard has to live on the client.
 *
 * It lives in ONE place because it was previously held by discipline at five
 * call sites, in two different spellings (`actAsRetailerId` vs
 * `retailer?.actingAsAdmin`), and three of the five had missed it — including
 * the dashboard home's Copy-link button, which is the first thing an admin
 * reaches for after building a pre-built store (docs/prebuilt-stores.md). A
 * rule enforced by remembering is a rule that gets forgotten; this makes a new
 * call site correct by default.
 *
 * Awaitable, because one caller (the greeting row) sequences UI state on it.
 * Resolves immediately, having done nothing, when a session is active.
 */
export function useChecklistStamp(
	mutation: FunctionReference<"mutation", "public", Record<string, never>>,
): () => Promise<void> {
	const actAsRetailerId = useActAsRetailerId();
	const stamp = useMutation(mutation);
	return useCallback(async () => {
		if (actAsRetailerId) return;
		await stamp({});
	}, [actAsRetailerId, stamp]);
}
