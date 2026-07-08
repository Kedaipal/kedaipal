import { useAuth } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Minus, Quote, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { FadeIn } from "../components/landing/fade-in";
import { Footer } from "../components/landing/footer";
import {
	ctaPillClass,
	Eyebrow,
	Sticker,
} from "../components/landing/landing-ui";
import { Nav } from "../components/landing/nav";
import { ResellerBandTable } from "../components/landing/reseller-band-table";
import { Button } from "../components/ui/button";
import { buildWaContactLink } from "../lib/contact";
import { cn } from "../lib/utils";
import { m } from "../paraglide/messages";

const SEO_TITLE = "Pricing — Kedaipal WhatsApp Order Hub";
const SEO_DESC =
	"Simple, transparent pricing for WhatsApp sellers. Start with a 14-day free trial. Starter from RM79/mo, Pro RM149/mo, Scale from RM299/mo. Founding 10 spots available.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/pricing`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

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

/**
 * Static tier facts (ids, prices, seat counts) live at module scope; all
 * translatable copy (taglines, order caps, CTA) is resolved per-render inside
 * the component so paraglide reads the request's locale, not the locale that
 * happened to be active when this module was first imported on the server.
 */
const TIER_FACTS = [
	{
		id: "starter",
		name: "Starter",
		monthly: 79,
		annual: 65,
		users: 1,
		popular: false,
		founding: false,
		foundingPrice: 0,
	},
	{
		id: "pro",
		name: "Pro",
		monthly: 149,
		annual: 124,
		users: 2,
		popular: true,
		founding: true,
		foundingPrice: 104,
	},
	{
		id: "scale",
		name: "Scale",
		monthly: 299,
		annual: 249,
		users: 5,
		popular: false,
		founding: false,
		foundingPrice: 0,
	},
] as const;

function useTiers(): Tier[] {
	const tagline: Record<string, string> = {
		starter: m.pricingpage_tier_starter_tagline(),
		pro: m.pricingpage_tier_pro_tagline(),
		scale: m.pricingpage_tier_scale_tagline(),
	};
	const orderCap: Record<string, string> = {
		starter: m.pricingpage_ordercap_starter(),
		pro: m.pricingpage_ordercap_pro(),
		scale: m.pricingpage_ordercap_scale(),
	};
	return TIER_FACTS.map((t) => ({
		...t,
		tagline: tagline[t.id],
		orderCap: orderCap[t.id],
		cta: m.pricingpage_cta_trial(),
	}));
}

type FeatureValue = boolean | string;

interface Feature {
	label: string;
	starter: FeatureValue;
	pro: FeatureValue;
	scale: FeatureValue;
	// True = the capability isn't built yet. Shown with a "Coming soon" badge so the
	// pricing table doesn't over-promise before those features ship. Keep in sync
	// with what's actually shipped (see ClickUp 86exrhpfn + the entitlement tickets).
	comingSoon?: boolean;
}

