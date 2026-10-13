import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { sourceLabel } from "../../../convex/lib/attribution";
import type { SourceStat } from "../../../convex/lib/insights";
import { formatPrice } from "../../lib/format";
import {
	type HomePeriod,
	NO_TAGGED_SOURCE_HEADLINE,
	PERIOD_CARD_LABEL,
	topSourceHeadline,
} from "../../lib/home-copy";
import {
	type HomeRange,
	type InsightsRangeSearch,
	ordersDrillSearch,
	topTaggedSource,
} from "../../lib/home-view";
import { InsightCard } from "./insight-card";

/**
 * Which link, QR or counter is actually working (z8r3fdrgzj).
 *
 * The headline names the top TAGGED source, never "direct" — see
 * `topTaggedSource`. When nothing is tagged the card stops pretending it has a
 * finding and offers the fix instead, because "Direct · 100%" is a true
 * statement that helps nobody.
 */
export function SourcesCard({
	period,
	sources,
	currency,
	insightsSearch,
	range,
}: {
	period: HomePeriod;
	sources: ReadonlyArray<SourceStat>;
	currency: string;
	insightsSearch: InsightsRangeSearch;
	/** The window the rows were counted over — each row drills into its own
	 * orders within it, the way Insights' own source rows do. */
	range: HomeRange;
}) {
	const rows = [...sources].sort((a, b) => b.revenue - a.revenue).slice(0, 4);
	if (rows.length === 0) return null;
	const top = topTaggedSource(sources);
	const max = rows.reduce((m, r) => Math.max(m, r.revenue), 0);

	return (
		<InsightCard
			icon={Compass}
			eyebrow={`Where orders come from · ${PERIOD_CARD_LABEL[period]}`}
			headline={
				top
					? topSourceHeadline({
							label: sourceLabel(top.source),
							orders: top.orderCount,
							revenue: top.revenue,
							currency,
						})
					: NO_TAGGED_SOURCE_HEADLINE
			}
			footerLabel={top ? "See every source in Insights" : undefined}
			footerTo={top ? "/app/insights" : undefined}
			footerSearch={insightsSearch}
		>
			<ul className="flex flex-col gap-2.5">
				{rows.map((r) => (
					<li key={r.source}>
						{/* Each row opens exactly its own orders in the same window —
						    the scope Insights' source rows already use, so the two
						    pages answer "which orders?" identically. */}
						<Link
							to="/app/orders"
							search={ordersDrillSearch({ range, source: r.source })}
							aria-label={`View ${r.orderCount} ${r.orderCount === 1 ? "order" : "orders"} from ${sourceLabel(r.source)}`}
							className="-mx-1 flex min-h-11 flex-col justify-center gap-1 rounded-xl px-1 transition-colors hover:bg-muted"
						>
							<span className="flex items-baseline justify-between gap-2">
								<span className="truncate text-[13px]">
									<strong className="font-semibold">
										{sourceLabel(r.source)}
									</strong>{" "}
									<span className="text-muted-foreground">
										{r.orderCount} {r.orderCount === 1 ? "order" : "orders"}
									</span>
								</span>
								<span className="shrink-0 text-[13px] font-bold tabular-nums">
									{formatPrice(r.revenue, currency)}
								</span>
							</span>
							<span className="h-1 overflow-hidden rounded-full bg-muted">
								<span
									className="block h-full rounded-full bg-foreground"
									style={{
										width: `${max > 0 ? Math.max(2, Math.round((r.revenue / max) * 100)) : 2}%`,
									}}
								/>
							</span>
						</Link>
					</li>
				))}
			</ul>
			{top ? null : (
				<Link
					to="/app/settings"
					search={{ tab: "whatsapp" }}
					className="-mx-1 mt-auto flex min-h-11 items-center text-sm font-semibold text-accent-emphasis hover:underline"
				>
					Set up tagged links
				</Link>
			)}
		</InsightCard>
	);
}
