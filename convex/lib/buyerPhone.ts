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
 *   - MY / SG → the existing strict arm (`assertValidMobileForCountry`), byte
 *     for byte: bare national number, trunk `0`, `60…`/`65…`, landlines
 *     refused. A local buyer who never touches the picker sees no change.
 *   - any other country → the generated table (`./dialCodes`): strip the
 *     country's own trunk prefix (never a blanket "leading 0" — Italy and Côte
 *     d'Ivoire keep theirs), check the national length against that country's
 *     mobile lengths, and store `dial + national` — the exact digits Meta
 *     delivers inbound, so the `(retailerId, waPhone)` customer row never
 *     forks between a typed number and the same buyer messaging us.
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
import {
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

function foreignMessage(row: DialRow): string {
	return `Enter a valid ${DIAL_COUNTRY_NAMES[row.iso]} mobile number (+${row.dial}), or change the country`;
}

const fits = (row: DialRow, national: string) =>
	(row.lengths as readonly number[]).includes(national.length);

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

/** The generic arm: any country outside the strict MY/SG arms. */
function parseForeign(
	row: DialRow,
	national: string,
	explicitCode: boolean,
): BuyerPhoneParse {
	let n = national;
	// The calling code typed WITHOUT its `+` ("44 7911 123456" with United
	// Kingdom picked). Only peeled when the digits don't already fit as typed,
	// so a national number that happens to begin with the code's digits is
	// left alone.
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
		return { ok: false, message: foreignMessage(row) };
	}
	return { ok: true, digits, iso: row.iso };
}

/** The strict arm, with the buyer's version of its rejection copy. */
function parseSupported(
	raw: string,
	country: Country,
	picked: DialIso,
): BuyerPhoneParse {
	try {
		return {
			ok: true,
			digits: assertValidMobileForCountry(raw, country),
			iso: country,
		};
	} catch {
		// The seller-side copy says "this store takes Malaysian numbers", which
		// is no longer true of a buyer field — point at the picker instead.
		const suggest = suggestSupportedCountry(raw, picked);
		return suggest
			? { ok: false, message: switchMessage(suggest), suggest }
			: { ok: false, message: MOBILE_MESSAGE[country] };
	}
}

/**
 * Judge a typed buyer WhatsApp number against the picked country. Never
 * throws — the client runs it per keystroke for the echo line, the rejection
 * copy and the one-tap fix.
 */
export function parseBuyerWaPhone(raw: string, picked: DialIso): BuyerPhoneParse {
	const typed = raw.trim();
	const digits = typed.replace(/\D/g, "");
	if (digits.length === 0) {
		return { ok: false, message: BUYER_PHONE_EMPTY_MESSAGE };
	}

	const explicit = typed.startsWith("+")
		? digits
		: typed.startsWith("00")
			? digits.slice(2)
			: null;
	if (explicit !== null) {
		// The typed code wins over the pick (see the module header). A shared
		// code keeps the pick when the pick answers to it (+1 with Canada
		// picked stays Canada — same rules either way).
		for (let len = 1; len <= 3 && len < explicit.length; len++) {
			const rows = rowsForDialCode(explicit.slice(0, len));
			if (!rows.length) continue;
			const row = rows.find((r) => r.iso === picked) ?? rows[0];
			if (isCountry(row.iso)) {
				return parseSupported(`+${explicit}`, row.iso, row.iso);
			}
			return parseForeign(row, explicit.slice(len), true);
		}
		return { ok: false, message: UNKNOWN_DIAL_CODE_MESSAGE };
	}

	if (isCountry(picked)) return parseSupported(typed, picked, picked);
	const result = parseForeign(dialRow(picked), digits, false);
	if (result.ok) return result;
	const suggest = suggestSupportedCountry(typed, picked);
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
