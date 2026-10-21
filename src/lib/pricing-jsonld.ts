import {
	annualQuote,
	type BillingCurrency,
	LISTED_PLANS,
	type ListedPlan,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
} from "../../convex/lib/plans";
import { ORG_DESCRIPTION } from "./site-identity";

/**
 * `/pricing` structured data (z8r3fdh2z3): one `SoftwareApplication` carrying
 * a named `Offer` per listed tier and billing cycle, so "how much does
 * Kedaipal cost" resolves to the real numbers rather than the landing's
 * AggregateOffer range.
 *
 * Prices are DERIVED from the billing constants — the same rule as the
 * landing's AggregateOffer and `llms.txt` — and the currency is whatever the
 * visitor's resolved region paints on the cards, because Google compares the
 * schema price against the visible one and flags a mismatch.
 *
 * Not here on purpose: Enterprise (no list price — a contract is not a
 * public offer) and founding prices (retired for new signups, never public).
 */

const TIER_LABEL: Record<ListedPlan, string> = {
	starter: "Starter",
	pro: "Pro",
};

function major(minor: number): string {
	return String(minor / 100);
}

export function pricingJsonLd({
	siteUrl,
	currency,
}: {
	siteUrl: string;
	currency: BillingCurrency;
}) {
	const pageUrl = `${siteUrl}/pricing`;
	const offers = LISTED_PLANS.flatMap((plan) => {
		const quote = annualQuote(plan, false, currency);
		const name = TIER_LABEL[plan];
		const credits = `${PLAN_CREDIT_GRANT[plan]} orders a month included`;
		return [
			{
				"@type": "Offer",
				name: `${name} — monthly`,
				description: credits,
				price: major(PLAN_MONTHLY_PRICES[currency][plan]),
				priceCurrency: currency,
				url: pageUrl,
				priceSpecification: {
					"@type": "UnitPriceSpecification",
					price: major(PLAN_MONTHLY_PRICES[currency][plan]),
					priceCurrency: currency,
					billingDuration: 1,
					unitCode: "MON",
				},
			},
			{
				"@type": "Offer",
				name: `${name} — annual (${quote.monthsFree} months free)`,
				description: credits,
				price: major(quote.annualTotal),
				priceCurrency: currency,
				url: pageUrl,
				priceSpecification: {
					"@type": "UnitPriceSpecification",
					price: major(quote.annualTotal),
					priceCurrency: currency,
					billingDuration: 12,
					unitCode: "MON",
				},
			},
		];
	});
	return {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Kedaipal",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		url: pageUrl,
		description: ORG_DESCRIPTION,
		offers,
	};
}
