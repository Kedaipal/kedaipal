import {
	COUNTRY_CURRENCY,
	COUNTRY_LABELS,
	type Country,
} from "../../convex/lib/country";
import type {
	CountrySetupItem,
	CountrySetupItemKey,
} from "../../convex/lib/countrySetup";

/**
 * Seller-facing copy for the post-switch setup checklist (86eyqgujv).
 *
 * The rule, from the ticket: **name the consequence, not the task.** Not
 * "Update payment methods" — a seller reads that as admin and skips it — but
 * "Singapore buyers can't transfer SGD into a Malaysian account, so their
 * payment will fail." The whole point of the checklist is that Zaki's worry
 * ("might cause them quite abit of problem if they use the wrong keys or
 * checkout address and buyer already made an order") is stated in the seller's
 * terms, not ours.
 *
 * Copy lives on the client and the facts live on the server — the
 * `dispatch-block.ts` split. A `Record` keyed by the union so a new checklist
 * item is a compile error here rather than a silently unlabelled row.
 */

/** Which settings tab fixes this row. */
export type CountrySetupTab = "store" | "whatsapp" | "payments" | "fulfilment";

type CountrySetupCopy = {
	title: string;
	/** What goes wrong if it stays as it is, in the seller's terms. */
	body: string;
	tab: CountrySetupTab;
	action: string;
};

type CopyContext = {
	/** Where the store is now. */
	to: Country;
	/** Where it was, when we know — the copy degrades to "another country". */
	from: Country | undefined;
	count: number;
};

const COPY: Record<
	CountrySetupItemKey,
	(ctx: CopyContext) => CountrySetupCopy
> = {
	payment_methods: ({ to, from }) => ({
		title: "Check your bank account and QR codes",
		body: `Your payment details are the ones you used in ${placeName(from)}. A buyer in ${COUNTRY_LABELS[to]} can't transfer ${COUNTRY_CURRENCY[to]} into them — the payment fails and you'll be chasing it.`,
		tab: "payments",
		action: "Open Payments",
	}),
	hitpay: ({ to, from }) => ({
		title: "Check your HitPay account",
		body: `Your HitPay keys were connected while the store was in ${placeName(from)}. A HitPay account settles one country's currency, so ${COUNTRY_CURRENCY[to]} payments will be declined at checkout.`,
		tab: "payments",
		action: "Open Payments",
	}),
	business_address: ({ to, from }) => ({
		title: "Set your business address",
		body: `Your business address is still in ${placeName(from)}. It's the return address on every parcel label — we're leaving it off labels rather than sending undelivered parcels to the wrong country, so replace it with a ${COUNTRY_LABELS[to]} address.`,
		tab: "fulfilment",
		action: "Open Fulfilment",
	}),
	pickup_addresses: ({ to, from, count }) => ({
		title:
			count === 1
				? "A pickup point is in the wrong country"
				: `${count} pickup points are in the wrong country`,
		body: `${count === 1 ? "One pickup point still shows" : `${count} pickup points still show`} ${placeAdjective(from)} address. Buyers pick ${count === 1 ? "it" : "them"} at checkout and will travel there — update ${count === 1 ? "it" : "them"} to a ${COUNTRY_LABELS[to]} address or turn ${count === 1 ? "it" : "them"} off.`,
		tab: "fulfilment",
		action: "Open Fulfilment",
	}),
	delivery_mode: ({ to }) => ({
		title: "Set a delivery charge that works here",
		body: `Your delivery charge uses distance, weight-zone or Lalamove pricing, which only work in Malaysia for now. Nothing is lost — it's still saved if you switch back — but buyers in ${COUNTRY_LABELS[to]} can't be quoted, so every delivery order waits for you to price it by hand.`,
		tab: "fulfilment",
		action: "Open Fulfilment",
	}),
	pickup_contacts: ({ to, from, count }) => ({
		title:
			count === 1
				? "A pickup point's contact number is foreign"
				: `${count} pickup contact numbers are foreign`,
		body: `${count === 1 ? "One pickup point has" : `${count} pickup points have`} ${placeAdjective(from)} manager number. ${count === 1 ? "It" : "They"} still work — we kept ${count === 1 ? "it" : "them"} rather than deleting ${count === 1 ? "it" : "them"} — ${count === 1 ? "it's" : "they're"} just not ${COUNTRY_LABELS[to]} ${count === 1 ? "number" : "numbers"}.`,
		tab: "fulfilment",
		action: "Open Fulfilment",
	}),
	delivery_booking: ({ to }) => ({
		title: "Lalamove booking is still switched on",
		body: `We can't book riders in ${COUNTRY_LABELS[to]} yet, so the dispatch card is hidden on your orders and nothing can be spent by accident. Your API keys are kept if you switch back.`,
		tab: "fulfilment",
		action: "Open Fulfilment",
	}),
	wa_phone: ({ to, from }) => ({
		title: "Your store's WhatsApp number is foreign",
		body: `Buyers see ${placeAdjective(from)} number as your store contact. It still receives messages — replace it with a ${COUNTRY_LABELS[to]} number when you have one.`,
		tab: "whatsapp",
		action: "Open WhatsApp",
	}),
	notify_wa_phone: ({ from }) => ({
		title: "Your order-alerts number is foreign",
		body: `Order alerts go to ${placeAdjective(from)} number. They still arrive — this one is only about the number matching your store.`,
		tab: "store",
		action: "Open Store",
	}),
	message_copy: ({ from }) => ({
		title: "Check your own message wording",
		body: `Your WhatsApp templates and payment instructions are your own words, so we can't check them for you — make sure they don't still quote ${COUNTRY_CURRENCY[from ?? "MY"]} or ${placeAdjective(from)} bank.`,
		tab: "whatsapp",
		action: "Open WhatsApp",
	}),
};