function useFeatures(): Feature[] {
	return [
		{
			label: m.pricingpage_feat_orders_per_month(),
			starter: "100",
			pro: "500",
			scale: m.pricingpage_unlimited(),
		},
		{
			label: m.pricingpage_feat_team_members(),
			starter: "1",
			pro: "2",
			scale: "5",
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_storefront(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_pipeline(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_wa_automation(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_payment_claim(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_inventory(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_variants(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_mockup(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_crm(),
			starter: false,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_inbox(),
			starter: false,
			pro: true,
			scale: true,
		},
		{
			// Shipped (fulfilment date at checkout, 86expm524) — and it's part of
			// the core order flow on EVERY storefront, so it's honestly all-tier:
			// the buyer-facing checkout doesn't vary by the seller's plan.
			label: m.pricingpage_feat_datepicker(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_reminders(),
			starter: false,
			pro: true,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_broadcasts(),
			starter: false,
			pro: m.pricingpage_val_broadcast_pro(),
			scale: m.pricingpage_val_broadcast_scale(),
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_tiered(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_reseller(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_reports(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_custom_domain(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_production_calendar(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_priority_support(),
			starter: false,
			pro: false,
			scale: true,
			comingSoon: true,
		},
	];
}

function useFaqs(): { q: string; a: string }[] {
	return [
		{ q: m.pricingpage_faq_q1(), a: m.pricingpage_faq_a1() },
		{ q: m.pricingpage_faq_q2(), a: m.pricingpage_faq_a2() },
		{ q: m.pricingpage_faq_q3(), a: m.pricingpage_faq_a3() },
		{ q: m.pricingpage_faq_q4(), a: m.pricingpage_faq_a4() },
		{ q: m.pricingpage_faq_q5(), a: m.pricingpage_faq_a5() },
		{ q: m.pricingpage_faq_q6(), a: m.pricingpage_faq_a6() },
	];
}

function FeatureCell({ value }: { value: FeatureValue }) {
	if (value === true)
		return (
			<Check
				className="mx-auto size-5 text-accent"
				aria-label={m.pricingpage_yes()}
			/>
		);
	if (value === false)
		return (
			<Minus
				className="mx-auto size-4 text-muted-foreground/40"
				aria-label={m.pricingpage_no()}
			/>
		);
	return <span className="text-sm font-medium text-foreground">{value}</span>;
}

function TierCard({ tier, cycle }: { tier: Tier; cycle: Cycle }) {
	const { isSignedIn } = useAuth();
	// Scale is banded on active resellers (Coming soon), so it always anchors on
	// "from RM299" and ignores the monthly/annual toggle — an annual number would
	// be misleading before banded billing ships. See docs/pricing.md.
	const isScale = tier.id === "scale";
	const price = cycle === "annual" ? tier.annual : tier.monthly;

	return (
		<div
			className={cn(
				"relative flex flex-col rounded-3xl p-7",
				tier.popular
					? "z-10 bg-primary text-primary-foreground shadow-2xl lg:-my-4 lg:scale-[1.02]"
					: "border border-border bg-card shadow-sm",
			)}
		>
			{tier.popular && (
				<span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rotate-2 whitespace-nowrap rounded-lg bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-foreground shadow-md">
					{m.pricing_most_popular()}
				</span>
			)}
			{tier.id === "scale" && (
				<span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-muted px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
					{m.pricingpage_coming_soon()}
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
				{isScale && (
					<span className="mb-1 text-sm text-muted-foreground">
						{m.pricingpage_price_from()}
					</span>
				)}
				<span className="text-4xl font-bold tracking-tight">
					RM {isScale ? tier.monthly : price}
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
			{cycle === "annual" && !isScale && (
				<p className="mt-0.5 text-xs text-accent">
					{m.pricingpage_billed_annual({ total: tier.annual * 10 })}
				</p>
			)}

			<p
				className={cn(
					"mt-3 text-sm leading-relaxed",
					tier.popular ? "text-primary-foreground/65" : "text-muted-foreground",
				)}
			>
				{tier.tagline}
			</p>

			{isScale && <ResellerBandTable className="mt-4" />}

			{tier.founding && (
				<div className="mt-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
					<div className="flex items-center gap-2">
						<Star className="size-4 shrink-0 fill-accent text-accent" />
						<p className="text-xs font-bold text-accent">
							{m.pricingpage_founding_forever({ price: tier.foundingPrice })}
						</p>
					</div>
					<p
						className={cn(
							"mt-1 text-xs",
							tier.popular
								? "text-primary-foreground/60"
								: "text-muted-foreground",
						)}
					>
						{m.pricingpage_founding_detail({ spots: 10 })}
					</p>
				</div>
			)}

			<ul className="mt-5 flex-1 space-y-2">
				<li className="flex items-center gap-2 text-sm">
					<Check className="size-4 shrink-0 text-accent" />
					{tier.orderCap}
				</li>
				<li className="flex items-center gap-2 text-sm text-muted-foreground">
					<Check className="size-4 shrink-0 text-muted-foreground/50" />
					{tier.users === 1
						? m.pricingpage_team_member_one({ count: tier.users })
						: m.pricingpage_team_member_other({ count: tier.users })}
					<span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
						{m.pricingpage_soon()}
					</span>
				</li>
			</ul>

			<div className="mt-6">
				{isScale ? (
					// Scale is banded + not yet purchasable — a disabled "Coming soon"
					// panel replaces the CTA (mirrors the landing teaser). Trials are
					// Pro-only, so a trial link here would be wrong.
					<div className="flex h-11 w-full items-center justify-center rounded-full border border-dashed border-border bg-muted/40 text-sm font-semibold text-muted-foreground">
						{m.pricingpage_coming_soon()}
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
								{m.nav_go_to_dashboard()} <ArrowRight className="size-4" />
							</Link>
						) : (
							<Link to="/sign-up/$" params={{ _splat: "" }}>
								{tier.cta} <ArrowRight className="size-4" />
							</Link>
						)}
					</Button>
				)}
			</div>
		</div>
	);
}

function PricingPage() {
	const [cycle, setCycle] = useState<Cycle>("monthly");
	const tiers = useTiers();
	const features = useFeatures();
	const faqs = useFaqs();

	return (
		<main className="min-h-dvh bg-background text-foreground">
			<Nav />

			{/* Hero */}
			<section className="bg-hero-mesh">
				<div className="mx-auto max-w-4xl px-5 pb-16 pt-28 text-center md:px-8 md:pb-24 md:pt-40">
					<FadeIn>
						<Sticker tone="outline" rotate={-1.5}>
							<Sparkles className="size-3" />
							{m.pricing_badge()}
						</Sticker>
						<h1
							className="mt-5 text-4xl font-bold tracking-tight md:text-6xl"
							style={{ letterSpacing: "-0.03em" }}
						>
							<span className="kp-highlight text-accent">
								{m.pricingpage_hero_highlight()}
							</span>{" "}
							{m.pricingpage_hero_rest()}
						</h1>
						<p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
							{m.pricingpage_hero_sub()}
						</p>
					</FadeIn>

					{/* Billing toggle */}
					<FadeIn delay={0.1}>
						<div className="mt-8 inline-flex items-center rounded-full border border-border bg-card p-1.5 shadow-sm">
							<button
								type="button"
								onClick={() => setCycle("monthly")}
								className={cn(
									"rounded-full px-5 py-2 text-sm font-semibold transition-colors",
									cycle === "monthly"
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{m.pricingpage_toggle_monthly()}
							</button>
							<button
								type="button"
								onClick={() => setCycle("annual")}
								className={cn(
									"relative rounded-full px-5 py-2 text-sm font-semibold transition-colors",
									cycle === "annual"
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{m.pricingpage_toggle_annual()}
								<span className="absolute -right-1 -top-2 rotate-3 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-accent-foreground">
									-17%
								</span>
							</button>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Tier cards */}
			<section>
				<div className="mx-auto max-w-6xl px-5 py-16 md:px-8">
					<FadeIn>
						<div className="grid items-stretch gap-6 md:grid-cols-3 lg:gap-5">
							{tiers.map((tier) => (
								<TierCard key={tier.id} tier={tier} cycle={cycle} />
							))}
						</div>
					</FadeIn>
					<p className="mt-8 text-center text-xs text-muted-foreground">
						{m.pricingpage_no_lockin_note()}
					</p>
				</div>
			</section>

			{/* Founding 10 banner */}
			<section>
				<div className="mx-auto max-w-4xl px-5 py-14 md:px-8">
					<FadeIn>
						<div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-[2rem] bg-cta-mesh p-8 text-center text-primary-foreground shadow-xl sm:flex-row sm:text-left md:p-10">
							<div
								aria-hidden
								className="pointer-events-none absolute -right-16 -top-16 size-[220px] rounded-full border border-white/[0.06]"
							/>
							<div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-accent/15">
								<Star className="size-8 fill-accent text-accent" />
							</div>
							<div className="relative flex-1">
								<p className="text-xs font-semibold uppercase tracking-widest text-accent">
									{m.founding_label()}
								</p>
								<h2 className="mt-1 text-xl font-bold md:text-2xl">
									{m.pricingpage_banner_heading()}
								</h2>
								<p className="mt-2 text-sm leading-relaxed text-primary-foreground/65">
									{m.pricingpage_banner_body()}{" "}
									<span className="font-semibold text-primary-foreground">
										{m.pricingpage_banner_spots()}
									</span>
								</p>
							</div>
							<div className="relative shrink-0">
								<a
									href={buildWaContactLink(m.founding_wa_message())}
									target="_blank"
									rel="noopener noreferrer"
									className={ctaPillClass("accent")}
								>
									{m.pricingpage_banner_cta()}{" "}
									<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
								</a>
							</div>
						</div>
					</FadeIn>
				</div>
			</section>

			{/* Feature comparison table */}
			<section>
				<div className="mx-auto max-w-6xl px-5 py-16 md:px-8">
					<FadeIn>
						<div className="text-center">
							<Eyebrow className="justify-center">
								{m.pricingpage_compare_eyebrow()}
							</Eyebrow>
							<h2
								className="mt-4 text-2xl font-bold md:text-4xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.pricingpage_compare_heading()}
							</h2>
						</div>
					</FadeIn>
					<FadeIn delay={0.1}>
						<div className="mt-8 overflow-x-auto rounded-3xl border border-border bg-card shadow-sm">
							<table className="w-full min-w-[540px]">
								<thead>
									<tr className="border-b border-border/60">
										<th className="px-6 py-4 text-left text-sm font-medium text-muted-foreground">
											{m.pricingpage_table_feature()}
										</th>
										{TIER_FACTS.map((t) => (
											<th
												key={t.id}
												className={cn(
													"px-4 py-4 text-center text-sm font-bold",
													t.popular ? "text-accent" : "text-foreground",
												)}
											>
												{t.name}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{features.map((f, i) => (
										<tr
											key={f.label}
											className={i % 2 === 0 ? "bg-muted/20" : "bg-transparent"}
										>
											<td className="px-6 py-3 text-sm text-foreground">
												<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
													<span
														className={
															f.comingSoon ? "text-muted-foreground" : ""
														}
													>
														{f.label}
													</span>
													{f.comingSoon ? (
														<span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
															{m.pricingpage_coming_soon()}
														</span>
													) : null}
												</span>
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
			<section className="bg-muted/30">
				<div className="mx-auto max-w-3xl px-5 py-16 text-center md:px-8">
					<FadeIn>
						<Quote className="mx-auto size-8 text-accent/30" />
						<blockquote className="mt-4 text-xl font-medium leading-relaxed text-foreground md:text-2xl">
							{m.pricingpage_testimonial_quote()}
						</blockquote>
						<p className="mt-4 text-sm text-muted-foreground">
							{m.pricingpage_testimonial_attrib()}
						</p>
						<p className="mt-2 text-xs italic text-muted-foreground/60">
							{m.pricingpage_testimonial_note()}
						</p>
					</FadeIn>
				</div>
			</section>

			{/* FAQ */}
			<section>
				<div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
					<FadeIn>
						<div className="text-center">
							<Eyebrow className="justify-center">
								{m.pricingpage_faq_eyebrow()}
							</Eyebrow>
							<h2
								className="mt-4 text-2xl font-bold md:text-4xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.pricingpage_faq_heading()}
							</h2>
						</div>
					</FadeIn>
					<div className="mt-10 space-y-8">
						{faqs.map((faq, i) => (
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
			<section>
				<div className="mx-auto max-w-4xl px-5 py-20 text-center md:px-8">
					<FadeIn>
						<h2
							className="text-3xl font-bold md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.pricingpage_cta_heading()}
						</h2>
						<p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
							{m.pricingpage_cta_sub()}
						</p>
						<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<Link
								to="/sign-up/$"
								params={{ _splat: "" }}
								className={ctaPillClass("accent")}
							>
								{m.pricingpage_cta_trial_btn()}{" "}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
							<Link to="/" hash="how" className={ctaPillClass("outline")}>
								{m.pricingpage_cta_how()}
							</Link>
						</div>
					</FadeIn>
				</div>
			</section>

			<Footer />
		</main>
	);
}
