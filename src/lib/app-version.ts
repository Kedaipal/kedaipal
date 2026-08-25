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
 *
 * Parsing and ordering live in `convex/lib/appVersion.ts` and are re-exported
 * here, so the client and the Convex backend share ONE author (86eyqgxv9) — the
 * server stores the seen-version and the client decides what is unseen, and a
 * drift between two copies would make them disagree.
 */

export {
	CALENDAR_VERSION_RE,
	compareCalendarVersions,
	isCalendarVersion,
} from "../../convex/lib/appVersion";

/**
 * Injected by Vite's `define` at build time (see `vite.config.ts`), so runtime
 * code never imports `package.json` and drags it into the client bundle.
 */
declare const __APP_VERSION__: string | undefined;

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
