/**
 * The running app version (ClickUp 86eyqgxna).
 *
 * Kedaipal uses **calendar versioning** — `YYYY.MM.N`, where `N` is the release
 * ordinal within that month and resets each month (`2026.08.1`, `2026.08.2`,
 * `2026.09.1`).
 *
 * Deliberately NOT semver: there is no public API and no consumer pinning
 * against us, so major/minor/patch would carry no meaning — every release would
 * become an arbitrary minor that tells a reader nothing. A calendar version
 * sorts naturally and says at a glance how stale a deploy is, which is the only
 * question anyone actually asks of it ("what are you running?" during support).
 *
 * `package.json` is the single source of truth. It is bumped **by hand in the
 * staging→main release PR** — not auto-incremented by CI — because that is the
 * same moment a human decides whether the release is notable enough to
 * interrupt sellers with a "What's new" modal. Automating the bump would remove
 * the only natural checkpoint for that judgement. CI then tags `main` from the
 * same value, so a version always maps to a commit.
 */

/**
 * Injected by Vite's `define` at build time (see `vite.config.ts`), so runtime
 * code never imports `package.json` and drags it into the client bundle.
 */
declare const __APP_VERSION__: string | undefined;

/**
 * `YYYY.MM.N` — 4-digit year, zero-padded month `01`–`12`, then a release
 * ordinal of `1` or more with no leading zero.
 *
 * The month is range-checked rather than `\d\d` so a typo like `2026.13.1` or
 * `2026.00.1` fails the gate instead of shipping. The ordinal rejects `0` and
 * leading zeros so one release has exactly one spelling — `2026.08.01` and
 * `2026.08.1` must never both be valid, or the "have I seen this version?"
 * comparison the release-notes modal depends on has two answers for one build.
 */
export const CALENDAR_VERSION_RE = /^\d{4}\.(0[1-9]|1[0-2])\.[1-9]\d*$/;

/** True when `value` is a well-formed `YYYY.MM.N` calendar version. */
export function isCalendarVersion(value: string): boolean {
	return CALENDAR_VERSION_RE.test(value);
}

/**
 * The version this bundle was built from, or `"dev"` when the define is absent.
 *
 * The fallback exists for **vitest**, which runs from its own
 * `vitest.config.ts` and therefore never applies `vite.config.ts`'s `define` —
 * without the `typeof` guard every test importing this module would throw a
 * ReferenceError. It is not a production path: `vite.config.ts` throws at
 * config time if `package.json` has no version, so any real build has a real
 * value here.
 */
export const APP_VERSION: string =
	typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0
		? __APP_VERSION__
		: "dev";
