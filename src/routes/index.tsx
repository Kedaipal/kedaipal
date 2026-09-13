import { createFileRoute } from "@tanstack/react-router";
import { PLAN_MONTHLY_PRICES } from "../../convex/lib/plans";
import { Delivery } from "../components/landing/delivery";
import { FAQ_MESSAGES, Faq } from "../components/landing/faq";
import { FinalCta } from "../components/landing/final-cta";
import { Footer } from "../components/landing/footer";
import { Hero } from "../components/landing/hero";
import { Nav } from "../components/landing/nav";
import { PaymentHandshake } from "../components/landing/payment-handshake";
import { PaymentMethods } from "../components/landing/payment-methods";
import { PricingTeaser } from "../components/landing/pricing-teaser";
import { RealSellers } from "../components/landing/real-sellers";
import { VideoDemo } from "../components/landing/video-demo";
import { LandingRegionProvider } from "../hooks/useLandingRegion";
import { useMarketingLanding } from "../hooks/useMarketingLanding";
import { DEMO_DURATION_ISO, DEMO_VIDEO } from "../lib/demo-video";
import { faqJsonLd } from "../lib/landing-faq";

/**
 * "Home sellers" was the pre-Jul-2026 ICP. The feature-grounded cohort is a
 * behaviour, not a venue — multi-outlet stalls, central kitchens and service
 * shops all match it and none of them sell from home. Keep this and the
 * Organization description below on the pattern, never on a venue or vertical.
 */
const SEO_TITLE = "Kedaipal — WhatsApp Order Hub for Malaysian Sellers";
/**
 * Mirrors the hero: the locked 8 Sep 2026 tagline, then the promise. Kept
 * under ~155 chars — Google truncates around 155-160, so the structural
 * differentiator ("no Meta setup") must sit inside the cut. "Free until your
 * first order" is the start-when-you-sell framing (pricing reset, 30 Aug); the
 * page never says "trial" or a number of days again.
 */
const SEO_DESC =
	"Sell on WhatsApp. Never lose an order or a payment. Orders, payments and courier bookings on one screen for Malaysia & Singapore. Free until your first order, no Meta setup.";
const SITE_URL = "https://kedaipal.com";
/**
 * The landing demo. `uploadDate` is the date the clip was cut, NOT "today" —
 * a VideoObject whose date moves on every deploy is exactly the signal Google
 * treats as unreliable. Bump it only when the video is re-recorded, together
 * with the files in `public/video/` (see `docs/landing-video-demo.md`).
 * The duration lives beside the asset table in `src/lib/demo-video.ts`.
 */
const DEMO_UPLOAD_DATE = "2026-09-13";
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const LOGO_URL = `${SITE_URL}/android-chrome-512x512.png`;
/* The landscape cut is the canonical one for crawlers; the portrait cut is a
   viewport-specific rendition of the same edit, not a second video. */
const DEMO_VIDEO_URL = `${SITE_URL}${DEMO_VIDEO.landscape.mp4}`;
const DEMO_POSTER_URL = `${SITE_URL}${DEMO_VIDEO.landscape.poster}`;

/**
 * The offer range is DERIVED from `PLAN_MONTHLY_PRICES`, never typed here —
 * the previous literal ("299") outlived the Scale reprice by weeks because
 * nothing tied it to the constant the teaser renders from.
 */
const OFFER_LOW = String(PLAN_MONTHLY_PRICES.MYR.starter / 100);
const OFFER_HIGH = String(PLAN_MONTHLY_PRICES.MYR.scale / 100);

/**
 * FAQPage entries mirror the visible FAQ by construction: `faqJsonLd` reads
 * the same message functions and `FAQ_PRIMARY_IDS` that `faq.tsx` renders,
 * pinned to English (`landing-faq.test.ts` proves it, verbatim and in order).
 */
const jsonLd = [
	{
		"@context": "https://schema.org",
		"@type": "Organization",
		name: "Kedaipal",
		url: SITE_URL,
		logo: LOGO_URL,
		description:
			"B2B SaaS order hub for sellers in Malaysia and Singapore who take orders, deposits and bookings in WhatsApp — meat suppliers, central kitchens, bakers, service shops and apparel drops. Real storefront, real order pipeline, courier booking from the order, no Meta setup needed.",
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
			lowPrice: OFFER_LOW,
			highPrice: OFFER_HIGH,
			offerCount: "3",
			description: "Free until your first order, no credit card required",
		},
	},
	{
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqJsonLd(FAQ_MESSAGES),
	},
	{
		"@context": "https://schema.org",
		"@type": "VideoObject",
		name: "Kedaipal in 35 seconds — five kinds of sellers, one link, every order",
		description:
			"A 35-second demo: a custom cake, a frozen-food order, a live sale, a booking and an apparel order — each taken through one Kedaipal storefront link instead of a WhatsApp back-and-forth. Captions in English over a music soundtrack.",
		thumbnailUrl: DEMO_POSTER_URL,
		contentUrl: DEMO_VIDEO_URL,
		uploadDate: DEMO_UPLOAD_DATE,
		duration: DEMO_DURATION_ISO,
		/* Captions are burned into the frames (no caption file to declare); the
		   only audio is a music bed, so the language is the captions'. */
		inLanguage: "en",
		isFamilyFriendly: true,
		publisher: {
			"@type": "Organization",
			name: "Kedaipal",
			logo: { "@type": "ImageObject", url: LOGO_URL },
		},
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
				content: "Kedaipal — Sell on WhatsApp. Never lose an order or a payment.",
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

/**
 * Eight sections (landing v2, z8r3fdegej — design approved 12 Sep 2026):
 * the promise, the product moving, the proof, then the three things the
 * target tier is sold on (payment handshake, courier booking, payment rails),
 * then the price, the objections, the close. The problem strip, how-it-works
 * timeline, features bento and money-math block were cut: fourteen sections
 * was too long for a seller who already knows the pain, and the video says
 * "how it works" better than the timeline did.
 */
function Landing() {
	// GA4 funnel entry (z8r3fdd1v0): capture ?src= + fire land_marketing.
	useMarketingLanding();
	return (
		<LandingRegionProvider>
			<main className="min-h-dvh bg-background text-foreground">
				<Nav />
				<Hero />
				<VideoDemo />
				<RealSellers />
				<PaymentHandshake />
				<Delivery />
				<PaymentMethods />
				<PricingTeaser />
				<Faq />
				<FinalCta />
				<Footer />
			</main>
		</LandingRegionProvider>
	);
}
