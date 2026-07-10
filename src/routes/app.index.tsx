import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowRight,
	Banknote,
	Bell,
	Building2,
	CalendarCheck,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	CreditCard,
	ExternalLink,
	LineChart,
	Lock,
	type LucideIcon,
	MapPin,
	MessageCircle,
	Music2,
	Package,
	Phone,
	Printer,
	QrCode,
	Share2,
	Sparkles,
	Store,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../convex/_generated/api";
import { FirstOrderCelebration } from "../components/dashboard/first-order-celebration";
import { GreetingChecklistRow } from "../components/dashboard/greeting-checklist-row";
import { PageHeaderSkeleton } from "../components/dashboard/page-header";
import { ShareLinkChecklistRow } from "../components/dashboard/share-link-checklist-row";
import {
	type OrderStatus as AnchorStatus,
	StatusBadge,
} from "../components/dashboard/status-badge";
import { StorefrontQrDialog } from "../components/dashboard/storefront-qr-dialog";
import { WhiteGloveCard } from "../components/dashboard/white-glove-card";
import { ShopeeIcon } from "../components/icons/shopee-icon";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import {
	formatPrice,
	formatPriceCompact,
	formatRelativeTime,
} from "../lib/format";
import {
	type DeliveryMethod,
	type OrderStatus,
	resolveAnchorLabel,
	resolveCurrentStage,
	resolveStages,
	type StatusLabels,
	stageLabel,
} from "../lib/orderStatus";
import { storefrontUrl as buildStorefrontUrl } from "../lib/storefront-url";
import { hasFeature, hasSubscribed, trialDaysLeft } from "../lib/subscription";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/")({
	component: DashboardHome,
});

/**
 * How long the first-order celebration stays on the dashboard after activation.
 * A transient "you're live!" moment that self-clears — no stored dismissal state
 * needed (we just compare against `retailer.activatedAt`).
 */
const ACTIVATION_CELEBRATION_MS = 7 * 24 * 60 * 60 * 1000;

function DashboardSkeleton() {
	return (
		<div className="flex flex-col gap-6 lg:gap-8">
			<PageHeaderSkeleton hasSubtitle />
			{/* Hero section */}
			<section className="rounded-3xl border border-border bg-card p-6">
				<div className="flex flex-col gap-3">
					<Skeleton className="h-3 w-24" />
					<div className="flex items-center gap-3">
						<Skeleton className="h-14 w-14 rounded-2xl" />
						<Skeleton className="h-7 w-40" />
					</div>
					<Skeleton className="h-4 w-56" />
					<div className="mt-2 flex gap-2">
						<Skeleton className="h-11 flex-1 rounded-md" />
						<Skeleton className="h-11 flex-1 rounded-md" />
						<Skeleton className="h-11 w-11 rounded-md" />
					</div>
				</div>
			</section>

			{/* Stats grid */}
			<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((n) => (
					<div
						key={n}
						className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
					>
						<Skeleton className="h-8 w-8 rounded-lg" />
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-7 w-10" />
							<Skeleton className="h-3 w-16" />
							<Skeleton className="h-3 w-20" />
						</div>
					</div>
				))}
			</section>

			{/* Recent orders */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
				<div className="flex items-center justify-between">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
				{[0, 1, 2].map((n) => (
					<div
						key={n}
						className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
					>
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-3 w-32" />
						</div>
						<div className="flex flex-col items-end gap-1.5">
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-4 w-14 rounded-full" />
						</div>
					</div>
				))}
			</section>
		</div>
	);
}

