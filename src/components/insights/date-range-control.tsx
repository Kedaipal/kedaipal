import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	formatRangeLabel,
	INSIGHTS_PRESETS,
	type InsightsPreset,
	MAX_CUSTOM_RANGE_DAYS,
	rangeForPreset,
	rangeSpanDays,
} from "../../lib/insights-view";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { FilterChip, FilterChipRow } from "../ui/filter-chip";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "../ui/sheet";

const DAY_MS = 24 * 60 * 60 * 1000;

// A MYT-midnight epoch ↔ a local Date at that calendar day. MY users run in MYT,
// so the day components round-trip cleanly through the native calendar.
function epochToDate(epoch: number): Date {
	const [y, m, d] = ymdFromEpoch(epoch).split("-").map(Number);
	return new Date(y, m - 1, d);
}
function dateToEpoch(date: Date): number {
	const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return mytMidnightFromYmd(ymd);
}

export function DateRangeControl({
	from,
	to,
	onChange,
}: {
	from: number;
	to: number;
	onChange: (from: number, to: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<DateRange | undefined>();

	const activePreset = INSIGHTS_PRESETS.find((p) => {
		const r = rangeForPreset(p.key);
		return r.from === from && r.to === to;
	})?.key;
	const isCustom = activePreset === undefined;

	const today = todayMytMidnight();
	const earliest = today - MAX_CUSTOM_RANGE_DAYS * DAY_MS;

	function pickPreset(preset: InsightsPreset) {
		const r = rangeForPreset(preset);
		onChange(r.from, r.to);
	}

	function openCustom() {
		setDraft({ from: epochToDate(from), to: epochToDate(to) });
		setOpen(true);
	}

	function applyCustom() {
		if (!draft?.from) return;
		const f = dateToEpoch(draft.from);
		const t = dateToEpoch(draft.to ?? draft.from);
		onChange(Math.min(f, t), Math.max(f, t));
		setOpen(false);
	}

	const draftFrom = draft?.from ? dateToEpoch(draft.from) : undefined;
	const draftTo = draft?.to ? dateToEpoch(draft.to) : draftFrom;
	const draftSpan =
		draftFrom !== undefined && draftTo !== undefined
			? rangeSpanDays(draftFrom, draftTo)
			: 0;

	return (
		<FilterChipRow>
			{INSIGHTS_PRESETS.map((p) => (
				<FilterChip
					key={p.key}
					selected={activePreset === p.key}
					onClick={() => pickPreset(p.key)}
				>
					{p.label}
				</FilterChip>
			))}
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetTrigger asChild>
					<FilterChip selected={isCustom} onClick={openCustom}>
						<CalendarDays className="size-3.5" />
						{isCustom ? formatRangeLabel(from, to) : "Custom"}
					</FilterChip>
				</SheetTrigger>
				<SheetContent className="sm:max-w-fit">
					<SheetHeader>
						<SheetTitle>Custom range</SheetTitle>
					</SheetHeader>
					<div className="flex justify-center">
						<Calendar
							mode="range"
							selected={draft}
							onSelect={setDraft}
							defaultMonth={epochToDate(to)}
							max={MAX_CUSTOM_RANGE_DAYS}
							disabled={{
								after: epochToDate(today),
								before: epochToDate(earliest),
							}}
							showOutsideDays={false}
						/>
					</div>
					<div className="flex flex-col gap-3 border-t border-border pt-4">
						<p className="text-center text-sm text-muted-foreground">
							{draftFrom !== undefined ? (
								<>
									{formatRangeLabel(draftFrom, draftTo ?? draftFrom)}
									<span className="ml-1 text-xs">
										({draftSpan} day{draftSpan === 1 ? "" : "s"})
									</span>
								</>
							) : (
								"Pick a start and end day"
							)}
						</p>
						<Button
							className="tap-target w-full"
							disabled={!draft?.from}
							onClick={applyCustom}
						>
							Apply range
						</Button>
						<p className="text-center text-[11px] text-muted-foreground">
							Up to {MAX_CUSTOM_RANGE_DAYS} days. Future dates are disabled.
						</p>
					</div>
				</SheetContent>
			</Sheet>
		</FilterChipRow>
	);
}
