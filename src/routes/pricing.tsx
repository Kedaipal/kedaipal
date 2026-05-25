import { useAuth } from "@clerk/tanstack-react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, Minus, Quote, Star } from "lucide-react";
import { useState } from "react";
import { FadeIn } from "../components/landing/fade-in";
import { Footer } from "../components/landing/footer";
import { Nav } from "../components/landing/nav";
import { Button } from "../components/ui/button";

const SEO_TITLE = "Pricing — Kedaipal WhatsApp Order Hub for F&B Sellers";
const SEO_DESC =
	"Simple, transparent pricing for F&B home sellers. Start with a 14-day free trial. Starter from RM79/mo, Pro RM149/mo, Scale RM299/mo. Founding 10 spots available.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/pricing`;
const OG_IMAGE = `${SITE_URL}/android-chrome-512x512.png`;

export const Route = createFileRoute("/pricing")({
	head: () => ({
		meta: [
			{ title: SEO_TITLE },
			{ name: "description", content: SEO_DESC },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: PAGE_URL },
			{ property: "og:title", content: SEO_TITLE },
			{ property: "og:description", content: SEO_DESC },
			{ property: "og:image", content: OG_IMAGE },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: PAGE_URL }],
	}),
	component: PricingPage,
});

type Cycle = "monthly" | "annual";

interface Tier {
	id: string;
	name: string;
	tagline: string;
	monthly: number;
	annual: number;
	orderCap: string;
	users: number;
	popular: boolean;
	founding: boolean;
	foundingPrice: number;
	cta: string;
}

const TIERS: Tier[] = [
	{
		id: "starter",
		name: "Starter",
		tagline:
			"For frozen sellers just starting out — less than 50 orders/week. Covers the basics, nudges you to grow.",
		monthly: 79,
		annual: 65,
		orderCap: "100 orders/mo",
		users: 1,
		popular: false,
		founding: false,
		foundingPrice: 0,
		cta: "Start 14-day free trial",
	},
	{
		id: "pro",
		name: "Pro",
		tagline:
			"For frozen sellers running weekly batch cooks with resellers — 50–300 orders/week. The tier most F&B home sellers grow into.",
		monthly: 149,
		annual: 124,
		orderCap: "500 orders/mo",
		users: 2,
		popular: true,
		founding: true,
		foundingPrice: 104,
		cta: "Start 14-day free trial",
	},
	{
		id: "scale",
		name: "Scale",
		tagline:
			"For frozen brands managing reseller teams + multi-pickup-point — 300+ orders/week. When you're running a proper operation.",
		monthly: 299,
		annual: 249,
		orderCap: "Unlimited orders",
		users: 5,
		popular: false,
		founding: false,
		foundingPrice: 0,
		cta: "Start 14-day free trial",
	},
];

type FeatureValue = boolean | string;

interface Feature {
	label: string;
	starter: FeatureValue;
	pro: FeatureValue;
	scale: FeatureValue;
}

const FEATURES: Feature[] = [
	{
		label: "Orders per month",
		starter: "100",
		pro: "500",
		scale: "Unlimited",
	},
	{ label: "Team members", starter: "1", pro: "2", scale: "5" },
	{ label: "Hosted storefront", starter: true, pro: true, scale: true },
	{ label: "Order pipeline", starter: true, pro: true, scale: true },
	{
		label: "WhatsApp order automation",
		starter: true,
		pro: true,
		scale: true,
	},
	{ label: "Manual payment claim", starter: true, pro: true, scale: true },
	{ label: "Inventory tracking", starter: true, pro: true, scale: true },
	{ label: "Customer database (CRM)", starter: false, pro: true, scale: true },
	{
		label: "Order inbox",
		starter: false,
		pro: true,
		scale: true,
	},
	{ label: "Date picker / pre-orders", starter: false, pro: true, scale: true },
	{ label: "Automated reminders", starter: false, pro: true, scale: true },
	{
		label: "WhatsApp broadcasts",
		starter: false,
		pro: "100/mo",
		scale: "Unlimited",
	},
	{ label: "Tiered pricing", starter: false, pro: false, scale: true },
	{ label: "Reseller portal", starter: false, pro: false, scale: true },
	{ label: "Sales reports", starter: false, pro: false, scale: true },
	{ label: "Custom domain", starter: false, pro: false, scale: true },
];

