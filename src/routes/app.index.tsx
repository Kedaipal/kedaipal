import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	CreditCard,
	MapPin,
	MessageCircle,
	Package,
	Phone,
	Share2,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Country } from "../../convex/lib/country";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";
import { todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import { CreditMeter } from "../components/credits/credit-meter";
import { FirstOrderCelebration } from "../components/dashboard/first-order-celebration";
import { GreetingChecklistRow } from "../components/dashboard/greeting-checklist-row";
import { ShareLinkChecklistRow } from "../components/dashboard/share-link-checklist-row";
import { StorefrontQrDialog } from "../components/dashboard/storefront-qr-dialog";
import { WhiteGloveCard } from "../components/dashboard/white-glove-card";
import { ActionStrip } from "../components/home/action-strip";
import { EmptySalesCard } from "../components/home/empty-sales-card";
import { ExceptionRows } from "../components/home/exception-rows";
import { HomeSkeleton } from "../components/home/home-skeleton";
import { PlanAheadCard } from "../components/home/plan-ahead-card";
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
import { useChecklistStamp } from "../hooks/useChecklistStamp";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { creditPlacement, creditTone } from "../lib/credits-ui";
import { type HomePeriod, parseHomePeriod } from "../lib/home-copy";
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
	validateSearch: (search: Record<string, unknown>): { p?: HomePeriod } =>
		// Only pinned when it differs from the default, so the common URL stays
		// clean — but it round-trips, so a refresh keeps the seller's window.
		search.p === undefined ? {} : { p: parseHomePeriod(search.p) },
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
	const navigate = useNavigate({ from: "/app" });
	const search = Route.useSearch();
	const period: HomePeriod = parseHomePeriod(search.p);

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
	const currency = retailer.currency ?? DEFAULT_CURRENCY;

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
	const outOfStock = (products ?? []).filter(
		(p) => (p.stock ?? 0) <= 0 && p.blockWhenOutOfStock !== false,
	).length;

	// Credits: tone decides WHERE the card goes (decision 6), so the page's
	// layout states the urgency before the seller reads a word of it.
	const tone =
		creditBalance && creditBalance !== null
			? creditTone(creditBalance.total, creditBalance.periodGrant)
			: null;
	const placement = tone ? creditPlacement(tone) : null;
	const creditCard = creditBalance ? (
		<CreditMeter variant="card" retailer={retailer} />
	) : null;
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

	const salesSection = canSeeInsights ? (
		<SalesSection
			retailerId={retailer._id}
			currency={currency}
			period={period}
			onPeriodChange={(next) =>
				navigate({
					search: next === "7d" ? {} : { p: next },
					replace: true,
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
		<div className="flex flex-col gap-6 lg:gap-8">
			<HomeGreeting retailer={retailer} />

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

			{phase === "new" ? <WelcomeCard slug={retailer.slug} /> : null}

			{phase === "first" && activatedAt !== undefined ? (
				<FirstOrderCelebration
					slug={retailer.slug}
					storeName={retailer.storeName}
				/>
			) : null}

			{phase !== "new" && phase !== "waiting" ? strip : null}
			{placement === "under-strip" ? creditCard : null}

			{phase === "steady" || phase === "first" ? (
				<ExceptionRows
					staleUnpaid={{
						count: counts?.unpaidStale ?? 0,
						amount: counts?.unpaidStaleAmount ?? 0,
						oldestAt: counts?.unpaidStaleOldestAt ?? 0,
					}}
					outOfStock={outOfStock}
					currency={currency}
				/>
			) : null}

			{/* The share card LEADS while the store is waiting for its first order
			    — at that moment it is the only thing that can start one. */}
			{phase === "waiting" ? shareCard : null}

			{checklist}

			{phase === "waiting" ? <EmptySalesCard /> : null}
			{phase === "new" ? null : phase === "waiting" ? null : salesSection}

			{phase === "steady" || phase === "first" ? (
				dueByDay && dueByDay.length > 0 ? (
					<section className="flex flex-col gap-3">
						<h2 className="font-heading text-lg font-extrabold tracking-tight">
							Plan ahead
						</h2>
						<PlanAheadCard days={dueByDay} todayStart={todayMytMidnight()} />
					</section>
				) : null
			) : null}

			<section className="flex flex-col gap-3">
				<h2 className="font-heading text-lg font-extrabold tracking-tight">
					Your store
				</h2>
				{placement === "store" ? creditCard : null}
				{phase === "waiting" ? null : shareCard}
			</section>

			<StorefrontQrDialog
				open={qrOpen}
				onClose={() => setQrOpen(false)}
				storeName={retailer.storeName}
				storefrontUrl={storefrontUrl}
			/>
		</div>
	);
}
