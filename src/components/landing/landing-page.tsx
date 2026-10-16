import type { ReferralInvite } from "../../../convex/referrals";
import { LandingRegionProvider } from "../../hooks/useLandingRegion";
import { useMarketingLanding } from "../../hooks/useMarketingLanding";
import { Delivery } from "./delivery";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PaymentHandshake } from "./payment-handshake";
import { PaymentMethods } from "./payment-methods";
import { PricingTeaser } from "./pricing-teaser";
import { RealSellers } from "./real-sellers";
import { VideoDemo } from "./video-demo";

/**
 * Eight sections (landing v2, z8r3fdegej — design approved 12 Sep 2026):
 * the promise, the product moving, the proof, then the three things the
 * target tier is sold on (payment handshake, courier booking, payment rails),
 * then the price, the objections, the close. The problem strip, how-it-works
 * timeline, features bento and money-math block were cut: fourteen sections
 * was too long for a seller who already knows the pain, and the video says
 * "how it works" better than the timeline did.
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
