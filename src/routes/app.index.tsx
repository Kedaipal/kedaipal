import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	CreditCard,
	ExternalLink,
	MapPin,
	MessageCircle,
	Package,
	Phone,
	Plus,
	Share2,
	Sparkles,
	Store,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Country } from "../../convex/lib/country";
import { todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import { FirstOrderCelebration } from "../components/dashboard/first-order-celebration";
import { GreetingChecklistRow } from "../components/dashboard/greeting-checklist-row";
import { ShareLinkChecklistRow } from "../components/dashboard/share-link-checklist-row";
import { StorefrontQrDialog } from "../components/dashboard/storefront-qr-dialog";
import { WhiteGloveCard } from "../components/dashboard/white-glove-card";
import { ActionStrip } from "../components/home/action-strip";
import {
	BalancesCard,
	balancesPlacement,
} from "../components/home/balances-card";
import { DeliveriesHomeCard } from "../components/home/deliveries-card";
import { EmptySalesCard } from "../components/home/empty-sales-card";
import { ExceptionRows } from "../components/home/exception-rows";
import { HomeSkeleton } from "../components/home/home-skeleton";
import { PlanAheadCard } from "../components/home/plan-ahead-card";
import { ReferCard } from "../components/home/refer-card";
import { ReferralWelcomeCard } from "../components/home/referral-welcome-card";
import { SalesSection } from "../components/home/sales-section";
import {
	type ChecklistItem,
	ChecklistRow,
	SetupChecklist,
} from "../components/home/setup-checklist";
import { ShareCard } from "../components/home/share-card";
import { HomeGreeting } from "../components/home/store-avatar";
import { WelcomeCard } from "../components/home/welcome-card";
import { CountrySetupPanel } from "../components/settings/country-setup-panel";
import { Button } from "../components/ui/button";
import { useChecklistStamp } from "../hooks/useChecklistStamp";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { revealAnchorWhenMounted } from "../lib/country-setup-copy";
import { creditTone } from "../lib/credits-ui";
import { type HomePeriod, parseHomePeriod } from "../lib/home-copy";
import {
	type HomeSpotlightKey,
	isHomeSpotlightKey,
	SPOTLIGHT_ANCHOR,
} from "../lib/spotlight";
import { storefrontUrl as buildStorefrontUrl } from "../lib/storefront-url";
import { subscribeStepCopy } from "../lib/subscribe-step";
import { freePeriodState, hasSubscribed } from "../lib/subscription";

/**
 * Dashboard Home (z8r3fdrgzj) — sales first.
 *
 * This file is the STATE SWITCH and nothing else: it resolves which of the
 * page's five shapes the store is in, assembles the setup checklist, and hands
 * the rendering to `src/components/home/*`. It used to be 1,185 lines holding
 * the layout for every one of those shapes inline, which is why a change to the
 * steady-state page kept breaking onboarding.
 *
 * The five shapes, in the order a store meets them:
 *   new      — nothing set up: welcome card, how it works, the checklist.
 *   waiting  — set up, no order yet: the share card leads, sales frame empty.
 *   first    — first order within the celebration window: the milestone.
 *   steady   — the reference board: strip, exceptions, sales, plan ahead.
 * plus `loading`, which paints a skeleton shaped like whichever is coming.
 *
 * Dark mode is deliberately out of scope here (Zaki, 12 Oct 2026) — see
 * docs/home.md.
 */
export const Route = createFileRoute("/app/")({
	component: DashboardHome,
	validateSearch: (
		search: Record<string, unknown>,
	): { p?: HomePeriod; spot?: HomeSpotlightKey } => ({
		// Only pinned when it differs from the default, so the common URL stays
		// clean — but it round-trips, so a refresh keeps the seller's window.
		...(search.p === undefined ? {} : { p: parseHomePeriod(search.p) }),
		// A What's-new note's deep link to one Home section (src/lib/spotlight.ts).
		// Same posture as Settings: a key from another page is dropped, not
		// rung — and the key is RETURNED, `undefined` when absent, or its raw
		// value leaks through TanStack's merge (z8r3fdtk87,
		// src/lib/search-params-sweep.test.ts).
		spot: isHomeSpotlightKey(search.spot) ? search.spot : undefined,
	}),
});

// Named per store country (z8r3fdbmc9) — DuitNow is a Malaysian rail; an SG
// store's confirmation carries PayNow instead.
const PAYMENT_STEP_WHY: Record<Country, string> = {
	MY: "Your bank account or DuitNow QR is included automatically in the order confirmation message sent to every shopper.",
	SG: "Your bank account or PayNow QR is included automatically in the order confirmation message sent to every shopper.",
};

/**
 * How long the first-order celebration stays on Home after activation. A
 * transient "you're live!" moment that self-clears — no stored dismissal needed
 * (we compare against `retailer.activatedAt`).
 */
const ACTIVATION_CELEBRATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Days of lookahead the Plan ahead strip shows. */
const PLAN_AHEAD_DAYS = 7;

function DashboardHome() {
	const retailer = useDashboardRetailer();
	const canSeeInsights = usePermission("insights").canRead;
	const canSeeOrders = usePermission("orders").canRead;
	const navigate = useNavigate({ from: "/app" });
	const search = Route.useSearch();
	const period: HomePeriod = parseHomePeriod(search.p);
	// Deep link to one section: scroll to it once it is on the page and ring
	// its card in the brand mint — the Refer card mounts only after its query
	// answers, so wait for IT, not a frame (the Settings route's rule).
	const spot = search.spot;
	useEffect(() => {
		if (!spot) return;
		return revealAnchorWhenMounted(SPOTLIGHT_ANCHOR[spot].anchor);
	}, [spot]);

	const products = useQuery(
		convexQuery(
			api.products.listAll,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	// One inbox snapshot powers the strip AND the stale-unpaid exception row —
	// the same counts seam the orders inbox subscribes to.
	const inboxSnapshot = useQuery(
		convexQuery(
			api.orders.searchOrders,
			retailer
				? { retailerId: retailer._id, bucket: "all" as const, limit: 1 }
				: "skip",
		),
	).data;
	// The Deliveries page's own read (86eye9xd4, 6A) — Home's deliveries card
	// and the courier wallets in the Balances card share its cache, so the
	// page opens instantly.
	const deliveries = useQuery(
		convexQuery(
			api.deliveries.overview,
			retailer && canSeeOrders ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const pickupStatus = useQuery(
		convexQuery(
			api.pickupLocations.hasAnyActive,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const dueByDay = useQuery(
		convexQuery(
			api.orders.countDueByDay,
			retailer
				? {
						retailerId: retailer._id,
						fromMyt: todayMytMidnight(),
						days: PLAN_AHEAD_DAYS,
					}
				: "skip",
		),
	).data;
	const creditBalance = useQuery(
		convexQuery(
			api.credits.getBalance,
			retailer
				? { retailerId: retailer.actingAsAdmin ? retailer._id : undefined }
				: "skip",
		),
	).data;

	const [qrOpen, setQrOpen] = useState(false);
	const { stamp: markLinkShared } = useChecklistStamp(
		api.retailers.markLinkShared,
	);

	if (!retailer) return <HomeSkeleton />;
	// `products` decides the whole layout (new vs waiting vs steady), so hold
	// the skeleton until it resolves rather than flipping after first paint.
	if (products === undefined) return <HomeSkeleton />;

	const storefrontUrl = buildStorefrontUrl(retailer.slug);
	const currency = retailer.currency;

	function stampShare() {
		void markLinkShared().catch(() => {
			// ignore — the seller still copied / saw the QR
		});
	}

	const hasWaPhone = Boolean(retailer.waPhone?.trim());
	const hasProduct = (products?.length ?? 0) > 0;
	const hasPayment = (retailer.paymentMethods?.length ?? 0) > 0;
	const activatedAt = retailer.activatedAt;
	const activated = Boolean(activatedAt);
	const linkShared = Boolean(retailer.linkSharedAt);
	const subscription = retailer.subscription;
	const subscribed = hasSubscribed(subscription);
	const freePeriod = freePeriodState(subscription, Date.now());
	const hasPickupLocation = pickupStatus?.hasAny ?? false;
	const pickupSetupSeen = retailer.pickupSetupSeen ?? false;

	const checklistItems: Omit<ChecklistItem, "step">[] = [
		{
			key: "wa",
			done: hasWaPhone,
			icon: Phone,
			title: "Add your WhatsApp number",
			shortTitle: "WhatsApp number",
			why: "Shoppers tap Checkout and their cart arrives as a WhatsApp message to this number. Without it, orders can't reach you.",
			time: "~1 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "whatsapp",
		},
		{
			key: "product",
			done: hasProduct,
			icon: Package,
			title: "Add your products",
			shortTitle: "products",
			why: "Add products one at a time, or import your whole catalogue from a spreadsheet in one go — you'll get both options on the Products page.",
			time: "~5 min",
			cta: "Add products",
			to: "/app/products",
		},
		{
			key: "payment",
			done: hasPayment,
			icon: CreditCard,
			title: "Add payment details",
			shortTitle: "payment details",
			why: PAYMENT_STEP_WHY[retailer.country],
			time: "~2 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "payments",
		},
		{
			key: "share",
			done: linkShared || activated,
			icon: Share2,
			title: "Share your store link",
			shortTitle: "store link",
			why: "Setup is only half the job — orders start when customers can reach your store. Copy your link (or grab the QR) and put it where buyers already see you.",
			time: "~1 min",
			cta: "",
			to: "",
		},
		{
			key: "greeting",
			done: retailer.onboardingGreetingSetup ?? false,
			icon: MessageCircle,
			title: "Auto-reply when customers message you directly",
			shortTitle: "auto-reply",
			why: "Set a free greeting on your WhatsApp Business app so customers who message your personal number get your store link instantly — before you even pick up your phone.",
			time: "~2 min",
			cta: "",
			to: "",
			optional: true,
		},
		{
			key: "fulfilment",
			done: pickupSetupSeen || hasPickupLocation,
			icon: MapPin,
			title: "Set up delivery & pickup",
			shortTitle: "delivery & pickup",
			why: "Delivery is on by default — buyers just type their address. Add self-collect points if you offer pickup, or switch to pickup-only. You decide how buyers get their order.",
			time: "~2 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "fulfilment" as const,
			optional: true,
		},
		{
			key: "subscribe",
			done: subscribed,
			icon: Sparkles,
			shortTitle: "your plan",
			...subscribeStepCopy(freePeriod),
			time: "~2 min",
			to: "/app/settings",
			tab: "billing",
		},
	];

	const requiredSteps: ChecklistItem[] = checklistItems
		.filter((item) => !item.optional)
		.map((item, i) => ({ ...item, step: i + 1 }));
	const optionalSteps: ChecklistItem[] = checklistItems
		.filter((item) => item.optional)
		.map((item) => ({ ...item, step: 0 }));

	const completedCount = requiredSteps.filter((c) => c.done).length;
	const requiredDone = requiredSteps.every((c) => c.done);
	const showCelebration =
		activatedAt !== undefined &&
		Date.now() - activatedAt < ACTIVATION_CELEBRATION_MS;

	/** Which of the page's shapes this store is in. */
	const phase: "new" | "waiting" | "first" | "steady" =
		completedCount === 0
			? "new"
			: !activated
				? "waiting"
				: showCelebration
					? "first"
					: "steady";

	const counts = inboxSnapshot?.counts;
	const countsLoading = inboxSnapshot === undefined;
	// The SAME rule the product card prints as "Sold out" (`app.products.index`),
	// so the row and the list it opens can never disagree. `p.stock` does not
	// exist on this payload — reading it made the test `(undefined ?? 0) <= 0`,
	// which is true for every product, so the row counted the whole catalogue.
	const outOfStock = (products ?? []).filter(
		(p) => p.active && !p.inStock,
	).length;

	// Credits: tone decides WHERE the card goes (decision 6), so the page's
	// layout states the urgency before the seller reads a word of it.
	const tone =
		creditBalance && creditBalance !== null
			? creditTone(creditBalance.total, creditBalance.periodGrant)
			: null;
	// One Balances card (z8r3fdx34j): credits + courier wallets, placed by
	// whichever half is more urgent.
	const wallets = deliveries?.wallets ?? [];
	const placement = balancesPlacement(tone, wallets);
	const creditCard = (
		<BalancesCard
			retailer={retailer}
			wallets={wallets}
			showCredits={Boolean(creditBalance)}
		/>
	);
	const outOfCredits = tone === "out";

	const renderChecklistRow = (
		item: ChecklistItem,
		expanded: boolean,
		onToggle?: () => void,
	) => {
		if (item.key === "greeting")
			return (
				<GreetingChecklistRow
					key={item.key}
					item={item}
					expanded={expanded}
					onToggle={onToggle}
					storeName={retailer.storeName}
					slug={retailer.slug}
					locale={retailer.locale}
				/>
			);
		if (item.key === "share")
			return (
				<ShareLinkChecklistRow
					key={item.key}
					item={item}
					expanded={expanded}
					storefrontUrl={storefrontUrl}
					slug={retailer.slug}
					onOpenQr={() => setQrOpen(true)}
				/>
			);
		return (
			<ChecklistRow
				key={item.key}
				item={item}
				expanded={expanded}
				onToggle={onToggle}
			/>
		);
	};

	const shareCard = (
		<ShareCard
			slug={retailer.slug}
			storefrontUrl={storefrontUrl}
			onCopy={stampShare}
			onOpenQr={() => {
				stampShare();
				setQrOpen(true);
			}}
		/>
	);

	const checklist = requiredDone ? null : (
		<SetupChecklist
			requiredSteps={requiredSteps}
			optionalSteps={optionalSteps}
			renderRow={renderChecklistRow}
			title={phase === "new" ? "Complete your setup" : "Finish setting up"}
		/>
	);

	const exceptionRows =
		phase === "steady" || phase === "first" ? (
			<ExceptionRows
				staleUnpaid={{
					count: counts?.unpaidStale ?? 0,
					amount: counts?.unpaidStaleAmount ?? 0,
					oldestAt: counts?.unpaidStaleOldestAt ?? 0,
				}}
				outOfStock={outOfStock}
				currency={currency}
			/>
		) : null;

	const planAheadCard =
		(phase === "steady" || phase === "first") &&
		dueByDay &&
		dueByDay.length > 0 ? (
			<PlanAheadCard days={dueByDay} todayStart={todayMytMidnight()} />
		) : null;

	const salesSection = canSeeInsights ? (
		<SalesSection
			retailerId={retailer._id}
			currency={currency}
			period={period}
			exceptions={exceptionRows}
			planAhead={planAheadCard}
			onPeriodChange={(next) =>
				navigate({
					search: next === "7d" ? {} : { p: next },
					replace: true,
					// The chips sit beside the hero, far down the page. Without this
					// the router restores scroll to the top on every tap, so the
					// seller is thrown away from the figures they just changed.
					resetScroll: false,
				})
			}
		/>
	) : null;

	const strip = (
		<ActionStrip
			loading={countsLoading}
			newCount={counts?.new ?? 0}
			dueTodayCount={counts?.dueToday ?? 0}
			unpaidCount={counts?.unpaid ?? 0}
			unpaidAmount={counts?.unpaidAmount ?? 0}
			currency={currency}
			paused={outOfCredits}
		/>
	);

	return (
		/*
		 * Desktop gets a READING WIDTH, not the full window (z8r3fdnt5u, absorbed
		 * here). Stretched edge to edge, the action strip's three cells grew to
		 * ~470px each around a two-digit number, and the hero's daily bars spread
		 * across ~1090px — a chart so wide that six quiet days read as a broken
		 * axis rather than a quiet week. The three insight cards still go 3-up
		 * inside it, which is the rail the board draws.
		 */
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:gap-8">
			<HomeGreeting
				retailer={retailer}
				actions={
					<>
						<Button asChild variant="outline" size="sm" className="h-10">
							<a
								href={`/${retailer.slug}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								<ExternalLink className="size-4" aria-hidden="true" />
								Open store
							</a>
						</Button>
						<Button asChild size="sm" className="h-10">
							<Link to="/app/checkout">
								<Plus className="size-4" aria-hidden="true" />
								New order
							</Link>
						</Button>
					</>
				}
			/>

			{/* Out of credits: above everything, because nothing below it can be
			    acted on until it is fixed. */}
			{placement === "top" ? creditCard : null}

			<WhiteGloveCard slug={retailer.slug} />
			{/* Above everything the seller does daily, because a wrong country
			    makes every price and rail wrong. */}
			<CountrySetupPanel
				variant="banner"
				onGoToFix={(tab, key) =>
					navigate({ to: "/app/settings", search: { tab, fix: key } })
				}
			/>

			{/* A REFERRED store, until its first invoice is paid: who invited it
			    and what starting the plan brings — above the welcome card and
			    the checklist, the first thing it reads (docs/referrals.md § The
			    push). Renders nothing for everyone else. */}
			<ReferralWelcomeCard retailerId={retailer._id} />

			{phase === "new" ? <WelcomeCard slug={retailer.slug} /> : null}

			{phase === "first" && activatedAt !== undefined ? (
				<FirstOrderCelebration
					slug={retailer.slug}
					storeName={retailer.storeName}
				/>
			) : null}

			{phase !== "new" && phase !== "waiting" ? strip : null}
			{placement === "under-strip" ? creditCard : null}

			{/* The share card LEADS while the store is waiting for its first order
			    — at that moment it is the only thing that can start one. */}
			{phase === "waiting" ? shareCard : null}

			{/* Before the first order the checklist IS the page's job, so it leads.
			    Once money exists, sales lead and setup follows — the order the
			    Onboarding-3 board draws. */}
			{phase === "new" || phase === "waiting" ? checklist : null}

			{phase === "waiting" ? <EmptySalesCard /> : null}
			{phase === "new" || phase === "waiting" ? null : salesSection}
			{/* Without the insights grant there is no Sales section to host the
			    rail, so the operational half still renders on its own. */}
			{!canSeeInsights && phase !== "new" && phase !== "waiting" ? (
				<>
					{exceptionRows}
					{planAheadCard}
				</>
			) : null}
			{/* The orders followed out the door — after the money and what
			    needs a look, before setup (86eye9xd4, 6A). */}
			{phase !== "new" && phase !== "waiting" && deliveries ? (
				<DeliveriesHomeCard overview={deliveries} />
			) : null}
			{phase === "new" || phase === "waiting" ? null : checklist}

			<section className="flex flex-col gap-3">
				<h2 className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight lg:text-xl">
					<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
						<Store className="size-3.5" aria-hidden="true" />
					</span>
					Your store
				</h2>
				{/* Same rule as the insight row above — the credit card and the
				    share card end level. */}
				<div className="grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]">
					{placement === "store" ? creditCard : null}
					{phase === "waiting" ? null : shareCard}
				</div>
			</section>

			{/* Referring another SELLER (z8r3fdfp97) — its own section, not part
			    of "Your store" (that card shares the store with buyers), and
			    last because it is never urgent. Renders nothing on a trial. */}
			<ReferCard
				retailerId={retailer._id}
				highlight={spot === "refer" ? "spotlight" : undefined}
			/>

			<StorefrontQrDialog
				open={qrOpen}
				onClose={() => setQrOpen(false)}
				storeName={retailer.storeName}
				storefrontUrl={storefrontUrl}
			/>
		</div>
	);
}
