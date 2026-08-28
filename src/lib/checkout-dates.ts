/**
 * Quick-pick day chips for the checkout date step.
 *
 * The date control is still the native `<input type="date">` (the lean Date
 * Picker decision — see docs/fulfilment-date.md); these chips are one-tap
 * shortcuts for the first few selectable days, where the vast majority of
 * orders land. All maths is done on "YYYY-MM-DD" strings (the same MYT-anchored
 * ymd space `convex/lib/fulfilmentDate` works in) so no timezone conversion
 * can shift a day.
 */

export interface QuickPickDay {
	/** "YYYY-MM-DD" — the value the chip writes into the form field. */
	ymd: string;
	/** Short human label: "Today", "Tomorrow", or "Tue 29 Jul". */
	label: string;
}

/** Add `days` to a "YYYY-MM-DD" string, staying in pure calendar space. */
export function addDaysYmd(ymd: string, days: number): string {
	const [y, m, d] = ymd.split("-").map(Number);
	// Noon UTC keeps the date stable against any host-timezone rendering.
	const date = new Date(Date.UTC(y, m - 1, d + days, 12));
	return date.toISOString().slice(0, 10);
}

/** "Tue 29 Jul" — weekday + day + month, rendered from the ymd itself. */
export function ymdChipLabel(ymd: string): string {
	const [y, m, d] = ymd.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12));
	return new Intl.DateTimeFormat("en-MY", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(date);
}

/**
 * The first `count` selectable days in `[minYmd, maxYmd]`, labelled for chips.
 * `todayYmd` (today in MYT, notice-free) upgrades the first labels to
 * "Today" / "Tomorrow" when they apply — a store with a 2-day notice never
 * shows "Today" because minYmd starts past it.
 */
export function quickPickDays(
	minYmd: string,
	maxYmd: string,
	todayYmd: string,
	count = 3,
	/** Optional day filter (store opening hours, 86eyp5rav) — unselectable days
	 * are skipped and the scan continues forward, so the chips still offer
	 * `count` REAL choices when the window has them. Bounded by the window
	 * itself (≤ 31 days), so no extra cap is needed. */
	isSelectable?: (ymd: string) => boolean,
): QuickPickDay[] {
	if (!minYmd || !maxYmd || minYmd > maxYmd) return [];
	const tomorrowYmd = addDaysYmd(todayYmd, 1);
	const days: QuickPickDay[] = [];
	for (
		let ymd = minYmd;
		ymd <= maxYmd && days.length < count;
		ymd = addDaysYmd(ymd, 1)
	) {
		if (isSelectable && !isSelectable(ymd)) continue;
		const label =
			ymd === todayYmd
				? "Today"
				: ymd === tomorrowYmd
					? "Tomorrow"
					: ymdChipLabel(ymd);
		days.push({ ymd, label });
	}
	return days;
}
