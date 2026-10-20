/**
 * The one way into Enterprise (Credits T6): a WhatsApp chat with Arif, the
 * message prefilled so the first line already says what it's about. Every
 * surface that offers Enterprise — /pricing, the landing teaser, the in-app
 * plan picker, the billing page of a store on a contract — builds its link
 * here, so the words and the number can never drift apart.
 */
import { ENTERPRISE_FROM_ORDERS } from "../../convex/lib/plans";
import { m } from "../paraglide/messages";
import { buildWaContactLink } from "./contact";

/** "1,500" — where Enterprise begins, as every surface prints it. */
export function enterpriseFromOrdersLabel(): string {
	return ENTERPRISE_FROM_ORDERS.toLocaleString("en");
}

/** A visitor or seller asking about Enterprise. `store` names the store when
 * a signed-in seller asks, so Arif knows who's writing. */
export function enterpriseTalkUrl(
	supportWa: string,
	store?: { slug: string },
): string {
	const message = m.pricing_enterprise_wa({
		orders: enterpriseFromOrdersLabel(),
	});
	return buildWaContactLink(
		store ? `${message} (kedaipal.com/${store.slug})` : message,
		supportWa,
	);
}