/** "Malaysia" / "another country" — the copy never invents a previous country
 * it wasn't told, since `countryChangedFrom` is optional on older rows. */
function placeName(from: Country | undefined): string {
	return from ? COUNTRY_LABELS[from] : "another country";
}

/** "a Malaysian" / "a foreign" — the adjective form, same degradation. */
function placeAdjective(from: Country | undefined): string {
	if (from === "MY") return "a Malaysian";
	if (from === "SG") return "a Singaporean";
	return "a foreign";
}

export function countrySetupCopy(
	item: CountrySetupItem,
	to: Country,
	from: Country | undefined,
): CountrySetupCopy {
	return COPY[item.key]({ to, from, count: item.count ?? 1 });
}

/** Headline for the whole panel — one line that says what happened and how
 * much is left, so a seller can judge it without opening anything. */
export function countrySetupHeadline(
	items: readonly CountrySetupItem[],
	to: Country,
	from: Country | undefined,
): string {
	const move = from
		? `You moved this store from ${COUNTRY_LABELS[from]} to ${COUNTRY_LABELS[to]}`
		: `You moved this store to ${COUNTRY_LABELS[to]}`;
	return items.length === 1
		? `${move} — one thing still needs your attention.`
		: `${move} — ${items.length} things still need your attention.`;
}

/**
 * Deep-link anchors — the id of the card that actually fixes each checklist
 * row (86eyqgujv). Landing a seller at the top of a long settings tab and
 * letting them hunt is the difference between a checklist they act on and one
 * they close.
 *
 * Two pairs share a card on purpose: a pickup point's address and its manager
 * number are edited in the same place, as are the delivery-charge mode and the
 * Lalamove booking that rides it.
 */
export const SETTINGS_ANCHOR: Record<CountrySetupItemKey, string> = {
	payment_methods: "settings-payment-methods",
	hitpay: "settings-hitpay",
	business_address: "settings-business-address",
	pickup_addresses: "settings-pickup",
	delivery_mode: "settings-delivery-charge",
	pickup_contacts: "settings-pickup",
	delivery_booking: "settings-delivery-charge",
	wa_phone: "settings-wa-phone",
	notify_wa_phone: "settings-wa-alerts",
	message_copy: "settings-message-templates",
};

/**
 * How hard to shout at the card we just scrolled to.
 *
 * The distinction is the same one the checklist itself is built on, and it
 * matters here more than anywhere: a red error ring is a claim that something
 * IS wrong. We can say that about an address stamped in the wrong country. We
 * cannot say it about a bank account — nothing in the row tells us whether it
 * is Malaysian, so ringing it red would be asserting something we don't know.
 * Those get amber: "check this", not "this is broken".
 */
export type FixHighlight = "error" | "check";

export function highlightFor(verifiable: boolean): FixHighlight {
	return verifiable ? "error" : "check";
}

/** Ring classes for a highlighted card. Also supplies the default border, so
 * `Card` can hand its whole border treatment to this one author. */
export function highlightRingClass(
	highlight: FixHighlight | undefined,
): string {
	if (highlight === "error") {
		return "border-destructive ring-2 ring-destructive/25";
	}
	if (highlight === "check") {
		return "border-amber-400 ring-2 ring-amber-400/25 dark:border-amber-500";
	}
	return "border-input";
}

/**
 * Scroll a settings card into view. Honours `prefers-reduced-motion` — a long
 * smooth scroll is exactly the motion that makes some people ill, and the
 * destination matters more than the journey.
 *
 * Returns false when the anchor isn't on the page, so a caller can decide
 * whether that's worth saying out loud.
 */
export function scrollToAnchor(anchorId: string): boolean {
	if (typeof document === "undefined") return false;
	const el = document.getElementById(anchorId);
	if (!el) return false;
	const reduced =
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	el.scrollIntoView({
		behavior: reduced ? "auto" : "smooth",
		block: "start",
	});
	return true;
}
