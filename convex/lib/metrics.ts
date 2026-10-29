/**
 * Acquisition attribution + the CAC ledger (ClickUp 86eye3eyp,
 * docs/acquisition-attribution.md) — the PURE rules. No Convex imports, so
 * the admin mutations, the onboarding capture, the admin console and the
 * tests all read one author of every policy below.
 *
 * Two inputs, one question. `retailers.acquisitionSource` says which motion
 * won a store; `acquisitionCosts` says what each motion cost Kedaipal in a
 * month. Together: cost per paying store, per channel. That number only
 * means something when the channel list is closed and the costing rule is
 * one constant, so both live here — change a policy here and every month
 * recomputes, because nothing derived is ever stored.
 *
 * Deliberately NOT here (decided 28 Oct 2026): gross-margin bands and
 * messages-per-order. `Kedaipal_Tier_Margin_Model.xlsx` stays the model;
 * Convex is the ledger of what was actually spent.
 */

import { REFERRAL_SOURCE_PREFIX } from "./referral";

/**
 * The closed channel vocabulary. Validated here, NOT in the schema
 * (`acquisitionSource` / `acquisitionCosts.channel` are `v.string()`), so a
 * channel can be added without a migration. Order is the order every surface
 * lists them in: the motions we run first, catch-alls last.
 */
export const ACQUISITION_CHANNELS = [
	"walk_in",
	"talk_event",
	"referral",
	"product_led",
	"inbound_social",
	"inbound_search",
	"outbound_dm",
	"founder_network",
	"other",
] as const;

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

/** Who set a store's channel. An admin tag is authoritative; a seller's own
 * answer at onboarding is a claim the admin confirms or changes. */
export type AcquisitionSetBy = "admin" | "seller";

/** The admin console's name and one-line meaning for each channel — the
 * description keeps "talk" and "founder network" from blurring. The seller
 * sees its own wording at onboarding (paraglide `onboarding_found_*`). */
export const CHANNEL_COPY: Record<
	AcquisitionChannel,
	{ label: string; hint: string }
> = {
	walk_in: { label: "Walk-in", hint: "We visited their shop, stall or bazaar" },
	talk_event: {
		label: "Talk or event",
		hint: "A talk, workshop or community event",
	},
	referral: { label: "Referral", hint: "Another seller or a friend sent them" },
	product_led: {
		label: "Product-led",
		hint: "Powered-by badge, /stores directory or a QR poster",
	},
	inbound_social: {
		label: "Social media",
		hint: "Found us on TikTok, Instagram or Facebook",
	},
	inbound_search: { label: "Search", hint: "Found us on Google" },
	outbound_dm: { label: "Outbound DM", hint: "We messaged them first" },
	founder_network: {
		label: "Founder network",
		hint: "Someone we already knew personally",
	},
	other: { label: "Other", hint: "None of these — say how in the note" },
};

/** RM50 an hour, in sen — what an hour of founder time costs a channel. */
export const FOUNDER_HOURLY_RATE_SEN = 5000;

/** Longest note on a store's tag or a month's spend row. */
export const ACQUISITION_NOTE_MAX = 140;

/** Upper bound on one channel's founder hours in one month (31 × 24): past
 * it the number is a typo, not a month. */
export const FOUNDER_HOURS_MAX = 744;

/** Upper bound on one channel's cash in one month (RM 1,000,000 in sen). */
export const CASH_SPEND_MAX_SEN = 100_000_000;

export function isAcquisitionChannel(
	value: string | undefined | null,
): value is AcquisitionChannel {
	return (
		value != null &&
		(ACQUISITION_CHANNELS as readonly string[]).includes(value)
	);
}

/** The channel's admin label, or the raw value for a channel retired from
 * the list (stored rows outlive a vocabulary change). */
export function channelLabel(value: string): string {
	return isAcquisitionChannel(value) ? CHANNEL_COPY[value].label : value;
}

/**
 * A channel to pre-select for a store nobody has tagged yet, read from the
 * two signals we capture automatically. A suggestion only — it never lands
 * on the row without an admin choosing it.
 *
 *  - a `referrals` row, or a `referral-<slug>` link tag → referral
 *  - a `powered-by*` badge tag, `directory`, `qr-poster` → product_led
 *  - `spotlight-<member>` (a talk's own link) → talk_event
 *  - `tiktok*`, `instagram*`, `facebook*`, `ig`, `fb` → inbound_social
 *  - `google*`, `search` → inbound_search
 *
 * Anything else (including no tag at all) suggests nothing: a walk-in and a
 * founder intro look identical from the data, and guessing would teach the
 * admin to click through.
 */
export function suggestChannel(input: {
	signupSource?: string;
	hasReferral: boolean;
}): AcquisitionChannel | null {
	if (input.hasReferral) return "referral";
	const src = input.signupSource?.trim().toLowerCase();
	if (!src) return null;
	if (src.startsWith(REFERRAL_SOURCE_PREFIX)) return "referral";
	if (
		src.startsWith("powered-by") ||
		src === "directory" ||
		src === "qr-poster"
	)
		return "product_led";
	if (src.startsWith("spotlight-")) return "talk_event";
	if (
		/^(tiktok|instagram|facebook)/.test(src) ||
		src === "ig" ||
		src === "fb"
	)
		return "inbound_social";
	if (src.startsWith("google") || src === "search") return "inbound_search";
	return null;
}

/** Trim a free-text note; blank → undefined. Throws past the cap so the
 * admin sees why instead of a silently cut sentence. */
export function normalizeAcquisitionNote(
	note: string | undefined,
): string | undefined {
	const trimmed = note?.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > ACQUISITION_NOTE_MAX)
		throw new Error(
			`Keep the note to ${ACQUISITION_NOTE_MAX} characters (it's ${trimmed.length}).`,
		);
	return trimmed;
}

/** A spend row's validation verdict: the refusal sentence, or null. */
export function spendEntryProblem(entry: {
	cashSpend: number;
	founderHours?: number;
}): string | null {
	const { cashSpend, founderHours } = entry;
	if (!Number.isInteger(cashSpend) || cashSpend < 0)
		return "Cash spend must be a positive amount in sen.";
	if (cashSpend > CASH_SPEND_MAX_SEN)
		return "That cash amount is too large for one channel in one month.";
	if (founderHours !== undefined) {
		if (!Number.isFinite(founderHours) || founderHours < 0)
			return "Founder hours can't be negative.";
		if (founderHours > FOUNDER_HOURS_MAX)
			return `Founder hours can't exceed ${FOUNDER_HOURS_MAX} in a month.`;
	}
	return null;
}

/** What a channel cost in a month, founder time included, in sen. */
export function channelCostSen(entry: {
	cashSpend: number;
	founderHours?: number;
}): number {
	return (
		entry.cashSpend +
		Math.round((entry.founderHours ?? 0) * FOUNDER_HOURLY_RATE_SEN)
	);
}

/** Cost per new paying store, in sen. Null with no paying store — "no
 * payer yet" is not the same fact as "free", so it never reads as zero. */
export function cacSen(costSen: number, newPayers: number): number | null {
	if (newPayers <= 0) return null;
	return Math.round(costSen / newPayers);
}
