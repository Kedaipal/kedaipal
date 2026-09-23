/**
 * The overseas-number note on the DELIVERY step of both buyer checkouts — the
 * storefront cart and the claim link (z8r3fdh274).
 *
 * A buyer's WhatsApp number may now come from any country, but a courier books
 * inside the store's country and only takes a contact number from it
 * (`toDomesticContactPhone`, convex/lib/courierContact.ts). So when a store
 * books couriers and the buyer's number is foreign, dispatch hands the rider
 * the STORE's number instead. That is a real change to what happens at the
 * door, so the buyer is told where they choose delivery — never enforced
 * silently.
 *
 * What it must NOT say: that order updates may not reach them. WhatsApp
 * reaches every country; only the rider's phone call is rerouted.
 *
 * Renders nothing on the local-buyer happy path — an MY buyer at an MY store
 * sees exactly the page they saw before.
 */

import { COUNTRY_LABELS, type Country } from "../../convex/lib/country";

/** The store's country as Malay copy names it. Exhaustive over `Country`, so
 * a new store country is a compile error here, never an English name inside a
 * Malay sentence. */
const COUNTRY_NAME_MS: Record<Country, string> = {
	MY: "Malaysia",
	SG: "Singapura",
};

export function overseasCourierNote(args: {
	/** The store hands delivery orders to a courier (`booksCouriers` on the
	 * public payloads — `storeBooksCouriers`). */
	booksCouriers: boolean;
	deliveryMethod: "delivery" | "self_collect";
	/** Whether a courier in the store's country can phone the buyer's number:
	 * the picked dial country at checkout, `toDomesticContactPhone` on a
	 * claim's known number. */
	localNumber: boolean;
	/** Collection-service store — the rider collects FROM the buyer. */
	collectsFromCustomer: boolean;
	storeCountry: Country;
	storeName: string;
	/** Store locale; anything but `"ms"` reads English, like every other
	 * localized checkout line. */
	locale: string;
}): string | null {
	if (!args.booksCouriers) return null;
	if (args.deliveryMethod !== "delivery") return null;
	if (args.localNumber) return null;

	const { storeName, storeCountry } = args;
	if (args.locale === "ms") {
		return `Nombor WhatsApp anda dari luar ${COUNTRY_NAME_MS[storeCountry]}, jadi penghantar akan menghubungi ${storeName}, bukan anda. Kemas kini pesanan tetap dihantar ke WhatsApp anda.`;
	}
	const country = COUNTRY_LABELS[storeCountry];
	return args.collectsFromCustomer
		? `Your WhatsApp number is from outside ${country}, so the rider collecting from you will contact ${storeName} instead of you. Order updates still come to your WhatsApp.`
		: `Your WhatsApp number is from outside ${country}, so the rider will contact ${storeName} instead of you. Order updates still come to your WhatsApp.`;
}
