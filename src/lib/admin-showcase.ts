import type { Country } from "../../convex/lib/country";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
} from "../../convex/lib/fulfilmentDate";
import {
	type ShowcaseState,
	type ShowcaseTheme,
	showcaseState,
} from "../../convex/lib/showcase";
import type { NotListedReason } from "../../convex/marketplace";
import type {
	AdminShowcase,
	AdminShowcaseMember,
} from "../../convex/showcases";
import { showcaseDaysLeft } from "./showcase";

/**
 * Admin-side showcase derivations (z8r3fdr6mv) — pure, so the status pill,
 * the "what's unsaved" line and the member-row reasons are unit-tested off
 * the DOM.
 */

/** The status pill: one word plus the fact that matters for that state. */
export function showcaseStatusLabel(
	row: Pick<AdminShowcase, "state" | "startsAt" | "endsAt">,
	now: number,
): { label: string; tone: "live" | "scheduled" | "draft" | "ended" } {
	switch (row.state) {
		case "live": {
			if (row.endsAt === undefined) return { label: "Live", tone: "live" };
			// Calendar days in MYT — the buyer chip's own count, so the admin
			// and the buyer never disagree on how long is left.
			const days = showcaseDaysLeft(row.endsAt, now);
			return {
				label:
					days <= 0
						? "Live · ends today"
						: days === 1
							? "Live · ends tomorrow"
							: `Live · ends in ${days} days`,
				tone: "live",
			};
		}
		case "scheduled":
			return {
				label: `Scheduled · starts ${row.startsAt !== undefined ? formatFulfilmentDate(row.startsAt, { weekday: false, year: false }) : "later"}`,
				tone: "scheduled",
			};
		case "ended":
			return {
				label:
					`Ended ${row.endsAt !== undefined ? formatFulfilmentDate(row.endsAt - 1, { weekday: false, year: false }) : ""}`.trim(),
				tone: "ended",
			};
		default:
			return { label: "Draft · buyers can't see it", tone: "draft" };
	}
}

/** "MY · 16 Oct 9:00 AM → 18 Oct 11:59 PM · Campfire" */
export function showcaseMetaLine(
	row: Pick<AdminShowcase, "country" | "startsAt" | "endsAt" | "theme">,
	themeLabel: string,
): string {
	const from =
		row.startsAt !== undefined
			? formatDateTime(row.startsAt)
			: "when published";
	const until =
		row.endsAt !== undefined ? formatDateTime(row.endsAt) : "no end date";
	return `${row.country} · ${from} → ${until} · ${themeLabel}`;
}

/** "18 Oct, 11:59 PM" in the house clock (MYT). */
export function formatDateTime(epoch: number): string {
	const minutes = Math.floor(((epoch + 8 * 60 * 60 * 1000) % DAY_MS) / 60000);
	return `${formatFulfilmentDate(epoch, { weekday: false, year: false })}, ${formatFulfilmentTime(minutes)}`;
}

/** Malaysia time is UTC+8 with no daylight saving — the house clock. */
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The editor's native `datetime-local` value for an epoch, and back — in
 * MALAYSIA time, whatever zone the admin's browser is set to. A
 * `datetime-local` has no zone, and reading it with `new Date(value)` uses the
 * browser's: the hands-on test ran on a Chrome set to GMT+7, where "18 Oct
 * 23:59" was stored as 00:59 MYT on the 19th — and every other date in the
 * app (the time chip, "comes off at…", the buyer page) is MYT. The field's
 * label says so.
 */
export function toDateTimeLocal(epoch: number | undefined): string {
	if (epoch === undefined) return "";
	const d = new Date(epoch + MYT_OFFSET_MS);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fromDateTimeLocal(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!match) return undefined;
	const [, y, mo, d, h, mi] = match.map(Number);
	return Date.UTC(y, mo - 1, d, h, mi) - MYT_OFFSET_MS;
}

/**
 * The editor's window refusal, BEFORE the tap (the server refuses the same
 * pair with the same words): an end at or before the start is a showcase
 * that can never be live.
 */
export function windowError(draft: {
	startsAt: number | undefined;
	endsAt: number | undefined;
}): string | null {
	if (
		draft.startsAt !== undefined &&
		draft.endsAt !== undefined &&
		draft.endsAt <= draft.startsAt
	) {
		return "“Show until” must be after “Show from”.";
	}
	return null;
}

/** What the editor holds while the admin types — the row's editable fields
 * in form shape. */
export type ShowcaseDraft = {
	title: string;
	tagline: string;
	country: Country;
	theme: ShowcaseTheme;
	/** The colour wheel's pick — kept while another look is chosen, so
	 * switching back to Custom restores it. */
	customColor: string | undefined;
	startsAt: number | undefined;
	endsAt: number | undefined;
	members: Array<{
		retailerId: AdminShowcaseMember["retailerId"];
		label: string;
	}>;
};

export function draftFromRow(row: AdminShowcase): ShowcaseDraft {
	return {
		title: row.title,
		tagline: row.tagline ?? "",
		country: row.country,
		theme: row.theme,
		customColor: row.customColor,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		members: row.members.map((m) => ({
			retailerId: m.retailerId,
			label: m.label ?? "",
		})),
	};
}

/**
 * What differs between the draft and the saved row, named — the save bar
 * says "Unsaved: theme, 2 booth labels" rather than a bare dot. Empty when
 * nothing changed, which is also what disables Save.
 */
