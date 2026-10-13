import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
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
 * Returns `active` ALONGSIDE the stamp, and that pairing is the point.
 *
 * A stamp that resolves having silently done nothing is fine for a
 * fire-and-forget caller and a trap for an awaiting one: the greeting row sets
 * `saving` and deliberately never clears it on success, because it expects the
 * row to unmount when the seller's flag flips. Inert, that flip never comes and
 * the button sits on "Saving…" for ever — the exact failure this PR had already
 * diagnosed and fixed once, in the consent banner, and then reintroduced here
 * by making the no-op invisible (PR review, 2 Oct).
 *
 * So callers are handed the fact rather than having to infer it: `active` is
 * false while an admin is acting-as, and a surface whose control cannot work
 * can disable it with a reason instead of offering a button that does nothing.
 */
export function useChecklistStamp(
	mutation: FunctionReference<"mutation", "public", Record<string, never>>,
): {
	/** Fire the stamp. Resolves immediately, having done nothing, when inert. */
	stamp: () => Promise<void>;
	/** False while an admin is acting-as: the stamp would record nothing. */
	active: boolean;
} {
	const actAsRetailerId = useActAsRetailerId();
	const mutate = useMutation(mutation);
	const active = actAsRetailerId === undefined;
	const stamp = useCallback(async () => {
		if (!active) return;
		await mutate({});
	}, [active, mutate]);
	return { stamp, active };
}
