import { createFileRoute } from "@tanstack/react-router";
import { PLAN_MONTHLY_PRICES } from "../../convex/lib/plans";
import { FAQ_MESSAGES } from "../components/landing/faq";
import { LandingPage } from "../components/landing/landing-page";
import { useReferralInvite } from "../hooks/useReferralInvite";
import { DEMO_DURATION_ISO, DEMO_VIDEO } from "../lib/demo-video";
import { jsonLdScript } from "../lib/json-ld";
import { faqJsonLd } from "../lib/landing-faq";
import { SEO_DESC, SEO_TITLE } from "../lib/landing-seo";

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
 * a typed literal once outlived a reprice by weeks because nothing tied it to
 * the constant the teaser renders from. The listed tiers only: Enterprise has
 * no public price (T6), so it can't bound a published offer range — and so
 * it can't be counted in it either: `offerCount` is the number of listed
 * tiers, read from the same constant.
 */
const OFFER_LOW = String(PLAN_MONTHLY_PRICES.MYR.starter / 100);
const OFFER_HIGH = String(PLAN_MONTHLY_PRICES.MYR.pro / 100);
const OFFER_COUNT = String(Object.keys(PLAN_MONTHLY_PRICES.MYR).length);

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
			offerCount: OFFER_COUNT,
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
				content:
					"Kedaipal — Sell on WhatsApp. Never lose an order or a payment.",
			},
			{ property: "og:locale", content: "en_MY" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: SITE_URL }],
		scripts: [jsonLdScript(jsonLd)],
	}),
	component: Landing,
});

/**
 * The landing page. A visitor holding a referral (z8r3fdetf5 — they opened a
 * `/referral/<slug>` link in the last 30 days) sees the referrer's invite at
 * the top of the hero; everyone else sees the page unchanged.
 */
function Landing() {
	const invite = useReferralInvite();
	return <LandingPage invite={invite} />;
}