const FAQS = [
	{
		q: "Can I switch tiers as my orders grow?",
		a: "Yes — upgrade in one tap from your dashboard, takes effect immediately with prorated billing. Downgrade takes effect at the end of your current billing period. You can also cancel anytime; your data is kept for 90 days.",
	},
	{
		q: "Does Pro support multi-pickup-point orders?",
		a: "Pro supports up to 2 team members and a single pickup/delivery address per order. Multi-pickup-point routing — where a single order can have different pickup locations (e.g. multiple collection points for a frozen batch run) — ships with Scale. It's on the S5 roadmap.",
	},
	{
		q: "How does cold-chain Lalamove integration work?",
		a: "Cold-chain Lalamove integration is on the roadmap for Scale-tier sellers. The integration will let you book a Lalamove van directly from a packed order in the dashboard — vehicle type, pickup time, and cold-chain flag — without switching tabs. ETA: Q4 2026. If this is critical for your operation, join as a Founding 10 member to influence the timeline.",
	},
	{
		q: "What payment methods can my customers use?",
		a: "Bank transfer, DuitNow QR, and e-wallet screenshot — all supported from day one. Online payment gateway (FPX, GrabPay, TNG) for shopper-to-retailer payments is on the S5 roadmap. Kedaipal never touches your order money — your gateway, your settlement.",
	},
	{
		q: "Is it really free right now?",
		a: "Yes — Kedaipal is in beta and everything is free. No credit card, no catch. When billing infrastructure launches, you'll be prompted to pick a plan. Beta users who sign up now lock in founder pricing.",
	},
	{
		q: "Does Kedaipal work if my customers are already chatting me on personal WhatsApp?",
		a: "Yes. Your customers keep messaging whatever number they have for you. Kedaipal is a storefront + order system that connects via the CTA URL button in your WhatsApp Business profile — customers tap it, browse, cart, and the order comes back to you in WhatsApp. No app download, no new number.",
	},
];

function FeatureCell({ value }: { value: FeatureValue }) {
	if (value === true)
		return <Check className="mx-auto size-5 text-accent" aria-label="Yes" />;
	if (value === false)
		return <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="No" />;
	return (
		<span className="text-sm font-medium text-foreground">{value}</span>
	);
}

