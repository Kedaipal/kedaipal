import { Package } from "lucide-react";
import type { ProductMetric, ProductStat } from "../../../convex/lib/insights";
import { topProducts } from "../../../convex/lib/insights";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import { FilterChip } from "../ui/filter-chip";
import { Img } from "../ui/image";

// Horizontal-bar ranking of best sellers, grouped by product+variant. Toggle
// ranks by revenue or by units. Names come from the ORDER-ITEM snapshot, so a
// since-deleted product still shows its historical name (thumbnail falls back to
// a placeholder when the product/variant is gone).

const DISPLAY_LIMIT = 8;

export function TopProducts({
	products,
	metric,
	onMetricChange,
	currency,
}: {
	products: ProductStat[];
	metric: ProductMetric;
	onMetricChange: (m: ProductMetric) => void;
	currency: string;
}) {
	const ranked = topProducts(products, metric, DISPLAY_LIMIT);
	const max =
		ranked.length > 0
			? Math.max(
					...ranked.map((p) => (metric === "revenue" ? p.revenue : p.quantity)),
				)
			: 0;

	return (
		<div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5">
			{/* Title + toggle wrap to their own lines on a narrow card — the toggle
			    is a plain (non-bleeding) chip pair, NOT the page-level FilterChipRow
			    whose -mx-5 would break out of the card padding. */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-heading text-base font-extrabold">Top products</h3>
				<div className="flex shrink-0 gap-2">
					<FilterChip
						selected={metric === "revenue"}
						onClick={() => onMetricChange("revenue")}
					>
						By revenue
					</FilterChip>
					<FilterChip
						selected={metric === "quantity"}
						onClick={() => onMetricChange("quantity")}
					>
						By quantity
					</FilterChip>
				</div>
			</div>

			{ranked.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No products sold in this range.
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{ranked.map((p) => {
						const metricValue = metric === "revenue" ? p.revenue : p.quantity;
						const pct = max > 0 ? Math.max(4, (metricValue / max) * 100) : 0;
						return (
							<li key={p.key} className="flex items-center gap-3">
								<Img
									src={p.thumbnailUrl}
									alt=""
									wrapperClassName="size-10 shrink-0 rounded-xl border border-border"
									fallback={<Package className="size-4" />}
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex items-baseline justify-between gap-2">
										<span className="min-w-0 truncate text-sm font-medium">
											{p.name}
											{p.variantLabel ? (
												<span className="text-muted-foreground">
													{" "}
													· {p.variantLabel}
												</span>
											) : null}
										</span>
										<span
											className="shrink-0 tabular-nums text-sm font-semibold"
											title={
												metric === "revenue"
													? formatPrice(p.revenue, currency)
													: undefined
											}
										>
											{metric === "revenue"
												? formatPriceCompact(p.revenue, currency)
												: `${p.quantity.toLocaleString("en-MY")} sold`}
										</span>
									</div>
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-accent transition-all"
											style={{ width: `${pct}%` }}
										/>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
