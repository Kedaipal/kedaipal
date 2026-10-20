import type { ReferralInvite } from "../../../convex/referrals";
import { LandingRegionProvider } from "../../hooks/useLandingRegion";
import { useMarketingLanding } from "../../hooks/useMarketingLanding";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { FitCheck } from "./fit-check";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PaymentMethods } from "./payment-methods";
import { PricingTeaser } from "./pricing-teaser";
import { SellerFlow } from "./seller-flow";
import { VideoDemo } from "./video-demo";
import { WaDock } from "./wa-dock";

/**
 * Landing v2 (z8r3fdegej, 12 Sep 2026) trimmed fourteen sections to eight:
 * the promise, the product moving, the proof, the three things the target
 * tier is sold on, the price, the objections, the close. The 19 Oct 2026
 * showcase pass (z8r3fdtpub) folded the Payment Handshake and Delivery
 * sections into ONE seller-flow walkthrough — the order landing, paid,
 * shipped, on the real UI — because the page's ask is a demo and its job is
 * to show the product moving, not to describe it. See docs/landing-v2.md.
 *
 * One component, two routes: `/` and a referral link's `/referral/<slug>`
 * (z8r3fdetf5), which is this same page with the referrer's invite at the top
 * of the hero — so a referred seller reads the real pitch, not a thinner
 * page of its own.
 *
 * `attributionSearch` overrides the URL's query for the GA4 capture — the
 * referral route has no `?src=` in its URL, so it hands over the
 * `src=referral-<slug>&store=<slug>` its link stands for.
 */
export function LandingPage({
	invite,
	attributionSearch,
}: {
	invite: ReferralInvite | null | undefined;
	attributionSearch?: string;
}) {
	// GA4 funnel entry (z8r3fdd1v0): capture ?src= + fire land_marketing.
	useMarketingLanding(attributionSearch);
	return (
		<LandingRegionProvider>
			<main className="min-h-dvh bg-background text-foreground">
				<Nav />
				<Hero invite={invite} />
				<VideoDemo />
				<SellerFlow />
				<PaymentMethods />
				<FitCheck />
				<PricingTeaser />
				<Faq />
				<FinalCta />
				<Footer />
				<WaDock />
			</main>
		</LandingRegionProvider>
	);
}
