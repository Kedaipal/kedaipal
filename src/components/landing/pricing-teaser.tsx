import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import {
	type BillingCurrency,
	BILLING_CURRENCY_FOR_COUNTRY,
	COMPETITOR_MONTHLY_RANGE,
	isPlanSelectable,
	type Plan,
	PLAN_MONTHLY_PRICES,
	starterPricePerDay,
} from "../../../convex/lib/plans";
import { useLandingRegion } from "../../hooks/useLandingRegion";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { FadeIn } from "./fade-in";
import {
	CenterSnapCarousel,
	centerSnapSlideClass,
	GuaranteeLine,
	RegionToggle,
	Sticker,
} from "./landing-ui";

// Bare symbol prefixes for Kedaipal's OWN subscription price, allowed here per
// `currency-literals.test.ts` (components/landing/ is on the allowlist —
// billing currency, not a seller's storefront currency).
const CURRENCY_SYMBOL: Record<BillingCurrency, string> = { MYR: "RM", SGD: "S$" };

interface TeaserTier {
	id: Plan;
	name: string;
	tagline: string;
	features: string[];
	popular: boolean;
	// Scale is disabled for v1 launch — "Coming soon" pill replaces the CTA. Schema
	// keeps it so re-enabling needs no migration. See docs/manual-subscription.md.
	comingSoon?: boolean;
}

function getTiers(): TeaserTier[] {
	return [
		{
			id: "starter",
			name: "Starter",
			tagline: m.pricing_tier_starter_tagline(),
			features: [
				m.pricing_feat_storefront(),
				m.pricing_feat_pipeline(),
				m.pricing_feat_wa_automation(),
				m.pricing_feat_handshake(),
				m.pricing_feat_1_user(),
			],
			popular: false,
		},
		{
			id: "pro",
			name: "Pro",
			tagline: m.pricing_tier_pro_tagline(),
			// Online payments + Lalamove lead here now that both are shipped — they
			// are the two Pro capabilities a seller can picture immediately, and
			// radius-band fees are the narrower story of the same delivery feature.
			features: [
				m.pricing_feat_everything_starter(),
				m.pricing_feat_online_payments(),
				m.pricing_feat_crm(),
				m.pricing_feat_lalamove(),
				m.pricing_feat_insights(),
				m.pricing_feat_2_users(),
			],
			popular: true,
		},
		{
			id: "scale",
			name: "Scale",
			tagline: m.pricing_tier_scale_tagline(),
			features: [
				m.pricing_feat_everything_pro(),
				m.pricing_feat_courier(),
				m.pricing_feat_broadcast(),
				m.pricing_feat_5_users(),
			],
			popular: false,
			comingSoon: !isPlanSelectable("scale"),
		},
	];
}

