import { createFileRoute } from "@tanstack/react-router";
import { Faq } from "../components/landing/faq";
import { FeatureGrid } from "../components/landing/feature-grid";
import { FinalCta } from "../components/landing/final-cta";
import { Footer } from "../components/landing/footer";
import { FoundingTen } from "../components/landing/founding-ten";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { MoneyMath } from "../components/landing/money-math";
import { Nav } from "../components/landing/nav";
import { PaymentHandshake } from "../components/landing/payment-handshake";
import { PaymentMethods } from "../components/landing/payment-methods";
import { PricingTeaser } from "../components/landing/pricing-teaser";
import { ProblemStrip } from "../components/landing/problem-strip";
import { RealSellers } from "../components/landing/real-sellers";

const SEO_TITLE = "Kedaipal — WhatsApp Order Hub for Home Sellers in Malaysia";
const SEO_DESC =
	"Stop losing orders. Stop chasing payments. Every order and payment on one dashboard, through the WhatsApp your customers already use. 14-day free trial, no Meta setup.";
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
					text: "No — Kedaipal runs one Meta-verified WhatsApp Business Account for all sellers. No Meta business verification, no waiting weeks for approval. Your store name appears in every message, and you're live in under 5 minutes.",
				},
			},
			{
				"@type": "Question",
				name: "How are payments handled?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "Two ways. Connect your own HitPay account and buyers tap Pay now — DuitNow QR, FPX, cards, e-wallets — with the money settling straight to you and the order marking itself paid. Or take bank transfer / cash: Kedaipal sends your payment details, tracks the “I've paid” handshake, and issues the receipt. Kedaipal never touches your order money.",
				},
			},
			{
				"@type": "Question",
				name: "I sell at a stall too — does that work?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "Yes — that's exactly who we built for. Counter checkout gives your stall one QR: walk-ins scan, order and pair to WhatsApp on the spot. Counter and chat orders share one inbox, one stock count, and one customer list.",
				},
			},
			{
				"@type": "Question",
				name: "I sell custom-made orders — can buyers approve a design first?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "Yes. Mark a product as needing mockup approval and its orders can't enter production until the buyer signs off on their tracking page. Payment is only asked for after approval — and if a buyer goes quiet, you can waive the gate after 48 hours.",
				},
			},
			{
				"@type": "Question",
				name: "Who owns my shop data?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "You do. Every product, order and customer record is yours — CSV export is on the dashboard today. Cancel anytime and take everything with you.",
				},
			},
			{
				"@type": "Question",
				name: "Who's behind Kedaipal?",
				acceptedAnswer: {
					"@type": "Answer",
					text: "A solo founder (Arif Rahman) building with the sellers who pay for it — real businesses transact through Kedaipal daily and shape the roadmap every week. Not a big team, but you'll always reach a person.",
				},
			},
		],
	},
];

export const Route = createFileRoute("/")({
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
			<RealSellers />
			<ProblemStrip />
			<PaymentHandshake />
			<HowItWorks />
			<FeatureGrid />
			<FoundingTen />
			{/* Cost context, then the rails, then the price — a visitor must know
			    what a marketplace already takes and how their customers will
			    actually pay BEFORE they meet RM79/149/299 (ClickUp 86eye3p6z). */}
			<MoneyMath />
			<PaymentMethods />
			<PricingTeaser />
			<Faq />
			<FinalCta />
			<Footer />
		</main>
	);
}
