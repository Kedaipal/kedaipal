/**
 * The BUYER WhatsApp number validator — any country (z8r3fdh274).
 *
 * A buyer's number is per-person, not per-store: a Singaporean ordering from a
 * Johor cake shop, a Japanese participant registering for a Malaysian event, a
 * tourist at a counter. So every field where a buyer's number is typed wears a
 * plate WITH a country picker (`BuyerPhoneInput` / `BuyerPhonePrefix` in
 * `src/components/ui/my-phone-input.tsx`), defaulting to the store's country,
 * and is judged here by the country that was PICKED:
 *
 *   - MY / SG → the existing strict arm (`assertValidMobileForCountry`): bare
 *     national number, trunk `0`, `60…`/`65…`, landlines refused. Everything it
 *     accepted before is still accepted with the same digits (a `+` written in
 *     front of a local number included); only its rejection copy changed, to
 *     point at the picker. A local buyer who never touches the picker sees no
 *     change.
 *   - any other country → the generated tables (`./dialCodes`,
 *     `./dialMobilePatterns`), libphonenumber's data: every reading of the
 *     typed digits (as typed, without the country's OWN trunk prefix — never a
 *     blanket "leading 0", Italy and Côte d'Ivoire keep theirs — via its
 *     trunk-parsing rule, without a calling code typed sans `+`) is tried, and
 *     the one that matches the country's MOBILE pattern wins; if none does, the
 *     mobile LENGTH decides, so a range newer than the metadata still gets
 *     through. The result is stored as `dial + national` — E.164, which is what
 *     Meta delivers inbound for nearly every country, so the
 *     `(retailerId, waPhone)` customer row doesn't fork between a typed number
 *     and the same buyer messaging us. Known exceptions, where WhatsApp's own id
 *     differs from E.164 (Mexico's legacy `521…`, pre-9th-digit Brazilian
 *     accounts): see docs/phone-numbers.md, "Known limitations".
 *
 * An explicit `+CC` / `00CC` in what was typed is honoured over the pick. That
 * is not sniffing — the person typed the country code — and it is what the
 * picker's auto-switch does on the client, so the two always agree. Bare digits
 * are never sniffed for acceptance; they are only sniffed for the rejection's
 * one-tap fix (`suggest`), where a wrong guess costs nothing.
 *
 * Seller-side numbers (the store's own `waPhone`, alert and pickup-manager
 * numbers) are NOT judged here — they stay locked to the store's country
 * (`assertValidMobileForCountry`), because they are the store's identity and
 * the couriers' sender contact.
 *
 * Pure module: the client (schemas, picker, echo line) imports it too, so the
 * browser and the mutation can never disagree. See docs/phone-numbers.md.
 */

import {
	COUNTRIES,
	COUNTRY_DIAL_CODE,
	type Country,
	isCountry,
} from "./country";
import { DIAL_COUNTRY_NAMES } from "./dialCountryNames";
import { DIAL_MOBILE_PATTERNS, DIAL_TRUNK_RULES } from "./dialMobilePatterns";
import {
	cleanPhoneInput,
	type DialIso,
	type DialRow,
	dialRow,
	E164_MAX_DIGITS,
	isDialIso,
	rowsForDialCode,
} from "./phoneDial";
import {
	assertValidMobileForCountry,
	MOBILE_KIND,
	MOBILE_MESSAGE,
	normalizeMobileDigits,
	STORED_MOBILE_PATTERN,
} from "./slug";

export type { DialIso };

export const BUYER_PHONE_EMPTY_MESSAGE = "Enter your WhatsApp number";

export const UNKNOWN_DIAL_COUNTRY_MESSAGE =
	"Pick the country your WhatsApp number is from";

export const UNKNOWN_DIAL_CODE_MESSAGE =
	"That country code isn't one we recognise — check the number";

/** "Japan" — the picker's option text and the rejection copy's noun. */
export function dialCountryName(iso: DialIso): string {
	return DIAL_COUNTRY_NAMES[iso];
}

/** "+81" */
export function dialCodeLabel(iso: DialIso): string {
	return `+${dialRow(iso).dial}`;
}

