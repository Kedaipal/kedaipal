// The Acquisition page's pure logic (86eye3eyp, docs/acquisition-attribution.md):
// the `?month=` param, the RM / hours fields an admin types, and which rows a
// save sends. Kept out of the route so it's tested without rendering.

import { MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import type { AcquisitionChannel } from "../../convex/lib/metrics";
import { monthStartMyt } from "../../convex/lib/usagePeriod";

/** `2026-09` → MYT midnight on 1 Sep 2026; anything else → undefined. */
export function parseMonthParam(raw: string | undefined): number | undefined {
	const match = raw?.match(/^(\d{4})-(\d{2})$/);
	if (!match) return undefined;
	const month = Number(match[2]);
	if (month < 1 || month > 12) return undefined;
	return Date.UTC(Number(match[1]), month - 1, 1) - MYT_OFFSET_MS;
}

/** MYT month start → `2026-09`. */
export function monthParam(periodStart: number): string {
	const d = new Date(periodStart + MYT_OFFSET_MS);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "September 2026". */
export function monthTitle(periodStart: number): string {
	return new Intl.DateTimeFormat("en-MY", {
		month: "long",
		year: "numeric",
		timeZone: "Asia/Kuala_Lumpur",
	}).format(periodStart);
}

/** The month to show: the URL's, unless it's missing, malformed or in the
 * future — then the current month. */
export function resolveMonth(param: string | undefined, now: number): number {
	const current = monthStartMyt(now);
	const parsed = parseMonthParam(param);
	return parsed !== undefined && parsed <= current ? parsed : current;
}

/** One channel's row as the admin is editing it — the raw field text. */
export type SpendDraft = { cash: string; hours: string; note: string };

const MONEY = /^\d+(\.\d{1,2})?$/;
const HOURS = /^\d+(\.\d{1,2})?$/;

/** "1,200.50" → 120050 sen. Blank → 0. Not a ringgit amount → null. */
export function parseRinggit(text: string): number | null {
	const clean = text.replace(/,/g, "").trim();
	if (clean === "") return 0;
	if (!MONEY.test(clean)) return null;
	return Math.round(Number(clean) * 100);
}

/** "1.5" → 1.5. Blank → undefined. Not a number of hours → null. */
export function parseHours(text: string): number | undefined | null {
	const clean = text.trim();
	if (clean === "") return undefined;
	if (!HOURS.test(clean)) return null;
	return Number(clean);
}

/** 120050 sen → "1200.50"; 0 → "" so a no-spend channel reads blank. */
export function ringgitInput(sen: number): string {
	if (sen === 0) return "";
	return sen % 100 === 0 ? String(sen / 100) : (sen / 100).toFixed(2);
}

export function draftFrom(row: {
	cashSpend: number;
	founderHours?: number;
	note?: string;
}): SpendDraft {
	return {
		cash: ringgitInput(row.cashSpend),
		hours: row.founderHours !== undefined ? String(row.founderHours) : "",
		note: row.note ?? "",
	};
}

export type SpendEntry = {
	channel: AcquisitionChannel;
	cashSpend: number;
	founderHours?: number;
	note?: string;
};

/**
 * What a save sends: only the channels whose fields differ from what's
 * saved, plus which channels hold a value that isn't a number (the save
 * button stays disabled and the field says why).
 */
export function changedEntries(
	drafts: Record<string, SpendDraft>,
	saved: readonly { channel: AcquisitionChannel; draft: SpendDraft }[],
): { entries: SpendEntry[]; invalid: AcquisitionChannel[] } {
	const entries: SpendEntry[] = [];
	const invalid: AcquisitionChannel[] = [];
	for (const { channel, draft: was } of saved) {
		const now = drafts[channel] ?? was;
		if (
			now.cash.trim() === was.cash.trim() &&
			now.hours.trim() === was.hours.trim() &&
			now.note.trim() === was.note.trim()
		)
			continue;
		const cashSpend = parseRinggit(now.cash);
		const founderHours = parseHours(now.hours);
		if (cashSpend === null || founderHours === null) {
			invalid.push(channel);
			continue;
		}
		const note = now.note.trim();
		entries.push({
			channel,
			cashSpend,
			...(founderHours !== undefined ? { founderHours } : {}),
			...(note ? { note } : {}),
		});
	}
	return { entries, invalid };
}

/** "RM 1,200" — whole ringgit for the summary, sen when there are any. */
export function formatRinggit(sen: number): string {
	const ringgit = sen / 100;
	return `RM ${ringgit.toLocaleString("en-MY", {
		minimumFractionDigits: sen % 100 === 0 ? 0 : 2,
		maximumFractionDigits: 2,
	})}`;
}

/** CAC to the whole ringgit — "RM 537", never "RM 536.67": the sen are
 * false precision on a number built from estimated hours. */
export function formatCac(sen: number): string {
	return formatRinggit(Math.round(sen / 100) * 100);
}
