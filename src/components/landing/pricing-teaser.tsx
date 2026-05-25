import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Sparkles, Star } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { FadeIn } from "./fade-in";

const TIERS = [
	{
		id: "starter",
		name: "Starter",
		price: 79,
		tagline: "<50 orders/week",
		features: ["Storefront", "Order pipeline", "WhatsApp automation", "1 user"],
		popular: false,
		founding: false,
	},
	{
		id: "pro",
		name: "Pro",
		price: 149,
		foundingPrice: 104,
		tagline: "50–300 orders/week",
		features: [
			"Everything in Starter",
			"Customer database",
			"Order inbox",
			"Reminders + broadcasts",
			"2 users",
		],
		popular: true,
		founding: true,
	},
	{
		id: "scale",
		name: "Scale",
		price: 299,
		tagline: "300+ orders/week",
		features: [
			"Everything in Pro",
			"Reseller portal",
			"Tiered pricing",
			"Sales reports",
			"5 users",
		],
		popular: false,
		founding: false,
	},
] as const;

export function PricingTeaser() {
	const { isSignedIn } = useAuth();

	return (
		<section
			id="pricing"
			aria-labelledby="pricing-heading"
			className="border-b border-border/60 bg-muted/30"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<FadeIn>
					<div className="text-center">
						<span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
							<Sparkles className="size-3" />
							{m.pricing_badge()}
						</span>
						<h2
							id="pricing-heading"
							className="mt-4 text-3xl font-bold md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.pricing_heading()}
						</h2>
						<p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
							{m.pricing_sub()}
						</p>
						<div className="mx-auto mt-5 max-w-xl rounded-xl border-l-4 border-accent/40 bg-accent/5 px-5 py-3 text-left text-sm text-muted-foreground">
							{m.pricing_anchor()}
						</div>
					</div>
				</FadeIn>

				<FadeIn delay={0.1}>
					<div className="mt-10 grid gap-4 md:grid-cols-3">
						{TIERS.map((tier) => (
							<div
								key={tier.id}
								className={`relative flex flex-col rounded-2xl p-6 ${
									tier.popular
										? "shadow-[0_8px_40px_hsl(160_84%_39%_/_0.16)]"
										: "border border-border bg-card shadow-sm"
								}`}
								style={
									tier.popular
										? {
												background:
													"linear-gradient(white, white) padding-box, linear-gradient(135deg, hsl(160 84% 39%), hsl(160 84% 68%), hsl(160 84% 39%)) border-box",
												border: "2px solid transparent",
											}
										: undefined
								}
							>
								{tier.popular && (
									<span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-foreground">
										Most popular
									</span>
								)}

								<p
									className={`text-sm font-semibold uppercase tracking-wider ${tier.popular ? "text-accent" : "text-muted-foreground"}`}
								>
									{tier.name}
								</p>
								<div className="mt-3 flex items-end gap-1">
									<span className="text-4xl font-bold tracking-tight">
										RM {tier.price}
									</span>
									<span className="mb-1 text-sm text-muted-foreground">/mo</span>
								</div>
								<p className="mt-1 text-xs text-muted-foreground">
									{tier.tagline}
								</p>

								{"founding" in tier && tier.founding && "foundingPrice" in tier && (
									<div className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
										<Star className="size-3.5 shrink-0 fill-accent text-accent" />
										<p className="text-xs font-semibold text-accent">
											Founding 10: RM {tier.foundingPrice}/mo forever
										</p>
									</div>
								)}

								<ul className="mt-5 flex-1 space-y-2">
									{tier.features.map((f) => (
										<li key={f} className="flex items-center gap-2 text-sm">
											<Check className="size-4 shrink-0 text-accent" />
											{f}
										</li>
									))}
								</ul>

								<div className="mt-6">
									{isSignedIn ? (
										<Button
											asChild
											className="w-full"
											variant={tier.popular ? "default" : "outline"}
										>
											<Link to="/app">
												{m.nav_go_to_dashboard()}
												<ArrowRight />
											</Link>
										</Button>
									) : (
										<Button
											asChild
											className="w-full"
											variant={tier.popular ? "default" : "outline"}
										>
											<Link to="/sign-up/$" params={{ _splat: "" }}>
												{m.pricing_cta()}
												<ArrowRight />
											</Link>
										</Button>
									)}
								</div>
							</div>
						))}
					</div>
				</FadeIn>

				<FadeIn delay={0.15}>
					<div className="mt-6 flex flex-col items-center gap-3">
						<p className="text-center text-xs text-muted-foreground">
							{m.pricing_future()}
						</p>
						<Link
							to="/pricing"
							className="text-sm font-medium text-accent underline-offset-4 hover:underline"
						>
							See full feature breakdown →
						</Link>
					</div>
					<p className="mt-4 text-center text-xs text-muted-foreground">
						{m.pricing_no_lockin()}
					</p>
				</FadeIn>
			</div>
		</section>
	);
}
