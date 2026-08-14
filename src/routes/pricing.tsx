import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Minus, Quote, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { FadeIn } from "../components/landing/fade-in";
import { Footer } from "../components/landing/footer";
import {
	ctaPillClass,
	Eyebrow,
	GuaranteeLine,
	Sticker,
} from "../components/landing/landing-ui";
import { MoneyMathRow } from "../components/landing/money-math";
import { Nav } from "../components/landing/nav";
import { Button } from "../components/ui/button";
import { useSupportWaNumber } from "../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../lib/contact";
import { resolveTierCta } from "../lib/pricing-cta";
import type { SubscriptionView } from "../lib/subscription";
import { cn } from "../lib/utils";
import { m } from "../paraglide/messages";

const SEO_TITLE = "Pricing — Kedaipal WhatsApp Order Hub";
const SEO_DESC =
	"Simple, transparent pricing for WhatsApp sellers. Start with a 14-day free trial. Starter RM79/mo, Pro RM149/mo, Scale RM299/mo flat. Founding 10 spots available.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/pricing`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

const TOTAL_FOUNDING_SPOTS = 10;

// Annual billing is hidden until tokenised recurring ships (HitPay recurring
// 86eyb6z4r). There are no recurring rails behind an annual price today, and a
// permanent visible % discount undercuts the flat-price value posture (Arif,
// 28 Jul + 9 Aug 2026). Flip to true to re-expose the monthly/annual toggle;
// if reinstated, frame the saving as "2 months free", never a percentage.
const SHOW_ANNUAL_TOGGLE = false;

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
			// Decided allowances (Starter 100 / Pro 200 / Scale 400) from the caps
			// ticket 86eye2ccu. Copy leads enforcement (Arif, 9 Aug 2026): PLAN_CAPS
			// still reads 2,000 for Scale until that ticket ships the soft-cap meter,
			// but the page must never advertise a number the business can't hold.
			label: m.pricingpage_feat_orders_per_month(),
			starter: "100",
			pro: "200",
			scale: "400",
		},
		{
			label: m.pricingpage_feat_team_members(),
			starter: "1",
			pro: "2",
			scale: "5",
			comingSoon: true,
		},
		{
			label: m.pricingpage_feat_outlets(),
			starter: "1",
			pro: "1",
			scale: m.pricingpage_val_outlets_scale(),
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
			// Shipped (HitPay gateway, 86eyb6z3a) — BYO seller accounts, Pro-gated
			// via PLAN_FEATURES.onlinePayments.
			label: m.pricingpage_feat_online_payments(),
			starter: false,
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
			// Shipped (86ey81n63) — PLAN_FEATURES.categories.
			label: m.pricingpage_feat_categories(),
			starter: false,
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
			// Shipped (Seller Insights v1, 86ey5tfrz) — live, so no Coming soon
			// badge. The strongest shipped Pro differentiator; must be on the table.
			label: m.pricingpage_feat_insights(),
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
			// Shipped and un-gated (payment reminder, 86ey570am): the nudge protects
			// the seller's cash on every plan, so it carries no PLAN_FEATURES entry.
			// It sat here as a Pro-only "Coming soon" long after it went live.
			label: m.pricingpage_feat_reminders(),
			starter: true,
			pro: true,
			scale: true,
		},
		{
			// Shipped (86extzdr8) — PLAN_FEATURES.radiusDelivery.
			label: m.pricingpage_feat_radius(),
			starter: false,
			pro: true,
			scale: true,
		},
		{
			// Shipped (86eyb5hrf) — PLAN_FEATURES.delivery. BYO Lalamove keys.
			label: m.pricingpage_feat_lalamove(),
			starter: false,
			pro: true,
			scale: true,
		},
		{
			// Shipped (86eyhw9zy) — PLAN_FEATURES.waOrderAlerts.
			label: m.pricingpage_feat_wa_alerts(),
			starter: false,
			pro: true,
			scale: true,
		},
		{
			label: m.pricingpage_feat_broadcasts(),
			starter: false,
			pro: m.pricingpage_val_broadcast_pro(),
			scale: m.pricingpage_val_broadcast_scale(),
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

function TierCard({
	tier,
	cycle,
	isSignedIn,
	subscription,
	pending,
	foundingRemaining,
}: {
	tier: Tier;
	cycle: Cycle;
	isSignedIn: boolean;
	/** Live founding-spot count — never a hardcoded number (86eye3p6z §D). */
	foundingRemaining: number;
	/** The signed-in seller's plan/status, or null when signed out / not yet
	 * resolved (loading, or a storeless admin) — the CTA falls back safely then. */
	subscription: SubscriptionView | null;
	/** Auth/plan still resolving — show a spinner instead of a (soon-to-change)
	 * label on the purchasable tiers. Scale ignores it (auth-independent). */
	pending: boolean;
}) {
	// Scale is the flat multi-outlet tier (RM299/mo — Arif, 19 Jul 2026), still
	// not purchasable, so only its CTA differs (a disabled "Coming soon" panel).
	// See docs/pricing.md.
	const isScale = tier.id === "scale";
	const price = cycle === "annual" ? tier.annual : tier.monthly;

	// CTA is plan-aware for signed-in sellers: only an active/comped owner of this
	// tier gets the disabled "Current plan" pill; trial/lapsed sellers get an
	// actionable "Subscribe", and owners of another tier get "Upgrade"/"Manage
	// plan" — all routing to Settings → Billing, which owns the manual contact-Arif
	// flow (billing is manual in v1). See docs/pricing.md + src/lib/pricing-cta.ts.
	const cta = resolveTierCta(tier.id, { isScale, isSignedIn, subscription });

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
				<span className="text-4xl font-bold tracking-tight">RM {price}</span>
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
			{cycle === "annual" && (
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

			<p
				className={cn(
					"mt-2 text-xs font-medium",
					tier.popular ? "text-primary-foreground/70" : "text-accent-emphasis",
				)}
			>
				{m.pricingpage_flat_price_note()}
			</p>

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
						{m.pricingpage_founding_detail({ spots: foundingRemaining })}
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
				{isScale && (
					<>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<Check className="size-4 shrink-0 text-muted-foreground/50" />
							{m.pricingpage_scale_outlets()}
							<span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
								{m.pricingpage_soon()}
							</span>
						</li>
						<li className="pl-6 text-xs text-muted-foreground/80">
							{m.pricingpage_scale_outlet_addon()}
						</li>
					</>
				)}
			</ul>

			<div className="mt-6">
				{cta === "coming_soon" ? (
					// Scale is not yet purchasable — a disabled "Coming soon" panel
					// replaces the CTA (mirrors the landing teaser). Trials are
					// Pro-only, so a trial link here would be wrong.
					<div className="flex h-11 w-full items-center justify-center rounded-full border border-dashed border-border bg-muted/40 text-sm font-semibold text-muted-foreground">
						{m.pricingpage_coming_soon()}
					</div>
				) : pending ? (
					// Auth/plan still resolving — a spinner holds the button's place so
					// the label doesn't flip trial → dashboard → final on one refresh.
					<Button
						size="lg"
						isLoading
						aria-label={m.pricingpage_cta_loading()}
						variant={tier.popular ? "default" : "outline"}
						className={cn(
							"h-11 w-full rounded-full",
							!tier.popular &&
								"border-border bg-background text-foreground hover:bg-muted",
						)}
					>
						{m.pricingpage_cta_trial()}
					</Button>
				) : cta === "current" ? (
					// The seller is already on this tier — a non-actionable pill, not a
					// link, so the card doesn't pretend there's something to do here.
					<div
						className={cn(
							"flex h-11 w-full items-center justify-center gap-1.5 rounded-full border text-sm font-semibold",
							tier.popular
								? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80"
								: "border-border bg-muted/40 text-muted-foreground",
						)}
					>
						<Check className="size-4" />
						{m.pricingpage_current_plan()}
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
						{cta === "trial" ? (
							<Link to="/sign-up/$" params={{ _splat: "" }}>
								{tier.cta} <ArrowRight className="size-4" />
							</Link>
						) : cta === "dashboard" ? (
							// Signed in but plan not resolved (loading / storeless admin) —
							// safe fallback to the dashboard, no wrong upgrade label.
							<Link to="/app">
								{m.nav_go_to_dashboard()} <ArrowRight className="size-4" />
							</Link>
						) : (
							// subscribe | upgrade | manage → Settings → Billing (the manual
							// contact-Arif conversion/upgrade flow).
							<Link to="/app/settings" search={{ tab: "billing" }}>
								{cta === "subscribe"
									? m.pricingpage_cta_subscribe()
									: cta === "upgrade"
										? m.pricingpage_cta_upgrade()
										: m.pricingpage_cta_manage_plan()}{" "}
								<ArrowRight className="size-4" />
							</Link>
						)}
					</Button>
				)}
				{/* The guarantee rides the tier a visitor is most likely to pick,
				    directly under its CTA (86eye3p6z §B) — and only while that CTA is
				    still an invitation. A seller already on this plan has been
				    onboarded; promising them a first order would read as a bug. */}
				{tier.popular && cta !== "coming_soon" && cta !== "current" ? (
					<GuaranteeLine className="mt-2.5 text-[11.5px] leading-relaxed text-primary-foreground/65" />
				) : null}
			</div>
		</div>
	);
}

function PricingPage() {
	const [cycle, setCycle] = useState<Cycle>("monthly");
	const { isLoaded, isSignedIn } = useAuth();
	// Only signed-in sellers need their plan; skip the query for visitors. A
	// narrow read (plan/status/comped) — not the heavy getMyRetailer payload — on
	// this public marketing route. null while loading / storeless admin → the
	// card CTA falls back safely.
	const planState = useQuery(
		convexQuery(api.retailers.getMyPlan, isLoaded && isSignedIn ? {} : "skip"),
	).data;
	const subscription: SubscriptionView | null = planState ?? null;
	// Until Clerk has loaded AND (for a signed-in seller) the plan query resolves,
	// the final CTA is unknown — show a spinner in the button rather than flipping
	// the label through trial → dashboard → final on a single refresh.
	const ctaPending =
		!isLoaded || (isSignedIn === true && planState === undefined);
	// Live founding-spot count — the same public query the landing's Founding 10
	// section reads. Scarcity that looks approximate reads as fake, so this page
	// must never print a hardcoded number (86eye3p6z §D). All-open is the honest
	// fallback while loading / on SSR: never a fake "taken".
	const foundingRemaining =
		useQuery(convexQuery(api.foundingMembers.getSpotsRemaining, {})).data ??
		TOTAL_FOUNDING_SPOTS;
	const tiers = useTiers();
	const features = useFeatures();
	const faqs = useFaqs();
	const supportWa = useSupportWaNumber();

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

					{/* Billing toggle — hidden until recurring billing ships; see
					    SHOW_ANNUAL_TOGGLE. Monthly is the only cycle meanwhile. */}
					{SHOW_ANNUAL_TOGGLE && (
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
					)}
				</div>
			</section>

			{/* Cost context before the numbers — the compact sibling of the landing's
			    money-math block, so RM79/149/299 arrive next to what a marketplace
			    already takes (86eye3p6z §A). */}
			<MoneyMathRow />

			{/* Tier cards */}
			<section>
				<div className="mx-auto max-w-6xl px-5 py-16 md:px-8">
					<FadeIn>
						<div className="grid items-stretch gap-6 md:grid-cols-3 lg:gap-5">
							{tiers.map((tier) => (
								<TierCard
									key={tier.id}
									tier={tier}
									cycle={cycle}
									isSignedIn={isSignedIn ?? false}
									subscription={subscription}
									pending={ctaPending}
									foundingRemaining={foundingRemaining}
								/>
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
						<div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-[2rem] bg-cta-mesh p-8 text-center text-cta-mesh-foreground shadow-xl sm:flex-row sm:text-left md:p-10">
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
								<p className="mt-2 text-sm leading-relaxed text-cta-mesh-foreground/65">
									{m.pricingpage_banner_body()}{" "}
									<span className="font-semibold text-cta-mesh-foreground">
										{m.founding_remaining({
											remaining: foundingRemaining,
											total: TOTAL_FOUNDING_SPOTS,
										})}
									</span>
								</p>
							</div>
							<div className="relative shrink-0">
								{/* Text link, not a pill — the tier cards and the closing CTA
								    already carry this page's buttons, and a founding spot is a
								    conversation rather than a checkout (86eye3p6z §C). */}
								<a
									href={buildWaContactLink(m.founding_wa_message(), supportWa)}
									target="_blank"
									rel="noopener noreferrer"
									className="group inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-accent underline-offset-4 hover:underline"
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
						<div className="mt-8 flex flex-col items-center gap-3.5">
							<Link
								to="/sign-up/$"
								params={{ _splat: "" }}
								className={ctaPillClass("accent")}
							>
								{m.pricingpage_cta_trial_btn()}{" "}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
							<GuaranteeLine className="max-w-md text-[13px] leading-relaxed text-muted-foreground" />
							<Link
								to="/"
								hash="how"
								className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
							>
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
