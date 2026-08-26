import { Link } from "@tanstack/react-router";
import { sourceLabel } from "../../../convex/lib/attribution";
import type { SourceStat } from "../../../convex/lib/insights";
import { formatPrice, formatPriceCompact } from "../../lib/format";

// Horizontal-bar breakdown of where orders come from (86eyq0eq9): the
// `?src=`/`utm_source` tag stamped at checkout, "Counter" for counter-checkout
// orders, "Direct / shared link" otherwise. Bars are weighted by EARNED
// revenue (Σ rows === the earned KPI). Same hand-rolled bar-list idiom as
// TopProducts — no chart library.
//
// The all-direct state doubles as the feature's discoverability surface: a
// seller who never tagged a link learns here that tagged links exist and
// where to make one (poster / QR dialog presets).

const DISPLAY_LIMIT = 8;

export function SourceBreakdown({
	sources,
	currency,
}: {
	sources: SourceStat[];
	currency: string;
}) {
	const ranked = sources.slice(0, DISPLAY_LIMIT);
	const max =
		ranked.length > 0 ? Math.max(...ranked.map((s) => s.revenue)) : 0;
	// Only "direct"/"counter" rows means no tagged link produced an order yet —
	// surface the how-to instead of a one-row chart stating the obvious.
	const hasTaggedOrders = sources.some(
		(s) => s.source !== "direct" && s.source !== "counter",
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5">
			<div>
				<h3 className="font-heading text-base font-extrabold">
					Where orders come from
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					Add <span className="font-mono">?src=tiktok</span> (or any tag) to
					your store link — orders from it are counted here. Presets live in
					your <Link
						to="/app/poster"
						className="font-semibold text-accent-emphasis hover:underline"
					>
						store poster
					</Link>{" "}
					and the QR dialog on Home.
				</p>
			</div>

			{ranked.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No orders in this range yet.
				</p>
			) : (
				<>
					<ul className="flex flex-col gap-3">
						{ranked.map((s) => {
							const pct = max > 0 ? Math.max(4, (s.revenue / max) * 100) : 0;
							return (
								<li key={s.source} className="flex flex-col gap-1">
									<div className="flex items-baseline justify-between gap-2">
										<span className="min-w-0 truncate text-sm font-medium">
											{sourceLabel(s.source)}
											<span className="text-muted-foreground">
												{" "}
												· {s.orderCount.toLocaleString("en-MY")}{" "}
												{s.orderCount === 1 ? "order" : "orders"}
											</span>
										</span>
										<span
											className="shrink-0 tabular-nums text-sm font-semibold"
											title={formatPrice(s.revenue, currency)}
										>
											{formatPriceCompact(s.revenue, currency)}
										</span>
									</div>
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-accent transition-all"
											style={{ width: `${pct}%` }}
										/>
									</div>
								</li>
							);
						})}
					</ul>
					{!hasTaggedOrders ? (
						<p className="text-xs text-muted-foreground">
							Every order so far arrived without a tag. Paste a tagged link in
							your TikTok bio or live chat to see which channel converts.
						</p>
					) : null}
				</>
			)}
		</div>
	);
}