/**
 * Countries pinned under the store's own at the top of the picker, before the
 * A–Z list: the other supported store country and the neighbours whose buyers
 * actually turn up (the JB↔SG corridor, Brunei, Indonesia, Thailand, the
 * Philippines, Vietnam). Everyone else is one alphabetical scroll — or one
 * `+CC` typed into the field — away.
 */
export const NEARBY_DIAL_COUNTRIES: Record<Country, readonly DialIso[]> = {
	MY: ["SG", "BN", "ID", "TH", "PH", "VN"],
	SG: ["MY", "ID", "BN", "TH", "PH", "VN"],
};

/** Every country pinned under some store's own — where a mis-tap lands. */
const NEARBY_ANY: ReadonlySet<DialIso> = new Set(
	Object.values(NEARBY_DIAL_COUNTRIES).flat(),
);

/**
 * The picker's default and the mutation arg's meaning when it is absent: the
 * store's own country. An unknown code is refused rather than quietly read as
 * the store country — a client sending garbage should learn about it.
 */
export function resolveBuyerDialCountry(
	arg: string | undefined,
	storeCountry: Country,
): DialIso {
	if (arg === undefined || arg === "") return storeCountry;
	if (isDialIso(arg)) return arg;
	throw new Error(UNKNOWN_DIAL_COUNTRY_MESSAGE);
}

export type BuyerPhoneParse =
	| { ok: true; digits: string; iso: DialIso }
	| {
			ok: false;
			message: string;
			/** A supported store country the typed digits DO fit — the
			 * rejection's one-tap "switch to +65". Never used for acceptance. */
			suggest?: Country;
	  };

/**
 * Which supported country (other than the one picked) would accept these
 * bare digits as a mobile, if any. Input to the one-tap fix only.
 */
function suggestSupportedCountry(
	raw: string,
	picked: DialIso,
): Country | undefined {
	return COUNTRIES.find(
		(country) =>
			country !== picked &&
			STORED_MOBILE_PATTERN[country].test(normalizeMobileDigits(raw, country)),
	);
}

function switchMessage(country: Country): string {
	return `That looks like a ${MOBILE_KIND[country]} number — switch the country to +${COUNTRY_DIAL_CODE[country]}`;
}

/** The strict arm's copy, plus where the fix is: a buyer on the default pick
 * whose number is from somewhere else needs to hear that the plate changes. */
function supportedMessage(country: Country): string {
	return `${MOBILE_MESSAGE[country]}, or tap +${COUNTRY_DIAL_CODE[country]} to change the country`;
}

function foreignMessage(row: DialRow): string {
	return `Enter a valid ${DIAL_COUNTRY_NAMES[row.iso]} mobile number, or tap +${row.dial} to change the country`;
}

const fits = (row: DialRow, national: string) =>
	(row.lengths as readonly number[]).includes(national.length);

const MOBILE_RE = new Map<DialIso, RegExp | null>();

/** The country's mobile pattern, anchored — compiled on first use. */
function mobilePattern(row: DialRow): RegExp | null {
	let re = MOBILE_RE.get(row.iso);
	if (re === undefined) {
		const source = DIAL_MOBILE_PATTERNS[row.iso];
		re = source ? new RegExp(`^(?:${source})$`) : null;
		MOBILE_RE.set(row.iso, re);
	}
	return re;
}

/** A national number that IS a mobile there, by libphonenumber's pattern. */
const isMobile = (row: DialRow, national: string) =>
	fits(row, national) && (mobilePattern(row)?.test(national) ?? false);

/** Drop the country's trunk prefix — only its own, and only when what is left
 * is a valid national length (a Russian `812…` landline starts with the `8`
 * trunk digit too, and must not lose it). */
function stripTrunk(row: DialRow, national: string): string {
	if (!row.trunk || !national.startsWith(row.trunk)) return national;
	const stripped = national.slice(row.trunk.length);
	return fits(row, stripped) ? stripped : national;
}

/**
 * Where a country dials a trunk prefix, none of its national numbers begins
 * with `0` — that digit is the prefix's — and across +1 none begins with `1`
 * either. Length alone can't see this: `090-1234-567` is 10 digits, a valid
 * Japanese length, but it is a trunk-0 number one digit short, not a number.
 * Countries without a trunk prefix (Italy, Côte d'Ivoire) are exempt: their
 * leading 0 IS part of the number.
 */
