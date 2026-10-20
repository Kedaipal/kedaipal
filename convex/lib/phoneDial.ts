/**
 * Name-free primitives over the generated dial-code table (z8r3fdh274).
 *
 * Split from `./buyerPhone` on purpose: the display helpers (`formatMobile`,
 * `formatPhone`) need to find a stored number's calling code, and they are
 * imported by nearly every bundle — so this module carries only the dialing
 * facts, never the 241 country names (those live in `./dialCountryNames`,
 * which only the picker and the validator's copy import).
 *
 * Two kinds of "country" exist in Kedaipal and must not be confused:
 *   - `Country` (`./country`) — the closed set a STORE can be in (MY | SG).
 *     Currency, address rules, seller phone fields and courier markets key off
 *     it, exhaustively.
 *   - `DialIso` (here) — the open set a BUYER's WhatsApp number can come from.
 *     Only buyer phone fields (checkout, booking, track repair, the counter's
 *     manual bind) and the admin opt-out panel use it.
 *
 * See docs/phone-numbers.md.
 */

import { DIAL_ROWS, type DialIso } from "./dialCodes";

export type { DialIso };
export type DialRow = (typeof DIAL_ROWS)[number];

const BY_ISO: ReadonlyMap<string, DialRow> = new Map(
	DIAL_ROWS.map((row) => [row.iso, row]),
);

/** Rows sharing each calling code, the code's main country first. */
const BY_DIAL: ReadonlyMap<string, readonly DialRow[]> = (() => {
	const map = new Map<string, DialRow[]>();
	for (const row of DIAL_ROWS) {
		const rows = map.get(row.dial) ?? [];
		if (row.main) rows.unshift(row);
		else rows.push(row);
		map.set(row.dial, rows);
	}
	return map;
})();

/** ITU calling codes are 1–3 digits. */
const MAX_DIAL_LENGTH = 3;

/** E.164 caps a full international number at 15 digits. */
export const E164_MAX_DIGITS = 15;

/**
 * What a person pasted or typed, made safe to read as a phone number:
 *   - invisible format characters removed — WhatsApp and the phone's contacts
 *     app wrap a copied number in bidi marks (U+202A…U+202C, U+2066…U+2069,
 *     U+200E), which would otherwise hide a leading `+`;
 *   - every decimal digit mapped to ASCII — full-width `０１２` (NFKC) and
 *     script digits (Arabic-Indic `٠١٢`, Persian, Devanagari, Thai…), which a
 *     bare `\D` strip would silently DROP, turning one number into another.
 * Everything else (spaces, dashes, a `+`, letters) is left for the caller.
 */
export function cleanPhoneInput(raw: string): string {
	return raw
		.normalize("NFKC")
		.replace(/\p{Cf}/gu, "")
		.replace(/\p{Nd}/gu, (ch) => {
			const cp = ch.codePointAt(0) as number;
			if (cp <= 0x39) return ch;
			// Unicode encodes each script's digits 0–9 contiguously; walk back
			// to that run's zero.
			let zero = cp;
			while (zero > cp - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) {
				zero--;
			}
			return String(cp - zero);
		});
}

export function isDialIso(value: string): value is DialIso {
	return BY_ISO.has(value);
}

export function dialRow(iso: DialIso): DialRow {
	// Total by construction: `DialIso` is derived from the same table.
	return BY_ISO.get(iso) as DialRow;
}

/** Every country that answers to a calling code, the main one first
 * (`"44"` → GB, GG, IM, JE). Empty for a code no country uses. */
export function rowsForDialCode(dial: string): readonly DialRow[] {
	return BY_DIAL.get(dial) ?? [];
}

/**
 * Split STORED digits (`447911123456`, the form Meta delivers inbound) into
 * calling code + national number. Codes are prefix-free, so the first 1–3
 * digits that match a code are THE code. A shared code resolves to its main
 * country (+1 → US): the ISO is never stored, so which member of a shared
 * code a number belongs to is display-only and the main one is the honest
 * default. Null when nothing matches.
 */
