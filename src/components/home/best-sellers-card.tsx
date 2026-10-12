import { Trophy } from "lucide-react";
import type { ProductStat } from "../../../convex/lib/insights";
import { formatPrice } from "../../lib/format";
import {
	bestSellerHeadline,
	type HomePeriod,
	PERIOD_CARD_LABEL,
} from "../../lib/home-copy";
import { type OrdersDrillSearch, productSharePct } from "../../lib/home-view";
import { AppImage } from "../ui/app-image";
import { InsightCard } from "./insight-card";

/**
 * What is actually making the money (z8r3fdrgzj).
 *
 * Three rows, not eight: Home answers "what should I make more of", and a
 * ranked list long enough to need scanning is the Insights page's job. The
 * drill-in carries the same range so "see every product" opens the identical
 * window rather than a different one.
 */
export function BestSellersCard({
	period,
	products,
	earned,
	currency,
	insightsSearch,
}: {
	period: HomePeriod;
	products: ReadonlyArray<ProductStat>;
	earned: number;
	currency: string;
	insightsSearch: OrdersDrillSearch;
}) {
	const top = products.slice(0, 3);
	if (top.length === 0) return null;
	const lead = top[0];
	const leadShare = productSharePct(lead, earned);

	return (
		<InsightCard
			icon={Trophy}
			eyebrow={`Best sellers · ${PERIOD_CARD_LABEL[period]}`}
			headline={bestSellerHeadline({
				period,
				name: lead.name,
				sharePct: leadShare,
			})}
			footerLabel="See every product in Insights"
			footerTo="/app/insights"
			footerSearch={insightsSearch}
		>
			<ul className="flex flex-col gap-2.5">
				{top.map((p, i) => {
					const share = productSharePct(p, earned);
					const relative = leadShare > 0 ? (share / leadShare) * 100 : 0;
					return (
						<li key={p.key} className="flex items-center gap-2.5">
							<span className="relative shrink-0">
								<AppImage
									src={p.thumbnailUrl ?? undefined}
									alt=""
									sizes="48px"
									className="size-11 rounded-xl object-cover"
								/>
								<span className="absolute -bottom-1 -left-1 flex size-[18px] items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
									{i + 1}
								</span>
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-1">
								<span className="flex items-baseline justify-between gap-2">
									<span
										title={p.name}
										className="truncate text-[13px] font-semibold"
									>
										{p.name}
									</span>
									<span className="shrink-0 text-[13px] font-bold tabular-nums">
										{formatPrice(p.revenue, currency)}
									</span>
								</span>
								<span className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
									<span>{p.quantity} sold</span>
									<span className="tabular-nums">
										{Math.round(share)}% of sales
									</span>
								</span>
								<span className="h-1 overflow-hidden rounded-full bg-muted">
									<span
										className="block h-full rounded-full bg-accent"
										style={{ width: `${Math.max(2, Math.round(relative))}%` }}
									/>
								</span>
							</span>
						</li>
					);
				})}
			</ul>
		</InsightCard>
	);
}
