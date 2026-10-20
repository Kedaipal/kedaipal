import type { Locale } from "../../convex/lib/locale";
import { m } from "../paraglide/messages";
import { buildWaContactLink } from "./contact";

/**
 * The store home's "Ask on WhatsApp" action (z8r3fdvwcy) — a buyer-initiated
 * `wa.me` link to the store's own number, prefilled so the seller's first
 * line says where the buyer is writing from. One author for every surface
 * that offers it (the mobile cover icon, the desktop labelled row): the
 * words, the number and the "should this exist at all" rule can't drift.
 *
 * `null` means "render nothing": a store with no WhatsApp number has nowhere
 * for the chat to go, and an owner who switched the action off in Settings →
 * Store has said so. Share is never affected by either.
 *
 * Buyer-initiated, so it never goes near `wabaProtection` — the seller's
 * number is public on their own store page, and `sendingPaused` is about
 * what Kedaipal sends, not what a buyer types into their own WhatsApp.
 */
export function buildStoreChatLink(
	store: {
		storeName: string;
		/** Stored digits only (`60123456789`), as `getRetailerBySlug` serves it. */
		waPhone?: string;
		/** Absent = on, the same default the server derives from the stamp. */
		storefrontChatEnabled?: boolean;
	},
	locale: Locale,
): string | null {
	if (store.storefrontChatEnabled === false) return null;
	const waPhone = store.waPhone?.trim();
	if (!waPhone) return null;
	return buildWaContactLink(storeChatPrefill(store.storeName, locale), waPhone);
}

/** The prefilled first line, in the STORE's locale — the seller reads it, so
 * it speaks their language, not the buyer's device setting. */
export function storeChatPrefill(storeName: string, locale: Locale): string {
	return m.storefront_chat_prefill({ storeName }, { locale });
}
