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