function TierCard({ tier, cycle }: { tier: Tier; cycle: Cycle }) {
	const { isSignedIn } = useAuth();
	const price = cycle === "annual" ? tier.annual : tier.monthly;

	return (
		<div
			className={`relative flex flex-col rounded-2xl p-6 ${
				tier.popular
					? "shadow-[0_8px_40px_hsl(160_84%_39%_/_0.18)]"
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
				<span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-foreground">
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
					RM {price}
				</span>
				<span className="mb-1 text-sm text-muted-foreground">/mo</span>
			</div>
			{cycle === "annual" && (
				<p className="mt-0.5 text-xs text-accent">
					Billed RM {tier.annual * 10}/yr · 2 months free
				</p>
			)}

			<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
				{tier.tagline}
			</p>

			{tier.founding && (
				<div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
					<div className="flex items-center gap-2">
						<Star className="size-4 shrink-0 fill-accent text-accent" />
						<p className="text-xs font-bold text-accent">
							Founding 10 — RM {tier.foundingPrice}/mo forever
						</p>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						30% off for life · {10 - 0} spots remaining · locks in today's
						price permanently
					</p>
				</div>
			)}

			<ul className="mt-5 flex-1 space-y-2">
				<li className="flex items-center gap-2 text-sm">
					<Check className="size-4 shrink-0 text-accent" />
					{tier.orderCap}
				</li>
				<li className="flex items-center gap-2 text-sm">
					<Check className="size-4 shrink-0 text-accent" />
					{tier.users} team member{tier.users > 1 ? "s" : ""}
				</li>
			</ul>

			<div className="mt-6">
				{isSignedIn ? (
					<Button
						asChild
						className="w-full"
						variant={tier.popular ? "default" : "outline"}
					>
						<Link to="/app">
							Go to dashboard <ArrowRight className="size-4" />
						</Link>
					</Button>
				) : (
					<Button
						asChild
						className="w-full"
						variant={tier.popular ? "default" : "outline"}
					>
						<Link to="/sign-up/$" params={{ _splat: "" }}>
							{tier.cta} <ArrowRight className="size-4" />
						</Link>
					</Button>
				)}
			</div>
		</div>
	);
}

function PricingPage() {
	const [cycle, setCycle] = useState<Cycle>("monthly");

	return (
		<main className="min-h-dvh bg-background text-foreground">
			<Nav />

			{/* Beta banner */}
			<div className="border-b border-accent/20 bg-accent/10 px-5 py-3 text-center text-sm font-medium text-accent">
				Kedaipal is currently in beta — everything is free. Pricing below takes effect when billing launches.
			</div>

			{/* Hero */}
			<section className="border-b border-border/60 bg-hero-mesh">
				<div className="mx-auto max-w-4xl px-5 py-20 text-center md:px-8 md:py-28">
					<FadeIn>
						<p className="text-xs font-semibold uppercase tracking-widest text-accent">
							Pricing
						</p>
						<h1
							className="mt-3 text-4xl font-bold tracking-tight md:text-6xl"
							style={{ letterSpacing: "-0.03em" }}
						>
							Free now. Simple pricing when billing launches.
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
							Everything is free during beta — no credit card, no catch. Tiers
							below show what you'll pay after billing ships. Beta users lock in
							founder pricing.
						</p>
					</FadeIn>

					{/* Billing toggle */}
					<FadeIn delay={0.1}>
						<div className="mt-8 inline-flex items-center rounded-xl border border-border bg-card p-1 shadow-sm">
							<button
								type="button"
								onClick={() => setCycle("monthly")}
								className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
									cycle === "monthly"
										? "bg-foreground text-background"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								Monthly
							</button>
							<button
								type="button"
								onClick={() => setCycle("annual")}
								className={`relative rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
									cycle === "annual"
										? "bg-foreground text-background"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								Annual
								<span className="absolute -right-1 -top-2 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-accent-foreground">
									-17%
								</span>
							</button>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Tier cards */}
			<section className="border-b border-border/60">
				<div className="mx-auto max-w-6xl px-5 py-16 md:px-8">
					<FadeIn>
						<div className="grid gap-6 md:grid-cols-3">
							{TIERS.map((tier) => (
								<TierCard key={tier.id} tier={tier} cycle={cycle} />
							))}
						</div>
					</FadeIn>
					<p className="mt-6 text-center text-xs text-muted-foreground">
						Annual billing = 10 months paid, 12 received. Cancel anytime. Export
						your data anytime.
					</p>
				</div>
			</section>

			{/* Founding 10 banner */}
			<section className="border-b border-border/60 bg-accent/[0.04]">
				<div className="mx-auto max-w-4xl px-5 py-14 md:px-8">
					<FadeIn>
						<div className="flex flex-col items-center gap-6 rounded-2xl border border-accent/30 bg-background p-8 text-center shadow-sm sm:flex-row sm:text-left md:p-10">
							<div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-accent/10">
								<Star className="size-8 fill-accent text-accent" />
							</div>
							<div className="flex-1">
								<p className="text-xs font-semibold uppercase tracking-widest text-accent">
									Founding 10
								</p>
								<h2 className="mt-1 text-xl font-bold md:text-2xl">
									10 spots · 30% off for life · RM 104/mo Pro forever
								</h2>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
									The first 10 F&B home sellers who build Kedaipal with us lock
									in RM 104/mo Pro pricing permanently — no renewals, no
									inflation. Direct line to the product roadmap.{" "}
									<span className="font-semibold text-foreground">
										10 of 10 spots still open.
									</span>
								</p>
							</div>
							<div className="shrink-0">
								<Button asChild size="lg" className="h-12 px-6">
									<Link to="/sign-up/$" params={{ _splat: "" }}>
										Claim a spot <ArrowRight className="size-4" />
									</Link>
								</Button>
							</div>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Feature comparison table */}
			<section className="border-b border-border/60">
				<div className="mx-auto max-w-6xl px-5 py-16 md:px-8">
					<FadeIn>
						<h2
							className="text-center text-2xl font-bold md:text-3xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							Full feature breakdown
						</h2>
					</FadeIn>
					<FadeIn delay={0.1}>
						<div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
							<table className="w-full min-w-[540px]">
								<thead>
									<tr className="border-b border-border/60">
										<th className="px-6 py-4 text-left text-sm font-medium text-muted-foreground">
											Feature
										</th>
										{TIERS.map((t) => (
											<th
												key={t.id}
												className={`px-4 py-4 text-center text-sm font-bold ${t.popular ? "text-accent" : "text-foreground"}`}
											>
												{t.name}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{FEATURES.map((f, i) => (
										<tr
											key={f.label}
											className={
												i % 2 === 0 ? "bg-muted/20" : "bg-transparent"
											}
										>
											<td className="px-6 py-3 text-sm text-foreground">
												{f.label}
											</td>
											<td className="px-4 py-3 text-center">
												<FeatureCell value={f.starter} />
											</td>
											<td className="px-4 py-3 text-center">
												<FeatureCell value={f.pro} />
											</td>
											<td className="px-4 py-3 text-center">
												<FeatureCell value={f.scale} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Testimonial placeholder */}
			<section className="border-b border-border/60 bg-muted/20">
				<div className="mx-auto max-w-3xl px-5 py-16 text-center md:px-8">
					<FadeIn>
						<Quote className="mx-auto size-8 text-accent/30" />
						<blockquote className="mt-4 text-xl font-medium leading-relaxed text-foreground md:text-2xl">
							"[First Founding 10 testimonial lands here — reserved for the
							first seller who ships with us.]"
						</blockquote>
						<p className="mt-4 text-sm text-muted-foreground">
							Founding Member · F&amp;B home seller, Malaysia
						</p>
						<p className="mt-2 text-xs italic text-muted-foreground/60">
							Testimonial placeholder — will be replaced with a real quote from
							our first Founding 10 member.
						</p>
					</FadeIn>
				</div>
			</section>

			{/* FAQ */}
			<section className="border-b border-border/60">
				<div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
					<FadeIn>
						<h2
							className="text-center text-2xl font-bold md:text-3xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							Pricing questions, answered.
						</h2>
					</FadeIn>
					<div className="mt-10 space-y-8">
						{FAQS.map((faq, i) => (
							<FadeIn key={faq.q} delay={i * 0.05}>
								<div>
									<h3 className="text-base font-bold">{faq.q}</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{faq.a}
									</p>
								</div>
							</FadeIn>
						))}
					</div>
				</div>
			</section>

			{/* Bottom CTA */}
			<section className="border-b border-border/60">
				<div className="mx-auto max-w-4xl px-5 py-20 text-center md:px-8">
					<FadeIn>
						<h2
							className="text-3xl font-bold md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							Get started free while beta lasts.
						</h2>
						<p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
							No credit card. No Meta setup. Free during beta — apply for a
							Founding 10 spot to lock in the best price permanently.
						</p>
						<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<Button asChild size="lg" className="h-12 px-8 text-base">
								<Link to="/sign-up/$" params={{ _splat: "" }}>
									Start free trial <ArrowRight className="size-4" />
								</Link>
							</Button>
							<Button asChild variant="ghost" size="lg" className="h-12 px-8 text-base">
								<Link to="/" hash="how">
									See how it works
								</Link>
							</Button>
						</div>
					</FadeIn>
				</div>
			</section>

			<Footer />
		</main>
	);
}