function startsLikeATrunk(row: DialRow, national: string): boolean {
	if (!row.trunk) return false;
	return (
		national.startsWith("0") || (row.trunk === "1" && national.startsWith("1"))
	);
}

const TRUNK_RULE_RE = new Map<DialIso, RegExp>();

/**
 * libphonenumber's own trunk-parsing rule, applied the way it applies it: the
 * rule's match is dropped — or, where the country has a transform and the
 * rule captured something, rewritten (Argentina's "0 11 15 2345-6789" →
 * "9 11 2345 6789"). Null when the country has no such rule or it didn't match.
 */
function applyTrunkRule(row: DialRow, national: string): string | null {
	const rule = DIAL_TRUNK_RULES[row.iso];
	if (!rule) return null;
	let re = TRUNK_RULE_RE.get(row.iso);
	if (!re) {
		re = new RegExp(`^(?:${rule.parse})`);
		TRUNK_RULE_RE.set(row.iso, re);
	}
	const match = re.exec(national);
	if (!match) return null;
	const lastGroup = match.length > 1 ? match[match.length - 1] : undefined;
	return rule.transform && lastGroup
		? national.replace(re, rule.transform)
		: national.slice(match[0].length);
}

/**
 * Every way the typed digits could be the national number: as typed, without
 * the country's trunk prefix (its plain prefix and libphonenumber's parsing
 * rule), and — when no `+` was typed — without a leading calling code too
 * ("62 812…" with Indonesia picked is the wa.me habit).
 */
function readingsOf(
	row: DialRow,
	national: string,
	explicitCode: boolean,
): string[] {
	const readings: string[] = [];
	const push = (n: string | null) => {
		if (n && !readings.includes(n)) readings.push(n);
	};
	const add = (n: string) => {
		push(n);
		if (row.trunk && n.startsWith(row.trunk)) push(n.slice(row.trunk.length));
		push(applyTrunkRule(row, n));
	};
	add(national);
	if (!explicitCode && national.startsWith(row.dial)) {
		add(national.slice(row.dial.length));
	}
	return readings;
}

/**
 * The generic arm: any country outside the strict MY/SG arms. `confident` says
 * whether the country's mobile PATTERN vouched for the number, or only its
 * length did.
 */
function parseForeign(
	row: DialRow,
	national: string,
	explicitCode: boolean,
): { result: BuyerPhoneParse; confident: boolean } {
	// 1. A reading that IS a mobile there is the answer, whichever way it was
	//    typed. Length alone can't decide this: "628123456789" under Indonesia
	//    is 12 digits — a valid Indonesian length — yet it's the calling code
	//    typed without its `+`, and only the pattern (Indonesian mobiles start
	//    8) says to peel it rather than store 62628123456789.
	const mobile = readingsOf(row, national, explicitCode).find((n) =>
		isMobile(row, n),
	);
	if (mobile) {
		return {
			result: { ok: true, digits: `${row.dial}${mobile}`, iso: row.iso },
			confident: true,
		};
	}
	// 2. Nothing matched the pattern: judge by length, as the pattern may
	//    post-date a newly opened range, and refusing a real buyer is worse
	//    than a push the track page can repair. The caller still refuses when
	//    these digits are plainly another supported country's mobile.
	let n = national;
	if (!explicitCode && n.startsWith(row.dial)) {
		const peeled = n.slice(row.dial.length);
		if (
			!fits(row, n) &&
			!fits(row, stripTrunk(row, n)) &&
			fits(row, stripTrunk(row, peeled))
		) {
			n = peeled;
		}
	}
	n = stripTrunk(row, n);
	const digits = `${row.dial}${n}`;
	if (
		!fits(row, n) ||
		startsLikeATrunk(row, n) ||
		digits.length > E164_MAX_DIGITS
	) {
		return {
			result: { ok: false, message: foreignMessage(row) },
			confident: false,
		};
	}
	return { result: { ok: true, digits, iso: row.iso }, confident: false };
}

