/**
 * Calendar version parsing + ordering — the ONE author, shared by the client
 * and the Convex backend (86eyqgxna / 86eyqgxv9).
 *
 * Lives under `convex/lib/` and is re-exported from `src/lib/app-version.ts`,
 * the same one-author posture `displayAddressState` uses (see
 * `convex/lib/address.ts`). The alternative — mirroring the comparator on both
 * sides — is how the two silently drift, and here a drift means the "have I
 * seen this release?" check disagrees between the server that stores the
 * version and the client that renders the modal.
 *
 * `src/lib/app-version.ts` keeps `APP_VERSION` itself, because that reads a
 * Vite `define` which has no meaning in the Convex runtime.
 *
 * Scheme: `YYYY.MM.N` — 4-digit year, zero-padded month `01`–`12`, release
 * ordinal within the month starting at 1. See `docs/ci.md` for why calendar
 * rather than semver.
 */

/**
 * The month is range-checked rather than `\d\d` so `2026.13.1` fails the gate
 * instead of shipping. The ordinal rejects `0` and leading zeros so one release
 * has exactly ONE spelling — if `2026.08.01` and `2026.08.1` were both valid,
 * the release-notes "have I seen this?" comparison would have two answers for
 * one build.
 */
export const CALENDAR_VERSION_RE = /^\d{4}\.(0[1-9]|1[0-2])\.[1-9]\d*$/;

/** True when `value` is a well-formed `YYYY.MM.N` calendar version. */
export function isCalendarVersion(value: string): boolean {
	return CALENDAR_VERSION_RE.test(value);
}

/**
 * Compare two calendar versions numerically. Returns <0 / 0 / >0 like a sort
 * comparator.
 *
 * Numeric, NOT string comparison — that is the whole reason this exists.
 * Lexically `"2026.08.9" > "2026.08.10"`, so the tenth release of a month would
 * read as OLDER than the ninth and its notes would never be shown. The bug only
 * appears once a month has ten releases, which is exactly the kind of thing
 * that ships and then surfaces months later.
 *
 * An unparseable version sorts BELOW every valid one, so a corrupted stored
 * value degrades to "seen nothing" (show the notes) rather than "seen
 * everything" (silently suppress them forever). Showing a release note twice is
 * a papercut; never showing one defeats the feature.
 */
export function compareCalendarVersions(a: string, b: string): number {
	const pa = parseCalendarVersion(a);
	const pb = parseCalendarVersion(b);
	if (!pa && !pb) return 0;
	if (!pa) return -1;
	if (!pb) return 1;
	return pa.year - pb.year || pa.month - pb.month || pa.ordinal - pb.ordinal;
}

function parseCalendarVersion(
	value: string,
): { year: number; month: number; ordinal: number } | null {
	if (!isCalendarVersion(value)) return null;
	const [year, month, ordinal] = value.split(".").map(Number);
	return { year, month, ordinal };
}
