import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Sparkles, Star } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { FadeIn } from "./fade-in";
import { Sticker } from "./landing-ui";

interface TeaserTier {
	id: string;
	name: string;
	price: number;
	foundingPrice?: number;
	tagline: string;
	features: string[];
	popular: boolean;
}

function getTiers(): TeaserTier[] {
	return [
		{
			id: "starter",
			name: "Starter",
			price: 79,
			tagline: m.pricing_tier_starter_tagline(),
			features: [
				m.pricing_feat_storefront(),
				m.pricing_feat_pipeline(),
				m.pricing_feat_wa_automation(),
				m.pricing_feat_1_user(),
			],
			popular: false,
		},
		{
			id: "pro",
			name: "Pro",
			price: 149,
			foundingPrice: 104,
			tagline: m.pricing_tier_pro_tagline(),
			features: [
				m.pricing_feat_everything_starter(),
				m.pricing_feat_crm(),
				m.pricing_feat_inbox(),
				m.pricing_feat_reminders(),
				m.pricing_feat_2_users(),
			],
			popular: true,
		},
		{
			id: "scale",
			name: "Scale",
			price: 299,
			tagline: m.pricing_tier_scale_tagline(),
			features: [
				m.pricing_feat_everything_pro(),
				m.pricing_feat_reseller(),
				m.pricing_feat_tiered(),
				m.pricing_feat_reports(),
				m.pricing_feat_5_users(),
			],
			popular: false,
		},
	];
}

export function PricingTeaser() {
	const { isSignedIn } = useAuth();
	const tiers = getTiers();

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
							{m.pricing_anchor()}
						</div>
					</div>
				</FadeIn>

				<FadeIn delay={0.1}>
					<div className="mt-12 grid items-stretch gap-4 md:grid-cols-3 lg:gap-0">
						{tiers.map((tier) => (
							<div
								key={tier.id}
								className={cn(
									"relative flex flex-col rounded-3xl p-7",
									tier.popular
										? "z-10 bg-primary text-primary-foreground shadow-2xl lg:-my-5 lg:scale-[1.02]"
										: "border border-border bg-card shadow-sm lg:my-0",
									tier.id === "starter" && "lg:rounded-r-none lg:border-r-0",
									tier.id === "scale" && "lg:rounded-l-none lg:border-l-0",
								)}
							>
								{tier.popular && (
									<span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rotate-2 rounded-lg bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-foreground shadow-md">
										{m.pricing_most_popular()}
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
									<span className="text-4xl font-bold tracking-tight">
										RM {tier.price}
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

								{tier.foundingPrice !== undefined && (
									<div className="mt-3 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2">
										<Star className="size-3.5 shrink-0 fill-accent text-accent" />
										<p className="text-xs font-semibold text-accent">
											{m.pricing_founding_line({ price: tier.foundingPrice })}
										</p>
									</div>
								)}

								<ul className="mt-6 flex-1 space-y-2.5">
									{tier.features.map((f) => (
										<li key={f} className="flex items-center gap-2 text-sm">
											<Check className="size-4 shrink-0 text-accent" />
											{f}
										</li>
									))}
								</ul>

								<div className="mt-7">
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
								</div>
							</div>
						))}
					</div>
				</FadeIn>

				<FadeIn delay={0.15}>
					<div className="mt-10 flex flex-col items-center gap-3">
						<p className="text-center text-xs text-muted-foreground">
							{m.pricing_future()}
						</p>
						<Link
							to="/pricing"
							className="text-sm font-medium text-accent underline-offset-4 hover:underline"
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