export function splitStoredPhone(
	value: string,
): { iso: DialIso; dial: string; national: string } | null {
	const digits = value.replace(/\D/g, "");
	for (let len = 1; len <= MAX_DIAL_LENGTH && len < digits.length; len++) {
		const rows = BY_DIAL.get(digits.slice(0, len));
		if (rows?.length) {
			return {
				iso: rows[0].iso,
				dial: rows[0].dial,
				national: digits.slice(len),
			};
		}
	}
	return null;
}

/**
 * Break a national number into 3–4 digit groups, never leaving an orphan of
 * one or two: as many 3s as possible, with the remainder carried by one or two
 * 4s at the end (10 → `791 112 3456`, 8 → `1234 5678`).
 *
 * A reading aid, NOT a national convention — those disagree at the same length
 * (a 10-digit UK mobile reads `7911 123456`, a Japanese one `90 1234 5678`),
 * and shipping libphonenumber's per-country format rules would put them in
 * every bundle that renders a phone number. What matters here is that the run
 * is short enough to check a digit at a time: MY and SG get their real
 * grouping from `formatMobile`, and this is what everyone else gets.
 */
function groupNational(national: string): string {
	if (national.length <= 5) return national;
	const fours = national.length % 3 === 0 ? 0 : national.length % 3 === 1 ? 1 : 2;
	const threes = (national.length - fours * 4) / 3;
	const groups: string[] = [];
	let at = 0;
	for (let i = 0; i < threes; i++, at += 3) groups.push(national.slice(at, at + 3));
	for (let i = 0; i < fours; i++, at += 4) groups.push(national.slice(at, at + 4));
	return groups.join(" ");
}

/**
 * `+CC NATIONAL` for a stored number whose code is known — the readable
 * fallback for numbers the MY/SG groupings don't cover (`+44 791 112 3456`
 * instead of one unbroken run). The echo under a buyer's phone field exists so
 * a transposed digit is catchable, which an unbroken ten-digit run defeats.
 *
 * Null when no code matches, or when the part after the code isn't a mobile
 * length there — a malformed legacy row (a bare `1159399791` from before
 * numbers were normalized) must not be dressed up as a US number; the caller's
 * plain `+digits` fallback is the honest render.
 */
export function formatInternational(value: string): string | null {
	const split = splitStoredPhone(value);
	if (!split) return null;
	const lengths: readonly number[] = dialRow(split.iso).lengths;
	return lengths.includes(split.national.length)
		? `+${split.dial} ${groupNational(split.national)}`
		: null;
}

/**
 * The calling code a person TYPED, once it is complete — the picker's
 * auto-switch. Only an explicit international prefix counts (`+CC…` or
 * `00CC…`): bare digits are never sniffed, because a local number can start
 * with anything a calling code starts with.
 *
 * Returns the country to switch the picker to plus the rest of what was
 * typed (the national part, formatting preserved), or null while the code is
 * still incomplete, unknown, or absent. A shared code keeps the current pick
 * when it already answers to that code — a Canadian who picked Canada and
 * then types `+1` stays on Canada rather than being flipped to the US.
 */
export function detectTypedDialCode(
	raw: string,
	current: DialIso,
): { iso: DialIso; dial: string; rest: string } | null {
	const typed = cleanPhoneInput(raw).trimStart();
	let pos: number;
	if (typed.startsWith("+")) pos = 1;
	else if (typed.startsWith("00")) pos = 2;
	else return null;
	let code = "";
	while (pos < typed.length && code.length < MAX_DIAL_LENGTH) {
		const ch = typed[pos];
		pos++;
		if (/\d/.test(ch)) {
			code += ch;
			const rows = BY_DIAL.get(code);
			if (rows?.length) {
				const keep = rows.find((row) => row.iso === current);
				return {
					iso: (keep ?? rows[0]).iso,
					dial: code,
					rest: typed.slice(pos).replace(/^[\s\-().]+/, ""),
				};
			}
		} else if (!/[\s\-().]/.test(ch)) {
			return null;
		}
	}
	return null;
}