/** The strict arm, with the buyer's version of its rejection copy. */
function parseSupported(
	typed: string,
	country: Country,
	picked: DialIso,
): BuyerPhoneParse {
	try {
		return {
			ok: true,
			digits: assertValidMobileForCountry(typed, country),
			iso: country,
		};
	} catch {
		// The seller-side copy says "this store takes Malaysian numbers", which
		// is no longer true of a buyer field — point at the picker instead.
		const suggest = suggestSupportedCountry(typed, picked);
		return suggest
			? { ok: false, message: switchMessage(suggest), suggest }
			: { ok: false, message: supportedMessage(country) };
	}
}

/** The typed code, read as international (`+CC…` / `00CC…`). */
function parseExplicit(explicit: string, picked: DialIso): BuyerPhoneParse {
	// The typed code wins over the pick (see the module header). A shared code
	// keeps the pick when the pick answers to it (+1 with Canada picked stays
	// Canada — same rules either way).
	for (let len = 1; len <= 3 && len < explicit.length; len++) {
		const rows = rowsForDialCode(explicit.slice(0, len));
		if (!rows.length) continue;
		const row = rows.find((r) => r.iso === picked) ?? rows[0];
		if (isCountry(row.iso)) {
			return parseSupported(`+${explicit}`, row.iso, row.iso);
		}
		return parseForeign(row, explicit.slice(len), true).result;
	}
	return { ok: false, message: UNKNOWN_DIAL_CODE_MESSAGE };
}

/**
 * Judge a typed buyer WhatsApp number against the picked country. Never
 * throws — the client runs it per keystroke for the echo line, the rejection
 * copy and the one-tap fix.
 */
export function parseBuyerWaPhone(raw: string, picked: DialIso): BuyerPhoneParse {
	const typed = cleanPhoneInput(raw).trim();
	const digits = typed.replace(/\D/g, "");
	if (typed.length === 0) {
		return { ok: false, message: BUYER_PHONE_EMPTY_MESSAGE };
	}
	if (digits.length === 0) {
		// Something was typed, just not a number ("abc") — say what the field
		// wants for the picked country, not "enter your number".
		return {
			ok: false,
			message: isCountry(picked)
				? supportedMessage(picked)
				: foreignMessage(dialRow(picked)),
		};
	}

	const explicit = typed.startsWith("+")
		? digits
		: typed.startsWith("00")
			? digits.slice(2)
			: null;
	if (explicit !== null) {
		const result = parseExplicit(explicit, picked);
		if (result.ok || !isCountry(picked)) return result;
		// A Malaysian or Singaporean who habitually writes a `+` before their
		// local number ("+012-345 6789") was accepted by the strict arm before
		// this picker existed; the typed code didn't read as a number, so give
		// the pick's own arm the same chance it always had.
		const local = parseSupported(typed, picked, picked);
		return local.ok ? local : result;
	}

	if (isCountry(picked)) return parseSupported(typed, picked, picked);
	const { result, confident } = parseForeign(dialRow(picked), digits, false);
	// A number only a LENGTH vouches for, under one of the Nearby countries
	// pinned right below the store's own, that is plainly a Malaysian or
	// Singapore mobile, is a mis-tap in the list — not a new foreign range. Say
	// so, with the one-tap fix. Only there: far away the same digits are a
	// real number (Buenos Aires' 11 2345-6789 is also the shape of a Malaysian
	// 011 mobile), and offering "switch to +60" would store a stranger's.
	const suggest =
		result.ok && (confident || !NEARBY_ANY.has(picked))
			? undefined
			: suggestSupportedCountry(typed, picked);
	return suggest
		? { ok: false, message: switchMessage(suggest), suggest }
		: result;
}

/**
 * The server authority behind every buyer phone field: `orders.create`,
 * `orders.updateBuyerPhone`, `bookings.requestBooking` and the counter's
 * `bindSessionManualPhone`. Returns the stored digits or throws an `Error`
 * with the buyer-facing message (callers wrap it in a `ConvexError`).
 */
export function assertValidBuyerWaPhone(raw: string, picked: DialIso): string {
	const result = parseBuyerWaPhone(raw, picked);
	if (!result.ok) throw new Error(result.message);
	return result.digits;
}
