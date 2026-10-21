import {
	annualQuote,
	BILLING_CURRENCIES,
	type BillingCurrency,
	LISTED_PLANS,
	type ListedPlan,
	PLAN_CREDIT_GRANT,
} from "../../convex/lib/plans";
import { ORG_DESCRIPTION, SOCIAL_LINKS, SUPPORT_EMAIL } from "./site-identity";

/**
 * Pure `/llms.txt` builder (z8r3fdh2yt). The route's server GET handler
 * supplies the English FAQ and returns this as `text/plain`.
 *
 * Format follows the llms.txt convention (llmstxt.org): an H1, a blockquote
 * summary, then H2 sections of prose and link lists — the shape ChatGPT
 * search, Perplexity and Claude already parse. Prices are DERIVED from the
 * billing constants, never typed (`llms-txt.test.ts` pins both currencies,
 * monthly and annual), because an answer engine quotes whatever number it
 * last crawled and a stale one here outlives the reprice.
 *
 * Deliberately NOT here: storefront slugs (sellers own those; the sitemap
 * carries them), founding/legacy prices (not a public offer), and anything
 * in a language other than English (one document per URL, same rule as the
 * FAQ JSON-LD).
 */

const SYMBOL: Record<BillingCurrency, string> = { MYR: "RM", SGD: "S$" };
const TIER_LABEL: Record<ListedPlan, string> = {
	starter: "Starter",
	pro: "Pro",
};

function money(currency: BillingCurrency, minor: number): string {
	return `${SYMBOL[currency]}${minor / 100}`;
}

/** Where each billing currency is the list price — the words after the
 * amount. Keyed by currency so the scan for hardcoded ISO codes stays clean. */
const MARKET: Record<BillingCurrency, string> = {
	MYR: "in Malaysia",
	SGD: "in Singapore",
};

function tierLine(plan: ListedPlan): string {
	const perMarket = BILLING_CURRENCIES.map((c) => {
		const q = annualQuote(plan, false, c);
		return `${money(c, q.monthly)}/month or ${money(c, q.annualTotal)}/year (${q.monthsFree} months free) ${MARKET[c]}`;
	}).join("; ");
	return `- **${TIER_LABEL[plan]}**: ${perMarket}. ${PLAN_CREDIT_GRANT[plan]} orders a month included.`;
}

export function buildLlmsTxt({
	siteUrl,
	faq,
}: {
	siteUrl: string;
	/** The primary landing FAQ, English, in display order. */
	faq: ReadonlyArray<{ q: string; a: string }>;
}): string {
	return [
		"# Kedaipal",
		"",
		`> ${ORG_DESCRIPTION}`,
		"",
		"Kedaipal is a WhatsApp-first order hub, made in Singapore for sellers in Malaysia and Singapore. A seller gets a hosted storefront at kedaipal.com/their-store, shares the link in WhatsApp, and every order arrives as a tracked order — not a chat message — with payment, pickup or delivery date, and courier booking handled from the same screen.",
		"",
		"## Who it is for",
		"",
		"Made-to-order and multi-outlet sellers doing 20 or more orders a week who close and collect payment by hand in WhatsApp and sell both online and at a physical point (a counter, a stall, a pickup window). Cake and pastry pre-orders, frozen food, meat and seafood supply, central kitchens, services with bookings, and apparel drops are typical. Marketplaces, wholesale reseller networks and sellers without a WhatsApp channel are not the fit.",
		"",
		"## What makes it different",
		"",
		"- **No Meta business verification.** Kedaipal runs one Meta-verified WhatsApp Business Account for every seller, so a store is live in minutes — no WABA application, no SSM or ACRA paperwork, no waiting weeks for approval. The seller's store name appears in every message.",
		"- **One order, one record.** Orders, payment confirmation, fulfilment dates, courier booking (Lalamove, Delyva) and customer history live on one screen instead of scrolling chat history.",
		"- **Sellers keep their own money.** Buyer payments go to the seller's own HitPay, bank or QR — Kedaipal never holds order money.",
		"- **Free until the first order.** No credit card to start; a subscription begins when the store sells.",
		"",
		"## Pricing",
		"",
		"Flat monthly subscription, no per-message fees. One credit per order; credits top up a live plan.",
		"",
		...LISTED_PLANS.map(tierLine),
		"- **Enterprise**: priced by contract for high-volume and multi-outlet operators; no list price.",
		"",
		`Current list prices and what each tier includes: ${siteUrl}/pricing. The cost of running orders by hand, as a comparison: ${siteUrl}/cost.`,
		"",
		"## Frequently asked questions",
		"",
		...faq.flatMap(({ q, a }) => [`- ${q}`, `  ${a}`]),
		"",
		"## Pages",
		"",
		`- [Home](${siteUrl}/): what Kedaipal does, with a 35-second demo`,
		`- [Pricing](${siteUrl}/pricing): tiers, credits, annual billing`,
		`- [Cost of the status quo](${siteUrl}/cost): calculator for hours lost to manual WhatsApp ordering`,
		`- [Stores](${siteUrl}/stores): live Kedaipal storefronts buyers can order from`,
		`- [Privacy policy](${siteUrl}/privacy)`,
		`- [Terms of service](${siteUrl}/terms)`,
		`- [Sitemap](${siteUrl}/sitemap.xml): every public storefront and product page`,
		"",
		"## Company",
		"",
		"- Entity: Kedaipal Pte. Ltd., Singapore. Founder: Arif Rahman.",
		`- Support: ${SUPPORT_EMAIL}`,
		...SOCIAL_LINKS.map((l) => `- ${l.label}: ${l.url}`),
		"",
	].join("\n");
}
