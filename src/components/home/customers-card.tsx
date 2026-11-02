import { Link } from "@tanstack/react-router";
import { ChevronRight, Moon, Users } from "lucide-react";
import { MASK_PII } from "../../lib/analytics-privacy";
import {
	customersHeadline,
	type HomePeriod,
	lapsedRegularsLine,
	PERIOD_CARD_LABEL,
} from "../../lib/home-copy";
import type { CustomerSplit } from "../../lib/insights-view";
import { cn } from "../../lib/utils";
import { InsightCard } from "./insight-card";

/**
 * Who is coming back (z8r3fdrgzj).
 *
 * The split bar is the evidence; the headline is the point. The lapsed-regulars
 * line sits underneath as the one ACTION on this card — "27 of 42 returned" is
 * interesting, "8 regulars have gone quiet" is a list to message tonight.
 */
export function CustomersCard({
	period,
	split,
	lapsed,
	quietDays,
}: {
	period: HomePeriod;
	split: CustomerSplit;
	/** From `customers.countLapsedRegulars`: undefined while loading, NULL when
	 * the reader cannot have it (Starter, or a teammate without the customers
	 * grant). Either way the line simply does not render — the lock is its
	 * absence, not an error. */
	lapsed: { count: number; capped: boolean } | undefined | null;
	quietDays: number;
}) {
	const returningPct =
		split.total > 0 ? Math.round((split.returning / split.total) * 100) : 0;
	const lapsedLine = lapsed
		? lapsedRegularsLine({
				count: lapsed.count,
				capped: lapsed.capped,
				quietDays,
			})
		: null;

	return (
		<InsightCard
			icon={Users}
			eyebrow={`Customers · ${PERIOD_CARD_LABEL[period]}`}
			headline={customersHeadline({
				period,
				returning: split.returning,
				total: split.total,
			})}
			footerLabel="See every customer"
			footerTo="/app/customers"
		>
			{split.total > 0 ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
						{/* The board's avatar stack. MASKED: Home runs Clarity session
						    recording, and an initial beside a buyer's order history is
						    still buyer identity. One character each is all the stack can
						    render anyway, so the server never sends more (Zaki, 13 Oct
						    2026 — add them, masked). `customers-card.tsx` is in the
						    MASK_PII sweep so this can't be quietly dropped. */}
						<span {...MASK_PII} className="flex items-center">
							{split.initials.map((face, i) => (
								<span
									key={face.id}
									className={cn(
										"flex size-6 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold",
										i === 0
											? "bg-primary text-background dark:text-primary-foreground"
											: i === 1
												? "bg-accent text-accent-foreground"
												: "bg-muted text-foreground",
										i > 0 && "-ml-2",
									)}
								>
									{face.letter}
								</span>
							))}
							{split.total > split.initials.length ? (
								<span className="-ml-2 flex h-6 items-center rounded-full border-2 border-card bg-muted px-1.5 text-[10px] font-bold text-muted-foreground tabular-nums">
									+{split.total - split.initials.length}
								</span>
							) : null}
						</span>
						<span className="tabular-nums">
							{split.capped ? "at least " : ""}
							{split.total} customer{split.total === 1 ? "" : "s"}
						</span>
					</div>
					<div
						className="flex h-2 overflow-hidden rounded-full bg-muted"
						role="img"
						aria-label={`${split.returning} returning customers, ${split.fresh} new`}
					>
						<span
							className="block h-full rounded-full bg-foreground"
							style={{ width: `${returningPct}%` }}
						/>
						<span className="block h-full flex-1 rounded-full bg-accent" />
					</div>
					<div className="flex items-baseline justify-between gap-2 text-xs">
						<span className="flex items-center gap-1.5">
							<span
								className="size-2 rounded-full bg-foreground"
								aria-hidden="true"
							/>
							Returning{" "}
							<strong className="font-bold tabular-nums">
								{split.returning}
							</strong>
						</span>
						<span className="flex items-center gap-1.5">
							<span
								className="size-2 rounded-full bg-accent"
								aria-hidden="true"
							/>
							New{" "}
							<strong className="font-bold tabular-nums">{split.fresh}</strong>
						</span>
					</div>
				</div>
			) : null}

			{lapsedLine ? (
				<Link
					to="/app/customers"
					className="-mx-1 flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-2.5 py-2 transition-colors hover:bg-muted"
				>
					<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
						<Moon className="size-3.5" aria-hidden="true" />
					</span>
					<span className="min-w-0 flex-1 text-xs">{lapsedLine}</span>
					<span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent-emphasis">
						See who
						<ChevronRight className="size-3.5" aria-hidden="true" />
					</span>
				</Link>
			) : null}
		</InsightCard>
	);
}
