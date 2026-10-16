// The ANSWER line of each question row on the product form (z8r3fdv1z2).
//
// Every optional capability on the edit page is a collapsed row asking a
// question ("Is it on sale right now?"); the line under it says what the
// draft is set to right now ("Yes · 20% off · ends Fri 6:00 PM"). That line is
// the whole design: it tells a seller the capability exists AND whether it is
// on, without opening anything. So it is derived here, purely, from the same
// as-typed drafts the fields edit — it live-updates as they type, and it can
// never describe something the save would not do.
//
// Tone: `off` = not in use (muted), `set` = in use (mint), `warn` = in use but
// something needs the seller's eye (amber). The form layers `error` on top for
// a refused save — that is a property of the submit, not of the draft.

import {
	formatEventBadge,
	isEventPassed,
} from "../../../convex/lib/productEvent";
import { weekendDaysLabel } from "../../../convex/lib/productKind";
import { formatDraftPrice, parsePriceInput } from "../../lib/format";
import type { BuyerQuestionsDraft } from "./buyer-questions-card";
import { type EventDraft, eventSubmitValue } from "./event-fields";
import { type PromoDraft, promoSubmitValue } from "./promo-fields";
import type { CustomLineDraft } from "./variant-editor";

export type AnswerTone = "off" | "set" | "warn";
export type Answer = { text: string; tone: AnswerTone };