export function describeChanges(
	draft: ShowcaseDraft,
	row: AdminShowcase,
): string[] {
	const changes: string[] = [];
	const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
	if (collapse(draft.title) !== row.title) changes.push("title");
	if (collapse(draft.tagline) !== (row.tagline ?? "")) changes.push("tagline");
	if (draft.country !== row.country) changes.push("region");
	if (draft.theme !== row.theme) changes.push("theme");
	else if (draft.theme === "custom" && draft.customColor !== row.customColor)
		changes.push("colour");
	if (draft.startsAt !== row.startsAt || draft.endsAt !== row.endsAt)
		changes.push("dates");
	const before = row.members;
	const after = draft.members;
	const sameOrder =
		before.length === after.length &&
		before.every((m, i) => m.retailerId === after[i]?.retailerId);
	if (!sameOrder) {
		const beforeIds = new Set(before.map((m) => m.retailerId));
		const afterIds = new Set(after.map((m) => m.retailerId));
		const added = after.filter((m) => !beforeIds.has(m.retailerId)).length;
		const removed = before.filter((m) => !afterIds.has(m.retailerId)).length;
		if (added > 0)
			changes.push(`${added} ${added === 1 ? "store" : "stores"} added`);
		if (removed > 0)
			changes.push(`${removed} ${removed === 1 ? "store" : "stores"} removed`);
		if (added === 0 && removed === 0) changes.push("store order");
	} else {
		const relabelled = after.filter(
			(m, i) => collapse(m.label) !== (before[i]?.label ?? ""),
		).length;
		if (relabelled > 0)
			changes.push(
				`${relabelled} booth ${relabelled === 1 ? "label" : "labels"}`,
			);
	}
	return changes;
}

/**
 * What pressing Save will do to buyers, from the DRAFT's dates — never the
 * saved row's state. The first build read the saved state, so moving "Show
 * from" into the future on a live showcase still said "Save · live on
 * /stores now" while the save was about to take it off /stores.
 *
 * `button` is the Save label; `toast` the line after it lands.
 */
export function saveOutcome(
	draft: Pick<ShowcaseDraft, "startsAt" | "endsAt">,
	row: Pick<AdminShowcase, "publishedAt" | "state">,
	now: number,
): { button: string; toast: string } {
	if (row.publishedAt === undefined)
		return { button: "Save", toast: "Saved — still a draft." };
	const next = showcaseState(
		{
			publishedAt: row.publishedAt,
			startsAt: draft.startsAt,
			endsAt: draft.endsAt,
		},
		now,
	);
	const wasLive = row.state === "live";
	switch (next) {
		case "live":
			return {
				button: "Save · live on /stores now",
				toast: wasLive
					? "Saved — live on /stores now."
					: "Saved — it's on /stores now.",
			};
		case "scheduled": {
			const at = formatDateTime(draft.startsAt ?? now);
			return wasLive
				? {
						button: `Save · off /stores until ${at}`,
						toast: `Saved — off /stores until ${at}.`,
					}
				: {
						button: `Save · on /stores from ${at}`,
						toast: `Saved — on /stores from ${at}.`,
					};
		}
		default:
			return wasLive
				? {
						button: "Save · takes it off /stores now",
						toast: "Saved — it has ended and is off /stores.",
					}
				: {
						button: "Save · already ended",
						toast: "Saved — it has ended, so buyers don't see it.",
					};
	}
}

/**
 * The saved row changed under an open editor — a save, a cover upload, or
 * another admin. Each field the admin has NOT touched takes the new saved
 * value; each field they have touched keeps their edit. The first build
 * re-seeded the whole draft on every change, so uploading a cover silently
 * threw away an unsaved title.
 */
export function rebaseDraft(
	draft: ShowcaseDraft,
	before: AdminShowcase,
	after: AdminShowcase,
): ShowcaseDraft {
	const base = draftFromRow(before);
	const next = draftFromRow(after);
	const same = (a: unknown, b: unknown) =>
		JSON.stringify(a) === JSON.stringify(b);
	const pick = <K extends keyof ShowcaseDraft>(key: K): ShowcaseDraft[K] =>
		same(draft[key], base[key]) ? next[key] : draft[key];
	return {
		title: pick("title"),
		tagline: pick("tagline"),
		country: pick("country"),
		theme: pick("theme"),
		customColor: pick("customColor"),
		startsAt: pick("startsAt"),
		endsAt: pick("endsAt"),
		members: pick("members"),
	};
}

/** The member row's one-line reason, in the admin's words. */
export const NOT_LISTED_COPY: Record<NotListedReason, string> = {
	internal: "Not shown: a Kedaipal or test store, never listed on /stores",
	hidden_by_admin: "Not shown: hidden from /stores by Kedaipal",
	offline: "Not shown: Kedaipal has taken this store offline",
	opted_out: "Not shown: the seller turned off their /stores listing",
	purging: "Not shown: this store is being deleted",
	no_visible_product: "Not shown: no visible product yet",
};

/** "7 of 8 stores show to buyers. Batu Caves Outdoor appears once it has a
 * visible product." — the preview's one honest line. */
export function visibilitySummary(members: AdminShowcaseMember[]): string {
	const hidden = members.filter((m) => m.notListed !== null);
	if (members.length === 0) return "No stores yet.";
	if (hidden.length === 0)
		return `All ${members.length} ${members.length === 1 ? "store shows" : "stores show"} to buyers.`;
	return `${members.length - hidden.length} of ${members.length} stores show to buyers.`;
}

export const SHOWCASE_STATE_ORDER: Record<ShowcaseState, number> = {
	live: 0,
	scheduled: 1,
	draft: 2,
	ended: 3,
};
