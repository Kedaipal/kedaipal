import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { AlertTriangle, Share2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import type { ProductMetric } from "../../convex/lib/insights";
import { PageHeader } from "../components/dashboard/page-header";
import { DateRangeControl } from "../components/insights/date-range-control";
import { KpiRow } from "../components/insights/kpi-row";
import { LockedTeaser } from "../components/insights/locked-teaser";
import { PaymentDonut } from "../components/insights/payment-donut";
import { RevenueTrend } from "../components/insights/revenue-trend";
import { TopProducts } from "../components/insights/top-products";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import {
	buildInsightsView,
	pickBucketing,
	rangeForPreset,
} from "../lib/insights-view";
import { hasFeature } from "../lib/subscription";

export const Route = createFileRoute("/app/insights")({
	component: InsightsRoute,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function InsightsRoute() {
	const retailer = useDashboardRetailer();
	const initial = rangeForPreset("30d");
	const [range, setRange] = useState(initial);
	const [metric, setMetric] = useState<ProductMetric>("revenue");

	const currency = retailer?.currency ?? "MYR";
	const hasAccess = hasFeature(retailer?.subscription, "insights");

	const { from, to } = range;
	const bucketing = pickBucketing(from, to);
	const today = todayMytMidnight();
	const includeToday = to >= today;
	// The heavy query never sees the open day: clamp its end to yesterday.
	const closedTo = Math.min(to, today - DAY_MS);
	const hasClosed = closedTo >= from;

	const rangeResult = useQuery(
		api.analytics.getInsightsRange,
		retailer && hasAccess && hasClosed
			? { retailerId: retailer._id, from, to: closedTo, bucketing }
			: "skip",
	);
	const todayResult = useQuery(
		api.analytics.getTodayStats,
		retailer && hasAccess && includeToday
			? { retailerId: retailer._id }
			: "skip",
	);

	if (!retailer) return null;

	const header = (
		<>
			<PageHeader
				title="Insights"
				subtitle="Revenue, best sellers & trends — earned vs collected"
			/>
			<div className="flex min-w-0 flex-col lg:hidden">
				<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
					Insights
				</h2>
				<p className="text-[13px] text-muted-foreground">
					Revenue, best sellers & trends
				</p>
			</div>
		</>
	);

	// Starter (and any non-Pro): locked teaser. Gate is enforced server-side too —
	// the query returns `{ gated: true }` — so this is UX, not the boundary.
	if (!hasAccess) {
		return (
			<div className="flex flex-col gap-5 lg:gap-6">
				{header}
				<LockedTeaser currency={currency} slug={retailer.slug} />
			</div>
		);
	}

	const serverGated =
		(rangeResult && "gated" in rangeResult && rangeResult.gated) ||
		(todayResult && "gated" in todayResult && todayResult.gated);
	if (serverGated) {
		return (
			<div className="flex flex-col gap-5 lg:gap-6">
				{header}
				<LockedTeaser currency={currency} slug={retailer.slug} />
			</div>
		);
	}

	const rangeLoading = hasClosed && rangeResult === undefined;
	const todayLoading = includeToday && todayResult === undefined;
	const loading = rangeLoading || todayLoading;

	const view = buildInsightsView({
		from,
		to,
		bucketing,
		range: rangeResult && !rangeResult.gated ? rangeResult : null,
		today: todayResult && !todayResult.gated ? todayResult : null,
		includeToday,
	});

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			{header}

			<DateRangeControl
				from={from}
				to={to}
				onChange={(f, t) => setRange({ from: f, to: t })}
			/>

			{view.capped ? (
				<div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
					<AlertTriangle className="mt-0.5 size-4 shrink-0" />
					<span>
						This range has more orders than we can total in one pass, so the
						figures below are a partial view. Pick a shorter range for exact
						numbers.
					</span>
				</div>
			) : null}

			{loading ? (
				<InsightsSkeleton />
			) : view.orderCount === 0 ? (
				<EmptyState newSeller={!retailer.activatedAt} />
			) : (
				<>
					<KpiRow
						earned={view.earned}
						collected={view.collected}
						orderCount={view.orderCount}
						aov={view.aov}
						currency={currency}
					/>
					<RevenueTrend
						trend={view.trend}
						bucketing={view.bucketing}
						currency={currency}
					/>
					<div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
						<TopProducts
							products={view.products}
							metric={metric}
							onMetricChange={setMetric}
							currency={currency}
						/>
						<PaymentDonut
							payments={view.payments}
							collected={view.collected}
							currency={currency}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function EmptyState({ newSeller }: { newSeller: boolean }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
				<Share2 className="size-5" />
			</div>
			{newSeller ? (
				<>
					<p className="font-medium">No sales yet</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						Your insights fill in as orders come through. Share your store link
						to land your first order.
					</p>
					<Link
						to="/app"
						className="tap-target mt-1 inline-flex items-center rounded-lg bg-accent px-4 text-sm font-semibold text-primary-foreground"
					>
						Share your store
					</Link>
				</>
			) : (
				<>
					<p className="font-medium">No orders in this range</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						Nothing was ordered in the dates you picked. Try a wider range.
					</p>
				</>
			)}
		</div>
	);
}

function InsightsSkeleton() {
	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((n) => (
					<Skeleton key={n} className="h-24 rounded-2xl" />
				))}
			</div>
			<Skeleton className="h-64 rounded-2xl" />
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-72 rounded-2xl" />
				<Skeleton className="h-72 rounded-2xl" />
			</div>
		</div>
	);
}
