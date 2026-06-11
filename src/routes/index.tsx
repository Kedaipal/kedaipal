import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CostCta } from "../components/landing/cost-cta";
import { Faq } from "../components/landing/faq";
import { FeatureGrid } from "../components/landing/feature-grid";
import { FinalCta } from "../components/landing/final-cta";
import { Footer } from "../components/landing/footer";
import { FoundingTen } from "../components/landing/founding-ten";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Nav } from "../components/landing/nav";
import { PricingTeaser } from "../components/landing/pricing-teaser";
import { ProblemStrip } from "../components/landing/problem-strip";
import { SetupStrip } from "../components/landing/setup-strip";

const SEO_TITLE = "Kedaipal — WhatsApp Order Hub for Home Sellers in Malaysia";
const SEO_DESC =
	"Stop losing orders buried in WhatsApp. Kedaipal turns your product catalog into a real storefront and order pipeline — 14-day free trial, no Meta setup needed.";
const SITE_URL = "https://kedaipal.com";
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const LOGO_URL = `${SITE_URL}/android-chrome-512x512.png`;

/**
 * FAQPage entries MUST mirror the visible FAQ copy (messages/en.json,
 * primary items) — Google ignores or penalises FAQ structured data that
 * doesn't match on-page content. Update both together.
 */
const jsonLd = [
	{
		"@context": "https://schema.org",
		"@type": "Organization",
		name: "Kedaipal",
		url: SITE_URL,
		logo: LOGO_URL,
		description:
			"B2B SaaS order hub for home sellers. Stop losing orders buried in WhatsApp — real storefront, real order pipeline, no Meta setup needed.",
	},
	{
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Kedaipal",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		url: SITE_URL,
		image: OG_IMAGE,
		description: SEO_DESC,
		offers: {
			"@type": "AggregateOffer",
			priceCurrency: "MYR",
			lowPrice: "79",
			highPrice: "299",
			offerCount: "3",
			description: "14-day free trial, no credit card required",
		},
	},
	{
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: [
			{
				"@type": "Question",
				name: "Do I need my own WhatsApp Business number?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "No — Kedaipal owns one Meta-verified WhatsApp Business Account that handles all outbound messaging. You don't need your own WABA, business verification, or SSM registration. Your store name appears in every message. Live in under 5 minutes.",
				},
			},
			{
				"@type": "Question",
				name: "Will this work for me even if business is slow right now?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "When orders are slower, each missed follow-up costs more — not less. One recovered conversation this week could cover a month of subscription. Kedaipal makes sure none slip.",
				},
			},
			{
				"@type": "Question",
				name: "How are payments handled?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "For MVP, Kedaipal supports offline payment methods: cash on delivery, bank transfer, and e-wallet screenshots. Online payment integration is on the roadmap.",
				},
			},
			{
				"@type": "Question",
				name: "Who owns my shop data?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "You do. Every product, order, and customer record is yours. Export tools are available — CSV export is on the dashboard today.",
				},
			},
			{
				"@type": "Question",
				name: "Will pricing stay free forever?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "No — Kedaipal runs on paid tiers starting at RM 79/mo after your 14-day free trial. Founding 10 members lock in Pro at RM 104/mo forever.",
				},
			},
		],
	},
];

const searchSchema = z.object({
	step: z.coerce.number().int().min(1).max(4).optional(),
});

export const Route = createFileRoute("/")({
	validateSearch: searchSchema,
	head: () => ({
		meta: [
			{ title: SEO_TITLE },
			{ name: "description", content: SEO_DESC },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: SITE_URL },
			{ property: "og:title", content: SEO_TITLE },
			{ property: "og:description", content: SEO_DESC },
			{ property: "og:image", content: OG_IMAGE },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{
				property: "og:image:alt",
				content: "Kedaipal — Stop losing orders buried in WhatsApp chat.",
			},
			{ property: "og:locale", content: "en_MY" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: SITE_URL }],
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify(jsonLd),
			},
		],
	}),
	component: Landing,
});

function Landing() {
	return (
		<main className="min-h-dvh bg-background text-foreground">
			<Nav />
			<Hero />
			<ProblemStrip />
			<CostCta />
			<HowItWorks />
			<SetupStrip />
			<FeatureGrid />
			<FoundingTen />
			<PricingTeaser />
			<Faq />
			<FinalCta />
			<Footer />
		</main>
	);
}