export function PricingTeaser() {
	const { isSignedIn } = useAuth();
	const tiers = getTiers();
	const shouldReduceMotion = useReducedMotion();
	const [region, setRegion] = useLandingRegion();
	// `BILLING_CURRENCY_FOR_COUNTRY`, not `COUNTRY_CURRENCY`: the latter maps a
	// country to the full storefront `SupportedCurrency` union, which is wider
	// than the set Kedaipal invoices subscriptions in.
	const currency: BillingCurrency = BILLING_CURRENCY_FOR_COUNTRY[region];
	const symbol = CURRENCY_SYMBOL[currency];

	return (
		<section
			id="pricing"
			aria-labelledby="pricing-heading"
			className="bg-muted/30"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<FadeIn>
					<div className="text-center">
						<Sticker tone="outline" rotate={-1.5}>
							<Sparkles className="size-3" />
							{m.pricing_badge()}
						</Sticker>
						<h2
							id="pricing-heading"
							className="mt-5 text-3xl font-bold md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.pricing_heading()}
						</h2>
						<p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
							{m.pricing_sub()}
						</p>
						<div className="mx-auto mt-5 max-w-xl rounded-2xl border-l-4 border-accent/40 bg-accent/5 px-5 py-3 text-left text-sm text-muted-foreground">
							{m.pricing_anchor({
								competitor: `${symbol} ${COMPETITOR_MONTHLY_RANGE[currency].min / 100}–${COMPETITOR_MONTHLY_RANGE[currency].max / 100}`,
								starter: `${symbol} ${PLAN_MONTHLY_PRICES[currency].starter / 100}`,
								perDay: `${symbol} ${starterPricePerDay(currency)}`,
							})}
						</div>
						<div className="mt-6 flex justify-center">
							<RegionToggle region={region} onChange={setRegion} />
						</div>
					</div>
				</FadeIn>

				<FadeIn delay={0.1}>
					{/* Mobile: Embla carousel CENTERED ON PRO (owner call, 29 Aug) —
					    startIndex 1 parks Pro dead-center with Starter/Scale peeking
					    both sides, drag physics included; md+ deactivates Embla and the
					    grid takes over. pt-4 on the flex container keeps the "Most
					    popular" badge — absolutely positioned above the card edge —
					    inside the overflow clip. */}
					<CenterSnapCarousel
						startIndex={1}
						className="mt-12"
						desktopClass="pt-4 md:grid md:grid-cols-3 md:items-stretch md:gap-4 md:pt-0 lg:gap-0"
					>
						{tiers.map((tier) => (
							/* Slide shell ≠ card: the shell carries the inter-card gap
							   (its px is OUTSIDE the card background); the card fills it.
							   With the card as the slide, the same padding vanished into
							   the card's own surface (owner-caught, 29 Aug). */
							<div
								key={tier.id}
								className={centerSnapSlideClass(cn("flex", tier.popular && "z-10"))}
							>
								<div
									className={cn(
										"relative flex w-full flex-col rounded-3xl p-7",
										tier.popular
											? "bg-primary text-primary-foreground shadow-2xl lg:-my-5 lg:scale-[1.02]"
											: "border border-border bg-card shadow-sm lg:my-0",
										tier.id === "starter" && "lg:rounded-r-none lg:border-r-0",
										tier.id === "scale" && "lg:rounded-l-none lg:border-l-0",
										tier.comingSoon && "opacity-80",
									)}
								>
								{tier.popular && (
									<span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rotate-2 rounded-lg bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-foreground shadow-md">
										{m.pricing_most_popular()}
									</span>
								)}
								{tier.id === "scale" && (
									<span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-muted px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
										{m.pricing_coming_soon()}
									</span>
								)}

								<p
									className={cn(
										"text-sm font-semibold uppercase tracking-wider",
										tier.popular ? "text-accent" : "text-muted-foreground",
									)}
								>
									{tier.name}
								</p>
								<div className="mt-3 flex items-end gap-1">
									{/* The price rolls when the MY/SG toggle flips — the toggle's
									    one visible consequence deserves a visible response. */}
									<span className="overflow-hidden text-4xl font-bold tracking-tight">
										<AnimatePresence mode="popLayout" initial={false}>
											<motion.span
												key={currency}
												initial={
													shouldReduceMotion ? false : { y: 14, opacity: 0 }
												}
												animate={{ y: 0, opacity: 1 }}
												exit={
													shouldReduceMotion
														? undefined
														: { y: -14, opacity: 0 }
												}
												transition={{ duration: 0.22, ease: "easeOut" }}
												className="inline-block"
											>
												{symbol} {PLAN_MONTHLY_PRICES[currency][tier.id] / 100}
											</motion.span>
										</AnimatePresence>
									</span>
									<span
										className={cn(
											"mb-1 text-sm",
											tier.popular
												? "text-primary-foreground/60"
												: "text-muted-foreground",
										)}
									>
										{m.pricing_per_month()}
									</span>
								</div>
								<p
									className={cn(
										"mt-1 text-xs",
										tier.popular
											? "text-primary-foreground/60"
											: "text-muted-foreground",
									)}
								>
									{tier.tagline}
								</p>

								<ul className="mt-6 flex-1 space-y-2.5">
									{tier.features.map((f) => (
										<li key={f} className="flex items-center gap-2 text-sm">
											<Check className="size-4 shrink-0 text-accent" />
											{f}
										</li>
									))}
								</ul>

								<div className="mt-7">
									{tier.comingSoon ? (
										<div className="flex h-11 w-full items-center justify-center rounded-full border border-dashed border-border bg-muted/40 text-sm font-semibold text-muted-foreground">
											{m.pricing_coming_soon()}
										</div>
									) : (
										<Button
											asChild
											size="lg"
											className={cn(
												"h-11 w-full rounded-full",
												!tier.popular &&
													"border-border bg-background text-foreground hover:bg-muted",
											)}
											variant={tier.popular ? "default" : "outline"}
										>
											{isSignedIn ? (
												<Link to="/app">
													{m.nav_go_to_dashboard()}
													<ArrowRight />
												</Link>
											) : (
												<Link to="/sign-up/$" params={{ _splat: "" }}>
													{m.pricing_cta()}
													<ArrowRight />
												</Link>
											)}
										</Button>
									)}
									{/* The guarantee rides the tier a visitor is most likely to
									    pick, directly under its CTA (86eye3p6z §B). */}
									{tier.popular && !tier.comingSoon ? (
										<GuaranteeLine className="mt-2.5 text-[11.5px] leading-relaxed text-primary-foreground/65" />
									) : null}
									</div>
								</div>
							</div>
						))}
					</CenterSnapCarousel>
				</FadeIn>

				<FadeIn delay={0.15}>
					<div className="mt-10 flex flex-col items-center gap-3">
						<Link
							to="/pricing"
							className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
						>
							{m.pricing_full_breakdown()}
						</Link>
						<p className="text-center text-xs text-muted-foreground">
							{m.pricing_no_lockin()}
						</p>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
