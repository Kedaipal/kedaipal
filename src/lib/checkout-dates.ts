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
 * Does the window hold a day the buyer can't have? Drives whether the date
 * picker shows its "greyed-out days aren't available" note — the note is an
 * EXPLANATION, so it appears only when there is greying to explain, and a
 * store with no closures, no hours and no prep reads as a clean month.
 *
 * Scans the whole window rather than a capped prefix. It had a 90-day cap when
 * this shipped, which was dead by construction: `fulfilmentDateBounds` ends the
 * window at `MAX_NOTICE_DAYS` (30) days out, so it can never exceed 31 days and
 * the cap was 3x a bound that already existed. Both checkouts kept their own
 * copy of the loop; this is the one copy (z8r3fdm36y PR review).
 */
export function windowHasUnpickableDay(
	minYmd: string,
	maxYmd: string,
	isSelectable: (ymd: string) => boolean,
): boolean {
	if (!minYmd || !maxYmd || minYmd > maxYmd) return false;
	for (let ymd = minYmd; ymd <= maxYmd; ymd = addDaysYmd(ymd, 1)) {
		if (!isSelectable(ymd)) return true;
	}
	return false;
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
