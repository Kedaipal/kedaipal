import { TrendingUp } from "lucide-react";
import {
	HOME_PERIODS,
	type HomePeriod,
	PERIOD_CHIP_LABEL,
	PERIOD_LOCKED_REASON,
} from "../../lib/home-copy";
import { FilterChip } from "../ui/filter-chip";

/**
 * The one period control (z8r3fdrgzj decision 5) — it governs the sales hero
 * AND the three insight cards, so the page can never show a 30-day headline
 * over a 7-day chart.
 *
 * On Starter the two longer windows are DISABLED WITH THE REASON SPOKEN
 * beneath, never hidden: a seller who cannot see that 7- and 30-day views exist
 * cannot decide whether they want them. The server is the real boundary (the
 * Pro reads return `{ gated: true }`); this is the part that explains itself.
 */
export function PeriodChips({
	value,
	onChange,
	lockedBeyondToday,
}: {
	value: HomePeriod;
	onChange: (next: HomePeriod) => void;
	/** Starter — today is free, the rest comes with Pro. */
	lockedBeyondToday: boolean;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex min-h-11 items-center gap-2">
				<h2 className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight lg:text-xl">
					{/* The house's section mark: a 26px accent tile, as every other
					    section heading on the board wears. */}
					<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
						<TrendingUp className="size-3.5" aria-hidden="true" />
					</span>
					Sales
				</h2>
				{/* A fieldset, not a div with role="group": three chips that set one
				    value ARE a group of related controls, and the semantic element
				    carries that without an ARIA patch. Default chrome reset. */}
				<fieldset
					className="m-0 ml-auto flex items-center gap-1.5 border-0 p-0"
					aria-label="Period"
				>
					{HOME_PERIODS.map((p) => {
						const locked = lockedBeyondToday && p !== "today";
						return (
							<FilterChip
								key={p}
								selected={value === p}
								disabled={locked}
								aria-label={
									locked
										? `${PERIOD_CHIP_LABEL[p]} — ${PERIOD_LOCKED_REASON}`
										: undefined
								}
								className="h-10 px-3.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-45"
								onClick={() => onChange(p)}
							>
								{PERIOD_CHIP_LABEL[p]}
							</FilterChip>
						);
					})}
				</fieldset>
			</div>
			{lockedBeyondToday ? (
				<p className="text-right text-xs text-muted-foreground">
					{PERIOD_LOCKED_REASON}
				</p>
			) : null}
		</div>
	);
}
