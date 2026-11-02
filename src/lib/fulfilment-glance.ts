import {
	formatDayWindow,
	type OpeningHours,
	WEEKDAY_NAMES_SHORT,
} from "../../convex/lib/openingHours";

/**
 * One-line summaries for the Fulfilment tab's grouped cards (86eye9xd4, 9A):
 * the tab reads as the store's configuration without opening a single form.
 */

/** Monday-first, as the hours editor renders (0 = Sunday underneath). */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function hoursSummary(hours: OpeningHours | undefined): {
	/** The card glance — "Open 6 days". */
	glance: string;
	/** The row value — "Tue–Sun · 9:00 AM – 6:00 PM". */
	row: string;
} {
	if (!hours) return { glance: "Open 24/7", row: "Every day · Open 24 hours" };
	const open = MONDAY_FIRST.filter((i) => hours[i] && !hours[i].closed);
	const n = open.length;
	if (n === 0) return { glance: "Closed every day", row: "Closed every day" };
	const glance =
		n === 7 ? "Open every day" : `Open ${n} day${n === 1 ? "" : "s"}`;

	// Days: a run reads as a range ("Tue–Sun"); scattered days are listed while
	// short and counted after that.
	const positions = open.map((i) => MONDAY_FIRST.indexOf(i));
	const contiguous = positions.every(
		(p, k) => k === 0 || p === positions[k - 1] + 1,
	);
	const short = (i: number) => WEEKDAY_NAMES_SHORT[i];
	const days =
		n === 7
			? "Every day"
			: n === 1
				? short(open[0])
				: contiguous
					? `${short(open[0])}–${short(open[n - 1])}`
					: n <= 3
						? open.map(short).join(", ")
						: `${n} days`;

	const windows = new Set(open.map((i) => formatDayWindow(hours[i])));
	const window = windows.size === 1 ? [...windows][0] : "hours vary";
	return { glance, row: `${days} · ${window}` };
}

/** "Same-day" or "2 days" — the notice a buyer must give. */
export function noticeSummary(days: number): string {
	return days === 0 ? "Same-day" : `${days} day${days === 1 ? "" : "s"}`;
}
