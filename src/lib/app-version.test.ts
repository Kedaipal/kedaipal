// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { APP_VERSION, isCalendarVersion } from "./app-version";

const pkg = JSON.parse(
	readFileSync(join(__dirname, "../../package.json"), "utf8"),
) as { version?: string };

describe("app version", () => {
	test("package.json declares a version", () => {
		// vite.config.ts throws without one, so a missing version breaks the build
		// rather than shipping a version-less bundle — this catches it in the gate
		// instead, where the failure names the cause.
		expect(pkg.version).toBeTypeOf("string");
	});

	test("package.json's version is a valid YYYY.MM.N calendar version", () => {
		// The guard that stops a stray semver ("1.0.0") or a hand-typo drifting in
		// during a release PR. Calendar versioning only works if it is actually
		// enforced; a mixed scheme sorts wrong and reads as an accident.
		expect(isCalendarVersion(pkg.version as string)).toBe(true);
	});

	test("accepts well-formed calendar versions", () => {
		for (const v of ["2026.08.1", "2026.01.1", "2026.12.99", "2030.10.12"]) {
			expect(isCalendarVersion(v)).toBe(true);
		}
	});

	test("rejects semver, out-of-range months and ambiguous ordinals", () => {
		for (const v of [
			"1.0.0", // semver — the scheme this replaces
			"2026.13.1", // month 13
			"2026.00.1", // month 0
			"2026.8.1", // month not zero-padded — would sort wrong as a string
			"2026.08.0", // ordinal 0 — releases start at 1
			"2026.08.01", // leading-zero ordinal: a SECOND spelling of 2026.08.1.
			// Both matching would give the release-notes "have I seen
			// this version?" check two answers for one build.
			"2026.08", // missing ordinal
			"2026.08.1.2", // extra segment
			"v2026.08.1", // tag prefix, not a version
			"2026.08.1-rc1", // pre-release suffix — not part of the scheme
			"", // empty
		]) {
			expect(isCalendarVersion(v)).toBe(false);
		}
	});

	test("APP_VERSION falls back to 'dev' when the build-time define is absent", () => {
		// vitest runs from its own config and never applies vite.config.ts's
		// `define`, so this is the value tests always see. Pinned so the fallback
		// can't be quietly changed to something that looks like a real version and
		// misleads a seller reading it back to support.
		expect(APP_VERSION).toBe("dev");
	});
});
