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
import { SlowYesStrip } from "../components/landing/slow-yes-strip";

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
			description: "Free during beta",
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
					text: "During the beta, you can share a test number we provide. When you're ready for production, you'll connect your own WhatsApp Business number through the Meta Cloud API.",
				},
			},
			{
				"@type": "Question",
				name: "Do I need a registered company?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "Not for the beta. For production WhatsApp Business API access, Meta eventually requires business verification, but we'll walk you through that when the time comes.",
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
					text: "No. WhatsApp is where most beta users start because it's the channel their customers already use every day. Shopee, Lazada, and TikTok Shop connectors are actively rolling out during beta.",
				},
			},
			{
				"@type": "Question",
				name: "Will pricing stay free forever?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "No — Kedaipal will move to paid tiers after beta. Beta users get locked-in founder pricing as a thank-you.",
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
			<SlowYesStrip />
			<SetupStrip />
			<FeatureGrid />
			<PricingTeaser />
			<Faq />
			<FinalCta />
			<Footer />
		</main>
	);
}
