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

const SEO_TITLE =
	"Kedaipal — WhatsApp Order Hub for F&B Home Sellers in Malaysia";
const SEO_DESC =
	"Stop losing orders buried in WhatsApp. Kedaipal gives cake makers, frozen food sellers, and kuih suppliers a real storefront and order pipeline — 14-day free trial, no Meta setup needed.";
const SITE_URL = "https://kedaipal.com";
const OG_IMAGE = `${SITE_URL}/android-chrome-512x512.png`;

const jsonLd = [
	{
		"@context": "https://schema.org",
		"@type": "Organization",
		name: "Kedaipal",
		url: SITE_URL,
		logo: OG_IMAGE,
		description:
			"B2B SaaS order hub for F&B home sellers. Stop losing orders buried in WhatsApp — real storefront, real order pipeline, no Meta setup needed.",
	},
	{
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Kedaipal",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		description: SEO_DESC,
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "MYR",
			description: "14-day free trial · From RM 79/mo",
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
					// Keep in sync with messages/en.json → faq_a_1. JSON-LD can't
					// import paraglide at build time (server-side static), so this
					// is a manual mirror — update both when copy changes.
					text: "No — Kedaipal owns one Meta-verified WhatsApp Business Account that handles all outbound messaging. You don't need your own WABA, business verification, or SSM registration. Your store name appears in every message. Live in under 5 minutes.",
				},
			},
			{
				"@type": "Question",
				name: "Do I need a registered company?",
				acceptedAnswer: {
					"@type": "Answer",
					// Mirror of messages/en.json → faq_a_2.
					text: "No. Kedaipal handles all WhatsApp Business API access centrally — you never need to register with Meta. A registered company is not required to use Kedaipal.",
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
				name: "Is Kedaipal WhatsApp-only?",
				acceptedAnswer: {
					"@type": "Answer",
					// Mirror of messages/en.json → faq_a_5.
					text: "No. WhatsApp is where most F&B home sellers start because it's the channel their customers already use every day. Shopee, Lazada, and TikTok Shop connectors are on the roadmap — every channel will unify into one dashboard.",
				},
			},
			{
				"@type": "Question",
				// Mirror of messages/en.json → faq_q_8 / faq_a_8.
				name: "Is there a free trial?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "Yes — every plan starts with 14 days free, no credit card. You'll only be asked to pick a plan and add payment at the end of the trial. Cancel anytime in between and pay nothing.",
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
			<FoundingTen />
			<CostCta />
			<ProblemStrip />
			<HowItWorks />
<SetupStrip />
			<FeatureGrid />
			<PricingTeaser />
			<Faq />
			<FinalCta />
			<Footer />
		</main>
	);
}