function DashboardHome() {
	const retailer = useDashboardRetailer();
	const products = useQuery(
		api.products.listAll,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	// One inbox snapshot powers the whole "today strip" + attention list — the
	// same counts seam the orders inbox subscribes to (see orders.searchOrders).
	const inboxSnapshot = useQuery(
		api.orders.searchOrders,
		retailer
			? { retailerId: retailer._id, bucket: "all" as const, limit: 1 }
			: "skip",
	);
	const pickupStatus = useQuery(
		api.pickupLocations.hasAnyActive,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	const recentOrdersPage = useQuery(
		api.orders.listByRetailer,
		retailer
			? {
					retailerId: retailer._id,
					paginationOpts: { numItems: 5, cursor: null },
				}
			: "skip",
	);
	const [copied, setCopied] = useState(false);
	const [qrOpen, setQrOpen] = useState(false);
	// Which "Optional extras" row is expanded (accordion — one at a time, all
	// collapsed by default so the optional group stays compact).
	const [openOptional, setOpenOptional] = useState<string | null>(null);
	const markLinkShared = useMutation(api.retailers.markLinkShared);

	if (!retailer) return <DashboardSkeleton />;

	const productsLoading = products === undefined;
	const countsLoading = inboxSnapshot === undefined;
	const recentOrdersLoading = recentOrdersPage === undefined;

	// `products` determines `isNew` / `requiredDone`, which switches the entire
	// layout (welcome banner vs. hero vs. checklist phase). Hold the skeleton until
	// it resolves to avoid a jarring flip after first paint.
	if (productsLoading) return <DashboardSkeleton />;

	const storefrontUrl = buildStorefrontUrl(retailer.slug);

	// Copying the link or opening the QR — from anywhere on the dashboard (hero,
	// activation banner, or the checklist share step) — is the soft "shared" proxy
	// that stamps `linkSharedAt` and completes the share step. Fire-and-forget so a
	// failed stamp never blocks the action; idempotent server-side.
	function stampShare() {
		void markLinkShared({}).catch(() => {
			// ignore — the seller still copied / saw the QR
		});
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(storefrontUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
			stampShare();
		} catch {
			// ignore
		}
	}

	function openQr() {
		stampShare();
		setQrOpen(true);
	}

	const hasWaPhone = Boolean(retailer.waPhone?.trim());
	const productCount = products?.length ?? 0;
	const hasProduct = productCount > 0;
	const hasPayment = (retailer.paymentMethods?.length ?? 0) > 0;
	// Activation funnel. `activated` (first confirmed order) is the real finish
	// line; `linkShared` is the soft "shared their link" proxy. Once activated, the
	// share step counts as done regardless of the proxy.
	const activatedAt = retailer.activatedAt;
	const activated = Boolean(activatedAt);
	const linkShared = Boolean(retailer.linkSharedAt);

	// Onboarding "complete" gate: the vendor has converted from the 14-day trial
	// to a paid plan (subscribe step). Derived from the embedded subscription —
	// no separate stamp needed. Trial vendors stay `trialing` until first payment.
	const subscription = retailer.subscription;
	const subscribed = hasSubscribed(subscription);
	const trialLeft =
		subscription?.status === "trialing"
			? trialDaysLeft(subscription.trialEndsAt, Date.now())
			: null;

	// Recent-order badges share the seller's status vocabulary. Dashboard chrome
	// is EN-only, so resolve in EN with the retailer's primary fulfilment method.
	const statusLabels = retailer.statusLabels as StatusLabels | undefined;
	const retailerMethod: DeliveryMethod = retailer.offerSelfCollect
		? "self_collect"
		: "delivery";
	const stages = resolveStages({
		orderStages: retailer.orderStages,
		labels: statusLabels,
		deliveryMethod: retailerMethod,
	});

	// The Fulfilment step is shown to EVERY retailer — delivery is universal, and
	// this is where a delivery-only seller learns pickup-only is even an option.
	// Two paths dismiss it (reusing the existing pickupSetupSeen signal — the
	// Fulfilment tab sets it on mount):
	//   1. The retailer opens the Fulfilment settings tab — pickupSetupSeen flips
	//      true, step shows as strikethrough done.
	//   2. The retailer adds an active pickup location — hasAnyActive flips true.
	const hasPickupLocation = pickupStatus?.hasAny ?? false;
	const pickupSetupSeen = retailer.pickupSetupSeen ?? false;

	// Step numbers are derived from position below (not hardcoded), so any
	// conditional item being excluded auto-renumbers the rest with no gaps.
	const checklistItems: Omit<ChecklistItem, "step">[] = [
		{
			key: "wa",
			done: hasWaPhone,
			icon: Phone,
			title: "Add your WhatsApp number",
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
			why: "Selling 20+ items? Import your whole catalogue from a spreadsheet in one go — no typing them in one by one. Or add a single product to start.",
			time: "~5 min",
			cta: "Import products",
			to: "/app/products/import",
			secondaryCta: "Add one product",
			secondaryTo: "/app/products/new",
		},
		{
			key: "payment",
			done: hasPayment,
			icon: CreditCard,
			title: "Add payment details",
			why: "Your bank account or DuitNow QR is included automatically in the order confirmation message sent to every shopper.",
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
			why: "Setup is only half the job — orders start when customers can reach your store. Copy your link (or grab the QR) and put it where buyers already see you.",
			time: "~1 min",
			// Interactive row (copy / QR) — handled by ShareLinkChecklistRow, not a link.
			cta: "",
			to: "",
		},
		{
			key: "greeting",
			done: retailer.onboardingGreetingSetup ?? false,
			icon: MessageCircle,
			title: "Auto-reply when customers message you directly",
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
			why: "Delivery is on by default — buyers just type their address. Add self-collect points if you offer pickup, or switch to pickup-only. You decide how buyers get their order.",
			time: "~2 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "fulfilment" as const,
			optional: true,
		},
		{
			// The capstone: onboarding isn't "complete" until the trial vendor
			// converts to a paid plan. `subscribed` reads off the embedded
			// subscription (trialing → not yet; comped pilots already count).
			key: "subscribe",
			done: subscribed,
			icon: Sparkles,
			title: "Subscribe to a plan",
			why:
				trialLeft !== null
					? `You're on a free 14-day trial — ${trialLeft} day${trialLeft === 1 ? "" : "s"} left. Subscribe to a plan to keep your store live and accepting orders after the trial ends.`
					: "Subscribe to a plan to keep your store live and accepting orders — pick Starter, Pro, or Scale.",
			time: "~2 min",
			cta: "Choose your plan",
			to: "/app/settings",
			tab: "billing",
		},
	];

	// Required steps drive the must-do path + progress; they're numbered 1..N.
	// Optional steps (greeting, fulfilment) sit in a lighter "Optional extras"
	// group below — never numbered, never block completion.
	const requiredSteps: ChecklistItem[] = checklistItems
		.filter((item) => !item.optional)
		.map((item, i) => ({ ...item, step: i + 1 }));
	const optionalSteps: ChecklistItem[] = checklistItems
		.filter((item) => item.optional)
		.map((item) => ({ ...item, step: 0 }));

	const completedCount = requiredSteps.filter((c) => c.done).length;
	const isNew = completedCount === 0;

	// Onboarding is "complete" only when every REQUIRED step is done — and the
	// final required step is "Subscribe to a plan", so the checklist stays up
	// (even after setup + first order) until the trial vendor converts to paid.
	const requiredDone = requiredSteps.every((c) => c.done);
	// First-order milestone (`activatedAt`) is a SEPARATE, transient overlay — it
	// celebrates activation for a window regardless of subscription state, so a
	// vendor who lands order #1 mid-trial gets the moment while still being nudged
	// to subscribe below.
	const showCelebration =
		activatedAt !== undefined &&
		Date.now() - activatedAt < ACTIVATION_CELEBRATION_MS;

	const counts = inboxSnapshot?.counts;
	const newCount = counts?.new ?? 0;
	const dueTodayCount = counts?.dueToday ?? 0;
	const unpaidCount = counts?.unpaid ?? 0;
	const unpaidAmount = counts?.unpaidAmount ?? 0;
	const currency = retailer.currency ?? "MYR";
	const recentOrders = recentOrdersPage?.page ?? [];
	const anythingNeedsAttention =
		newCount > 0 || dueTodayCount > 0 || unpaidCount > 0;

	// Map a checklist item to its row variant — the "share" and "greeting" steps
	// are interactive self-contained cards, the rest are links. `onToggle` (only
	// passed for the optional group) makes a collapsed row expand on tap instead
	// of auto-expanding the active one.
	const renderChecklistRow = (
		item: ChecklistItem,
		expanded: boolean,
		onToggle?: () => void,
	) => {
		if (item.key === "greeting") {
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
		}
		if (item.key === "share") {
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
		}
		return (
			<ChecklistRow
				key={item.key}
				item={item}
				expanded={expanded}
				onToggle={onToggle}
			/>
		);
	};

	return (
		<div className="flex flex-col gap-6 lg:gap-8">
			{/* Desktop greeting header — leads with the store's own logo so the
			    dashboard feels like the vendor's, not generic chrome. */}
			<div className="hidden items-center gap-4 border-b border-border pb-5 lg:flex">
				<StoreAvatar
					retailer={retailer}
					className="size-14 rounded-2xl text-xl"
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<h1 className="truncate font-heading text-2xl font-extrabold leading-tight tracking-tight">
						{timeGreeting()}, {retailer.storeName}
					</h1>
					<p className="text-sm text-muted-foreground">{formatTodayLong()}</p>
				</div>
			</div>
			{/* Greeting header — mobile. */}
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="flex min-w-0 flex-col">
					<h2 className="truncate font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						{timeGreeting()}, {retailer.storeName}
					</h2>
					<span className="text-[13px] text-muted-foreground">
						{formatTodayLong()}
					</span>
				</div>
				<Link
					to="/app/settings"
					search={{ tab: "store" as const }}
					aria-label="Store settings"
				>
					<StoreAvatar retailer={retailer} className="size-10 rounded-2xl" />
				</Link>
			</div>
			<WhiteGloveCard slug={retailer.slug} />
			{/* Welcome banner — only for brand-new users */}
			{isNew ? (
				<section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent/20 via-accent/10 to-background p-6 lg:max-w-2xl">
					<div
						className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl"
						aria-hidden="true"
					/>
					<div className="relative flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-accent">
							Welcome to Kedaipal 👋
						</p>
						<h2 className="text-2xl font-bold leading-snug">
							Let's get your store ready
						</h2>
						<p className="text-sm text-muted-foreground">
							Your storefront is live at{" "}
							<span className="font-mono text-foreground">
								kedaipal.com/{retailer.slug}
							</span>
							. Complete the steps below and you'll be accepting WhatsApp orders
							in minutes.
						</p>
					</div>
				</section>
			) : (
				/* Today strip — three tappable counts that answer the morning
				   questions (what's due, what's new, who hasn't paid) and deep-link
				   into the pre-filtered inbox. Due-today gets the hero cell. */
				<section className="grid grid-cols-3 gap-2 lg:max-w-2xl">
					<Link
						to="/app/orders"
						search={{ fwin: "today" as const }}
						className="flex flex-col gap-0.5 rounded-2xl bg-foreground px-3.5 py-3 text-background transition-opacity hover:opacity-95"
					>
						{countsLoading ? (
							<Skeleton className="h-7 w-8 bg-background/20" />
						) : (
							<span className="font-heading text-[22px] font-extrabold leading-tight text-accent">
								{dueTodayCount}
							</span>
						)}
						<span className="text-[11px] font-semibold text-background/75">
							Due today
						</span>
					</Link>
					<Link
						to="/app/orders"
						search={{ bucket: "new" as const }}
						className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/5"
					>
						{countsLoading ? (
							<Skeleton className="h-7 w-8" />
						) : (
							<span
								className={`font-heading text-[22px] font-extrabold leading-tight ${newCount > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}
							>
								{newCount}
							</span>
						)}
						<span className="text-[11px] font-semibold text-muted-foreground">
							New orders
						</span>
					</Link>
					<Link
						to="/app/orders"
						search={{ pay: ["unpaid", "claimed"] as ("unpaid" | "claimed")[] }}
						className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/5"
					>
						{countsLoading ? (
							<Skeleton className="h-7 w-8" />
						) : (
							<span className="font-heading text-[22px] font-extrabold leading-tight">
								{unpaidCount}
							</span>
						)}
						<span className="text-[11px] font-semibold text-muted-foreground">
							Unpaid
						</span>
					</Link>
				</section>
			)}

			{/* Share card — the dashed "ticket" from the landing page. Always the
			    top verb for a live store: put the link where buyers already are. */}
			{!isNew ? (
				<section className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-foreground/20 bg-card p-4 lg:max-w-2xl">
					<div className="flex items-center justify-between gap-3">
						<div className="flex min-w-0 flex-col gap-0.5">
							<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
								Your store link
							</span>
							<span className="truncate font-mono text-sm font-medium">
								kedaipal.com/
								<span className="kp-highlight">{retailer.slug}</span>
							</span>
						</div>
						<Button
							variant="secondary"
							size="icon"
							className="size-11 shrink-0 rounded-xl"
							onClick={openQr}
							aria-label="Show QR code"
						>
							<QrCode className="size-5" />
						</Button>
					</div>
					<div className="flex gap-2">
						<Button onClick={copy} className="h-11 flex-1">
							{copied ? "Copied!" : "Copy link"}
						</Button>
						<Button asChild variant="outline" className="h-11 flex-1">
							<a
								href={`/${retailer.slug}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								<ExternalLink className="size-4" />
								Open live
							</a>
						</Button>
					</div>
				</section>
			) : null}

			<StorefrontQrDialog
				open={qrOpen}
				onClose={() => setQrOpen(false)}
				storeName={retailer.storeName}
				storefrontUrl={storefrontUrl}
			/>

			{/* Promote your store — self-serve A4 QR poster. Sits with the other
			    share actions in both the new-user and returning-user layouts. */}
			<Link
				to="/app/poster"
				className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/5 lg:max-w-2xl"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<Printer className="size-5" aria-hidden="true" />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="text-sm font-semibold">Promote your store</span>
					<span className="text-xs text-muted-foreground">
						Print a free A4 poster with QR codes for counter and online orders
					</span>
				</span>
				<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
			</Link>

			{/* Insights — the "what actually sells / how much did I make" surface.
			    Pro feature; Starter still sees the card (lock-badged) as the upsell. */}
			<Link
				to="/app/insights"
				className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/5 lg:max-w-2xl"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<LineChart className="size-5" aria-hidden="true" />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex items-center gap-2">
						<span className="text-sm font-semibold">Insights</span>
						{hasFeature(retailer.subscription, "insights") ? null : (
							<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
								<Lock className="size-2.5" />
								Pro
							</span>
						)}
					</span>
					<span className="text-xs text-muted-foreground">
						Revenue, best sellers and trends at a glance
					</span>
				</span>
				<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
			</Link>

			{/* How it works — only for brand-new users */}
			{isNew ? (
				<section className="flex flex-col gap-3 lg:max-w-2xl">
					<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
						How Kedaipal works
					</h3>
					<div className="grid grid-cols-3 gap-2">
						{[
							{ icon: Share2, label: "You share your store link" },
							{ icon: MessageCircle, label: "Shoppers order via WhatsApp" },
							{ icon: CheckCircle2, label: "You confirm & update status" },
						].map((step, i) => (
							<div
								key={step.label}
								className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-3 text-center"
							>
								<div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
									<step.icon className="size-4" />
								</div>
								<p className="text-[11px] font-medium leading-tight text-foreground">
									{i + 1}. {step.label}
								</p>
							</div>
						))}
					</div>
				</section>
			) : null}

			{/* First-order milestone — a transient overlay, independent of the
			    checklist (a vendor can land order #1 while still mid-trial).
			    Constrained to match the primary column above (today strip / share /
			    needs-attention are all lg:max-w-2xl). */}
			{showCelebration ? (
				<div className="lg:max-w-2xl">
					<FirstOrderCelebration
						slug={retailer.slug}
						storeName={retailer.storeName}
					/>
				</div>
			) : null}

			{/* Setup checklist — stays until every required step (incl. "Subscribe
			    to a plan") is done, i.e. onboarding is complete. */}
			{!requiredDone ? (
				<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 lg:max-w-2xl">
					<div className="flex items-center justify-between">
						<h3 className="font-semibold">
							{isNew ? "Complete your setup" : "Finish setting up"}
						</h3>
						<span className="text-xs text-muted-foreground">
							{completedCount}/{requiredSteps.length} done
						</span>
					</div>
					<div
						className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
						aria-hidden="true"
					>
						<div
							className="h-full bg-accent transition-all duration-500"
							style={{
								width: `${(completedCount / requiredSteps.length) * 100}%`,
							}}
						/>
					</div>
					{/* Required path — numbered, with the active step auto-expanded. */}
					<ul className="flex flex-col gap-3">
						{requiredSteps.map((item, i) =>
							renderChecklistRow(
								item,
								!item.done && requiredSteps.slice(0, i).every((c) => c.done),
							),
						)}
					</ul>

					{/* Optional extras — lighter group, collapsed, tap-to-expand. */}
					{optionalSteps.length > 0 ? (
						<div className="flex flex-col gap-3 border-t border-border pt-4">
							<div className="flex items-center justify-between">
								<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									Optional extras
								</h4>
								<span className="text-[11px] text-muted-foreground">
									Set up anytime
								</span>
							</div>
							<ul className="flex flex-col gap-2">
								{optionalSteps.map((item) =>
									renderChecklistRow(item, openOptional === item.key, () =>
										setOpenOptional((prev) =>
											prev === item.key ? null : item.key,
										),
									),
								)}
							</ul>
						</div>
					) : null}
				</section>
			) : null}

			{/* Needs attention — actionable rows, each with a destination. Rows only
			    render when there's something to act on; the whole section hides
			    when the seller is caught up. */}
			{!isNew && !countsLoading && anythingNeedsAttention ? (
				<section className="flex flex-col gap-2 lg:max-w-2xl">
					<div className="flex items-center justify-between">
						<h3 className="font-heading text-base font-extrabold">
							Needs attention
						</h3>
						<Link
							to="/app/orders"
							className="text-[13px] font-semibold text-accent-emphasis hover:underline"
						>
							Orders →
						</Link>
					</div>
					{newCount > 0 ? (
						<AttentionRow
							to="/app/orders"
							search={{ bucket: "new" as const }}
							icon={Bell}
							tint="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
							title={`${newCount} new order${newCount === 1 ? "" : "s"} to confirm`}
							sub="From your WhatsApp storefront"
						/>
					) : null}
					{dueTodayCount > 0 ? (
						<AttentionRow
							to="/app/orders"
							search={{ fwin: "today" as const }}
							icon={CalendarCheck}
							tint="bg-accent/15 text-accent-emphasis"
							title={`${dueTodayCount} order${dueTodayCount === 1 ? "" : "s"} due today`}
							sub="See what to prepare first"
						/>
					) : null}
					{unpaidCount > 0 ? (
						<AttentionRow
							to="/app/orders"
							search={{
								pay: ["unpaid", "claimed"] as ("unpaid" | "claimed")[],
							}}
							icon={Banknote}
							tint="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
							title={`${unpaidCount} unpaid order${unpaidCount === 1 ? "" : "s"}`}
							sub={`${formatPriceCompact(unpaidAmount, currency)} outstanding`}
						/>
					) : null}
				</section>
			) : null}

			{/* Recent orders + sales channels — desktop side-by-side, mobile stacked */}
			{!isNew ? (
				<div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-6">
					<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
						<div className="flex items-center justify-between">
							<h3 className="font-heading text-base font-extrabold">
								Recent orders
							</h3>
							<Link
								to="/app/orders"
								className="text-[13px] font-semibold text-accent-emphasis hover:underline"
							>
								View all →
							</Link>
						</div>
						{recentOrdersLoading ? (
							<RecentOrdersSkeleton />
						) : recentOrders.length === 0 ? (
							<EmptyOrders hasProduct={hasProduct} />
						) : (
							<ul className="flex flex-col gap-2">
								{recentOrders.map((order) => (
									<li key={order._id}>
										<Link
											to="/app/orders/$shortId"
											params={{ shortId: order.shortId }}
											className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/5"
										>
											<div className="flex min-w-0 flex-col gap-0.5">
												<p className="truncate text-sm font-semibold">
													{order.customer?.name ?? "Anonymous"}
												</p>
												<p className="truncate text-xs text-muted-foreground">
													<span className="font-mono">#{order.shortId}</span>
													{" · "}
													{formatRelativeTime(order.createdAt)}
												</p>
											</div>
											<div className="flex shrink-0 flex-col items-end gap-1 lg:flex-row lg:items-center lg:gap-3">
												<p className="text-sm font-semibold tabular-nums">
													{formatPrice(order.total, order.currency)}
												</p>
												<StatusBadge
													status={order.status as AnchorStatus}
													label={(() => {
														const cs = resolveCurrentStage(
															{
																status: order.status,
																currentStageId: order.currentStageId,
															},
															stages,
														);
														return cs
															? stageLabel(cs, "en")
															: resolveAnchorLabel(
																	order.status as OrderStatus,
																	{
																		stages,
																		labels: statusLabels,
																		deliveryMethod: (order.deliveryMethod ??
																			"delivery") as DeliveryMethod,
																		locale: "en",
																	},
																);
													})()}
												/>
											</div>
										</Link>
									</li>
								))}
							</ul>
						)}
					</section>

					{/* Sales channels teaser */}
					<section className="flex flex-col gap-3 lg:col-span-1">
						<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
							Sales channels
						</h3>
						<div className="flex flex-col gap-2">
							<SalesChannelTeaser
								name="Shopee"
								description="Sync Shopee products & orders"
								tint="bg-[#EE4D2D]/10 text-[#EE4D2D]"
								icon={<ShopeeIcon className="size-5" />}
							/>
							<SalesChannelTeaser
								name="Lazada"
								description="Sync Lazada products & orders"
								tint="bg-[#0F146D]/10 text-[#0F146D] dark:bg-[#0F146D]/30 dark:text-[#9aa6ff]"
								icon={<Store className="size-5" />}
							/>
							<SalesChannelTeaser
								name="TikTok Shop"
								description="Sync TikTok Shop orders"
								tint="bg-foreground/10 text-foreground"
								icon={<Music2 className="size-5" />}
							/>
							<SalesChannelTeaser
								name="StoreHub"
								description="Reconcile in-store sales"
								tint="bg-[#FF7A00]/10 text-[#FF7A00]"
								icon={<Building2 className="size-5" />}
							/>
						</div>
					</section>
				</div>
			) : null}
		</div>
	);
}

type SettingsTab =
	| "store"
	| "whatsapp"
	| "payments"
	| "fulfilment"
	| "billing"
	| "integrations";

export type ChecklistItem = {
	key: string;
	step: number;
	done: boolean;
	icon: LucideIcon;
	title: string;
	why: string;
	time: string;
	cta: string;
	to: string;
	tab?: SettingsTab;
	/**
	 * Optional secondary action shown beneath the primary CTA (e.g. "add one"
	 * alongside the recommended bulk import). Only rendered in the expanded row.
	 */
	secondaryCta?: string;
	secondaryTo?: string;
	/** Renders an "Optional" pill so the seller knows they can skip. */
	optional?: boolean;
};

function ChecklistRow({
	item,
	expanded,
	onToggle,
}: {
	item: ChecklistItem;
	expanded: boolean;
	/** When provided (optional group), a collapsed row expands on tap instead of
	 * navigating; the leading badge becomes a dot + a chevron is shown. */
	onToggle?: () => void;
}) {
	const Icon = item.icon;

	if (item.done) {
		return (
			<li className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
					<CheckIcon />
				</div>
				<p className="flex-1 text-sm font-medium text-muted-foreground line-through">
					{item.title}
				</p>
				<span className="text-xs text-muted-foreground">Done</span>
			</li>
		);
	}

	if (expanded) {
		return (
			<li className="flex flex-col gap-3 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
				<div className="flex items-start gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
						<Icon className="size-4" />
					</div>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							{item.optional ? (
								<span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
									Optional
								</span>
							) : (
								<span className="text-[10px] font-bold uppercase tracking-wider text-accent">
									Step {item.step}
								</span>
							)}
							<span className="text-[10px] text-muted-foreground">
								{item.time}
							</span>
						</div>
						<p className="mt-0.5 text-sm font-semibold">{item.title}</p>
						<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
							{item.why}
						</p>
					</div>
				</div>
				<Link to={item.to} search={item.tab ? { tab: item.tab } : undefined}>
					<Button size="sm" className="h-11 w-full gap-2">
						{item.cta}
						<ArrowRight className="size-3.5" />
					</Button>
				</Link>
				{item.secondaryCta && item.secondaryTo ? (
					<Link to={item.secondaryTo}>
						<Button size="sm" variant="outline" className="h-11 w-full">
							{item.secondaryCta}
						</Button>
					</Link>
				) : null}
			</li>
		);
	}

	// Optional group: collapsed row is a tap-to-expand toggle (no number, chevron).
	if (onToggle) {
		return (
			<li>
				<button
					type="button"
					onClick={onToggle}
					className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent/5"
				>
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<Icon className="size-3" />
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</li>
		);
	}

	// Required group: collapsed row navigates straight to its destination.
	return (
		<li>
			<Link
				to={item.to}
				search={item.tab ? { tab: item.tab } : undefined}
				className="block"
			>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/5">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[10px] font-bold text-muted-foreground">
						{item.step}
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
					<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
				</div>
			</Link>
		</li>
	);
}

/** Greeting keyed to the seller's local clock (MYT in practice). */
/** Store logo when set, else the store initial on the brand navy tile. */
function StoreAvatar({
	retailer,
	className,
}: {
	retailer: { logoUrl?: string; storeName: string };
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground font-heading text-[15px] font-extrabold text-background",
				className,
			)}
			aria-hidden="true"
		>
			{retailer.logoUrl ? (
				<img src={retailer.logoUrl} alt="" className="size-full object-cover" />
			) : (
				retailer.storeName.charAt(0).toUpperCase()
			)}
		</span>
	);
}

function timeGreeting(now: Date = new Date()): string {
	const h = now.getHours();
	if (h < 12) return "Good morning";
	if (h < 18) return "Good afternoon";
	return "Good evening";
}

function formatTodayLong(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-MY", {
		weekday: "long",
		day: "numeric",
		month: "long",
	}).format(now);
}

/** One actionable "needs attention" row: icon, what, where it takes you. */
function AttentionRow({
	to,
	search,
	icon: Icon,
	tint,
	title,
	sub,
}: {
	to: string;
	search?: Record<string, unknown>;
	icon: LucideIcon;
	tint: string;
	title: string;
	sub: string;
}) {
	return (
		<Link
			to={to}
			search={search}
			className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/5"
		>
			<span
				className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tint}`}
			>
				<Icon className="size-5" aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-semibold">{title}</span>
				<span className="truncate text-xs text-muted-foreground">{sub}</span>
			</span>
			<ChevronRight
				className="size-4.5 shrink-0 text-muted-foreground/50"
				aria-hidden="true"
			/>
		</Link>
	);
}

function RecentOrdersSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1, 2].map((n) => (
				<li
					key={n}
					className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
				>
					<div className="flex min-w-0 flex-col gap-1.5">
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-3 w-32" />
					</div>
					<div className="flex shrink-0 flex-col items-end gap-1 lg:flex-row lg:items-center lg:gap-3">
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-4 w-14 rounded-full" />
					</div>
				</li>
			))}
		</ul>
	);
}

function SalesChannelTeaser({
	name,
	description,
	tint,
	icon,
}: {
	name: string;
	description: string;
	tint: string;
	icon: ReactNode;
}) {
	return (
		<Link
			to="/app/settings"
			search={{ tab: "integrations" }}
			className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-accent/5"
		>
			<div
				className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}
			>
				{icon}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<p className="truncate text-sm font-semibold">{name}</p>
					<span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
						Soon
					</span>
				</div>
				<p className="truncate text-[11px] text-muted-foreground">
					{description}
				</p>
			</div>
			<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}

function EmptyOrders({ hasProduct }: { hasProduct: boolean }) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
			<p className="text-sm font-medium">No orders yet</p>
			<p className="max-w-xs text-xs text-muted-foreground">
				{hasProduct
					? "Share your storefront link to start receiving orders via WhatsApp."
					: "Add a product first, then share your storefront link."}
			</p>
		</div>
	);
}

function CheckIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			className="h-3 w-3"
			aria-hidden="true"
		>
			<path
				fillRule="evenodd"
				d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 011.42-1.42L8 12.59l7.29-7.3a1 1 0 011.414 0z"
				clipRule="evenodd"
			/>
		</svg>
	);
}
