/**
 * Seller-side drafting for the overseas delivery lane (z8r3fdr5yy): the
 * settings page edits strings, the server stores minor units. Pure, so the
 * draft ⇄ lane round-trip and every inline message unit-test without a
 * render. The rules mirror `sanitizeCrossBorderPricing` so a mistake is an
 * inline sentence, never a thrown save.
 */

import type { Country } from "../../convex/lib/country";
import {
	type CrossBorderLane,
	type CrossBorderPricing,
	countryName,
	type LanePause,
	liveQuoteCouriersDeliver,
} from "../../convex/lib/crossBorder";
import { parsePriceInput } from "./format";

export type LanePriceKind = CrossBorderPricing["kind"];

export type LaneBandDraft = { maxKg: string; fee: string };

export type LaneDraft = {
	kind: LanePriceKind;
	fee: string;
	freeAbove: string;
	bands: LaneBandDraft[];
	/** "I'll pay the courier on every order" — required to save `free`. */
	freeAcknowledged: boolean;
};

const toMajor = (minor: number) => (minor / 100).toFixed(2);

/** A starting card a seller can edit: three common parcel tiers, blank fees. */
export function blankBands(): LaneBandDraft[] {
	return [
		{ maxKg: "1", fee: "" },
		{ maxKg: "3", fee: "" },
		{ maxKg: "5", fee: "" },
	];
}

export function draftFromLane(lane: CrossBorderLane | undefined): LaneDraft {
	const pricing = lane?.pricing;
	if (!pricing || pricing.kind === "flat") {
		return {
			kind: "flat",
			fee: pricing ? toMajor(pricing.fee) : "",
			freeAbove:
				pricing?.freeAbove !== undefined ? toMajor(pricing.freeAbove) : "",
			bands: blankBands(),
			freeAcknowledged: false,
		};
	}
	if (pricing.kind === "weight") {
		return {
			kind: "weight",
			fee: "",
			freeAbove:
				pricing.freeAbove !== undefined ? toMajor(pricing.freeAbove) : "",
			bands: pricing.bands.map((b) => ({
				maxKg: String(b.maxKg),
				fee: toMajor(b.fee),
			})),
			freeAcknowledged: false,
		};
	}
	return {
		kind: "free",
		fee: "",
		freeAbove: "",
		bands: blankBands(),
		// It was saved as free, so it was acknowledged when it was saved.
		freeAcknowledged: true,
	};
}

function parseFreeAbove(
	raw: string,
): { ok: true; minor: number | undefined } | { ok: false } {
	if (raw.trim().length === 0) return { ok: true, minor: undefined };
	const major = parsePriceInput(raw);
	if (major === null || major <= 0) return { ok: false };
	return { ok: true, minor: Math.round(major * 100) };
}

/** Turn the draft into the lane the server will store, or the one sentence
 * that says what to fix. */
export function laneFromDraft(
	draft: LaneDraft,
	country: Country,
): { ok: true; lane: CrossBorderLane } | { ok: false; error: string } {
	const where = countryName(country);
	if (draft.kind === "free") {
		if (!draft.freeAcknowledged) {
			return {
				ok: false,
				error: `Tick the box to confirm you'll pay the courier for every order to ${where}.`,
			};
		}
		return { ok: true, lane: { country, pricing: { kind: "free" } } };
	}
	const freeAbove = parseFreeAbove(draft.freeAbove);
	if (!freeAbove.ok) {
		return {
			ok: false,
			error: "The free-delivery threshold isn't a valid amount.",
		};
	}
	if (draft.kind === "flat") {
		const major = parsePriceInput(draft.fee);
		if (major === null || major <= 0) {
			return {
				ok: false,
				error: `Enter the delivery fee to ${where} — numbers only, e.g. 25.00. To cover it yourself, choose Free.`,
			};
		}
		return {
			ok: true,
			lane: {
				country,
				pricing: {
					kind: "flat",
					fee: Math.round(major * 100),
					freeAbove: freeAbove.minor,
				},
			},
		};
	}
	const rows = draft.bands.filter(
		(b) => b.maxKg.trim() !== "" || b.fee.trim() !== "",
	);
	if (rows.length === 0) {
		return { ok: false, error: "Add at least one weight band." };
	}
	const bands: Array<{ maxKg: number; fee: number }> = [];
	for (const row of rows) {
		const maxKg = Number(row.maxKg);
		if (!Number.isFinite(maxKg) || maxKg <= 0) {
			return { ok: false, error: "Each band needs a weight above 0 kg." };
		}
		const fee = parsePriceInput(row.fee);
		if (fee === null || fee < 0) {
			return {
				ok: false,
				error: `Enter a fee for the up-to-${row.maxKg} kg band (0 makes it free).`,
			};
		}
		bands.push({
			maxKg: Math.round(maxKg * 10) / 10,
			fee: Math.round(fee * 100),
		});
	}
	bands.sort((a, b) => a.maxKg - b.maxKg);
	for (let i = 1; i < bands.length; i++) {
		if (bands[i].maxKg === bands[i - 1].maxKg) {
			return {
				ok: false,
				error: "Two bands share the same weight — merge them.",
			};
		}
	}
	return {
		ok: true,
		lane: {
			country,
			pricing: { kind: "weight", bands, freeAbove: freeAbove.minor },
		},
	};
}

/** The sentence for why a lane is paused / can't be switched on — shown where
 * the seller is clicking, with the fix beside it. The verdict itself is
 * `lanePause` (convex/lib/crossBorder.ts): one rule for the switch, the
 * storefront and the order doors. */
export function laneBlockCopy(
	block: LanePause,
	storeCountry: Country,
	destination: Country,
): string {
	switch (block) {
		case "plan":
			return `Delivering to ${countryName(destination)} is part of the Pro plan.`;
		case "delivery_off":
			return `Delivery is switched off for your store, so there's nothing to send to ${countryName(destination)}. Turn delivery on to deliver there.`;
		case "live_pricing":
			return `Your delivery is priced live by courier, and ${liveQuoteCouriersDeliver(storeCountry)} within ${countryName(storeCountry)} only. Switch to your own delivery price to deliver to ${countryName(destination)}.`;
	}
}

/** The product form's `overseas` prop: set when the store has a lane SAVED
 * (paused or live — a paused lane comes back, and the product's answer
 * should already be right when it does). */
export function overseasOf(retailer: {
	country: Country;
	crossBorderLanes?: CrossBorderLane[];
}): { destination: Country; storeCountry: Country } | undefined {
	const lane = retailer.crossBorderLanes?.[0];
	return lane
		? { destination: lane.country, storeCountry: retailer.country }
		: undefined;
}