const off = (text: string): Answer => ({ text, tone: "off" });
const set = (text: string): Answer => ({ text, tone: "set" });
const warn = (text: string): Answer => ({ text, tone: "warn" });

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** "Fri 23 Oct, 6:00 pm" — the moment a sale starts or ends. */
function when(ms: number): string {
	return new Date(ms).toLocaleString("en-MY", {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** What the sale prices add up to: one shared percentage ("20% off") when
 * every discounted line agrees, else how many lines are discounted. */
function discountPhrase(
	rows: readonly { price: string; promoPrice?: string }[],
	currency: string,
): string | null {
	const discounted = rows
		.map((r) => ({
			price: parsePriceInput(r.price.trim()),
			promo: parsePriceInput((r.promoPrice ?? "").trim()),
		}))
		.filter(
			(r): r is { price: number; promo: number } =>
				r.promo !== null && r.promo > 0,
		);
	if (discounted.length === 0) return null;
	const percents = discounted.map((r) =>
		r.price !== null && r.price > 0
			? Math.round((1 - r.promo / r.price) * 100)
			: null,
	);
	const first = percents[0];
	if (
		first !== null &&
		first !== undefined &&
		first > 0 &&
		percents.every((p) => p === first)
	) {
		return `${first}% off`;
	}
	if (rows.length === 1) return formatDraftPrice(discounted[0].promo, currency);
	return `sale price on ${discounted.length} of ${rows.length}`;
}

export function promoAnswer({
	draft,
	rows,
	currency,
	locked,
	grouped,
	flashAllowed,
	now,
}: {
	draft: PromoDraft;
	rows: readonly { price: string; promoPrice?: string }[];
	currency: string;
	/** Promotions are a Pro feature this store doesn't have. */
	locked: boolean;
	/** The bulk promotion this product belongs to, if any (z8r3fducfd). */
	grouped?: {
		label?: string;
		percentOff: number;
		startsAt?: number;
		endsAt?: number;
	} | null;
	flashAllowed: boolean;
	now: number;
}): Answer {
	if (grouped) {
		const name = grouped.label ?? "a promotion";
		const window =
			grouped.startsAt !== undefined && grouped.startsAt > now
				? `starts ${when(grouped.startsAt)}`
				: grouped.endsAt !== undefined
					? `ends ${when(grouped.endsAt)}`
					: "no end date";
		return set(`Part of ${name} · ${grouped.percentOff}% off · ${window}`);
	}
	if (!draft.on) return off(locked ? "Not on your plan" : "No");
	if (locked) return warn("Paused · promotions are part of Pro");
	const discount = discountPhrase(rows, currency);
	if (discount === null) return warn("On, but nothing is on sale yet");
	const value = promoSubmitValue(draft, now, { flashAllowed });
	const parts = ["Yes", discount];
	if (value?.endsAt !== undefined && value.endsAt <= now) {
		return warn(`${parts.join(" · ")} · ended ${when(value.endsAt)}`);
	}
	if (value?.startsAt !== undefined && value.startsAt > now) {
		parts.push(`starts ${when(value.startsAt)}`);
	} else if (value?.endsAt !== undefined) {
		parts.push(
			draft.endMode === "minutes" && draft.startMode === "now"
				? `runs ${durationPhrase(draft.durationMinutes)} from save`
				: `ends ${when(value.endsAt)}`,
		);
	} else {
		parts.push("no end date");
	}
	if (value?.unitCap !== undefined) parts.push(plural(value.unitCap, "unit"));
	if (value?.maxPerOrder !== undefined)
		parts.push(`${value.maxPerOrder} per order`);
	return set(parts.join(" · "));
}

function durationPhrase(minutes: number): string {
	if (minutes % (24 * 60) === 0) return plural(minutes / (24 * 60), "day");
	if (minutes % 60 === 0) return plural(minutes / 60, "hour");
	return `${minutes} min`;
}

export function eventAnswer({
	draft,
	locked,
	rsvpCount = 0,
	noVenue,
	now,
}: {
	draft: EventDraft;
	locked: boolean;
	rsvpCount?: number;
	/** The store has nowhere to hold an event yet. */
	noVenue: boolean;
	now: number;
}): Answer {
	if (!draft.on) return off(locked ? "Not on your plan" : "No");
	const value = eventSubmitValue(draft);
	if (!value) return warn("Yes · pick the date");
	if (noVenue) return warn("Yes · needs a venue first");
	const badge = formatEventBadge(value, now);
	if (isEventPassed(value, now)) return warn(`Yes · ${badge} · it has passed`);
	const parts = ["Yes", badge];
	if (value.seats !== undefined) parts.push(plural(value.seats, "seat"));
	if (rsvpCount > 0) parts.push(plural(rsvpCount, "RSVP"));
	return set(parts.join(" · "));
}

export function customOrdersAnswer(
	line: CustomLineDraft | null,
	currency: string,
): Answer {
	if (!line) return off("No");
	const name = line.label.trim() || "Custom";
	const price = parsePriceInput(line.price.trim());
	return set(
		`Yes · “${name}” · ${
			price !== null && price > 0
				? `from ${formatDraftPrice(price, currency)}`
				: "price on quote"
		}`,
	);
}

/** All / none / SOME — a mixed product must never read as "No". */
export function mockupAnswer(
	rows: readonly { requiresProof: boolean }[],
): Answer {
	const on = rows.filter((r) => r.requiresProof).length;
	if (rows.length === 0 || on === 0) return off("No");
	if (on === rows.length)
		return set(rows.length > 1 ? "Yes · every choice" : "Yes");
	return set(`For ${on} of ${rows.length} choices`);
}

export function buyerQuestionsAnswer(draft: BuyerQuestionsDraft): Answer {
	if (draft.length === 0) return off("Not asked");
	const required = draft.filter((q) => q.required).length;
	const parts = [plural(draft.length, "question")];
	if (required > 0) parts.push(`${required} required`);
	return set(parts.join(" · "));
}

/** "2 h", "45 min", "1 h 30 min" — prep time as a seller says it. */
export function prepPhrase(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function orderRulesAnswer({
	minQuantity,
	noticeDays,
	prepMinutes,
	isEvent,
	heedsWarning,
}: {
	minQuantity: number;
	noticeDays: number;
	prepMinutes: number;
	/** An event ignores notice and prep — the fixed date decides both. */
	isEvent: boolean;
	/** A heads-up is showing inside (prep made inert by notice, a minimum the
	 * stock can't reach) — worth amber on the collapsed line. */
	heedsWarning: boolean;
}): Answer {
	const parts: string[] = [];
	if (minQuantity >= 2) parts.push(`Min ${minQuantity}`);
	if (!isEvent && noticeDays > 0)
		parts.push(
			noticeDays === 1 ? "1 day’s notice" : `${noticeDays} days’ notice`,
		);
	if (!isEvent && prepMinutes > 0)
		parts.push(`${prepPhrase(prepMinutes)} prep`);
	if (parts.length === 0) return off("None");
	const text = parts.join(" · ");
	return heedsWarning ? warn(`${text} · check the note inside`) : set(text);
}

export function pickupNoteAnswer(
	note: string,
	offerSelfCollect: boolean,
): Answer {
	if (!offerSelfCollect)
		return off("Needs self-collect on · Settings → Fulfilment");
	const text = note.replace(/\s+/g, " ").trim();
	return text.length === 0 ? off("Nothing yet") : set(`“${text}”`);
}

export function whereAnswer({
	hidden,
	categoryNames,
	storeHasCategories,
}: {
	hidden: boolean;
	categoryNames: readonly string[];
	storeHasCategories: boolean;
}): Answer {
	const place = hidden
		? "Hidden from your store · counter only"
		: "On your storefront";
	if (!storeHasCategories) return set(place);
	return set(
		`${place} · ${categoryNames.length > 0 ? categoryNames.join(", ") : "no category"}`,
	);
}

export function weekendRateAnswer({
	isPackage,
	weekendPrice,
	weekendDays,
	basePrice,
	currency,
}: {
	isPackage: boolean;
	weekendPrice: string;
	weekendDays: readonly number[];
	basePrice: string;
	currency: string;
}): Answer {
	if (isPackage) return off("Not for a package · it has one flat price");
	const weekend = parsePriceInput(weekendPrice.trim());
	if (weekend === null || weekend <= 0) return off("No · one rate every night");
	if (weekendDays.length === 0) return warn("Yes · pick which nights");
	const base = parsePriceInput(basePrice.trim());
	const nights = weekendDaysLabel(weekendDays);
	return set(
		`${nights} nights ${formatDraftPrice(weekend, currency)}${
			base !== null && base > 0
				? ` · other nights ${formatDraftPrice(base, currency)}`
				: ""
		}`,
	);
}

export function instantBookAnswer(on: boolean): Answer {
	return on
		? set("Yes · confirmed the moment they book")
		: off("No · you approve each request first");
}

export function depositAnswer(draft: string, currency: string): Answer {
	const amount = parsePriceInput(draft.trim());
	if (amount === null || amount <= 0) return off("No");
	return set(
		`${formatDraftPrice(amount, currency)} · returned after check-out`,
	);
}

export function bookingNoticeAnswer(noticeDays: number): Answer {
	return noticeDays > 0
		? set(plural(noticeDays, "day"))
		: off("None · same-day requests allowed");
}
