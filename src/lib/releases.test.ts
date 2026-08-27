// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compareCalendarVersions } from "../../convex/lib/appVersion";
import type { Release } from "../content/releases";
import { RELEASES } from "../content/releases";
import { isCalendarVersion } from "./app-version";
import { localized, resolveWhatsNew } from "./releases";

function release(version: string, notable = false): Release {
	return {
		version,
		date: "2026-08-01",
		notable,
		entries: [{ title: { en: `t ${version}` }, body: { en: `b ${version}` } }],
	};
}

const FIXTURE = [
	release("2026.09.1", true),
	release("2026.08.2"),
	release("2026.08.1"),
];

describe("resolveWhatsNew", () => {
	test("shows and stamps nothing while the seen-version query is loading", () => {
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: undefined,
			currentVersion: "2026.09.1",
		});
		expect(s.autoOpen).toBe(false);
		expect(s.silentCatchUp).toBe(false);
		expect(s.unseenVersions.size).toBe(0);
	});

	test("a seller with no stored version is caught up silently, never shown a backlog", () => {
		// THE rule that keeps this feature from embarrassing itself on day one.
		// Every existing seller AND every new signup hits this branch, and
		// replaying a dozen old entries at someone who has been using the product
		// for months reads like the product is talking to somebody else.
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: null,
			currentVersion: "2026.09.1",
		});
		expect(s.silentCatchUp).toBe(true);
		expect(s.autoOpen).toBe(false);
		expect(s.unseenVersions.size).toBe(0);
	});

	test("a NEWER release shows again — an old stamp never suppresses it", () => {
		// The bug the whole "store a version, not a boolean" design exists to
		// prevent. Seen 2026.08.1, so both later releases are unseen.
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "2026.08.1",
			currentVersion: "2026.09.1",
		});
		expect([...s.unseenVersions].sort()).toEqual(["2026.08.2", "2026.09.1"]);
	});

	test("only a notable unseen release opens the modal", () => {
		const notNotable = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "2026.08.1",
			currentVersion: "2026.08.2", // 2026.09.1 is out of this build
		});
		expect(notNotable.unseenVersions.has("2026.08.2")).toBe(true);
		expect(notNotable.autoOpen).toBe(false);

		const notable = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "2026.08.2",
			currentVersion: "2026.09.1",
		});
		expect(notable.autoOpen).toBe(true);
	});

	test("nothing is unseen once the seller is on the newest version", () => {
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "2026.09.1",
			currentVersion: "2026.09.1",
		});
		expect(s.unseenVersions.size).toBe(0);
		expect(s.autoOpen).toBe(false);
		// The permanent changelog still lists everything — dismissing the modal
		// must never make a release unreadable.
		expect(s.all).toHaveLength(3);
	});

	test("notes for a version newer than the running build are hidden", () => {
		// Happens when a release PR adds notes but forgets the package.json bump.
		// Announcing a version the seller demonstrably isn't running is worse than
		// announcing nothing.
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "2026.08.1",
			currentVersion: "2026.08.2",
		});
		expect(s.all.map((r) => r.version)).toEqual(["2026.08.2", "2026.08.1"]);
		expect(s.unseenVersions.has("2026.09.1")).toBe(false);
	});
});

describe("ordering", () => {
	test("the tenth release of a month is newer than the ninth", () => {
		// Lexically "2026.08.9" > "2026.08.10", so a string comparison would hide
		// the tenth release's notes forever. This is the reason
		// compareCalendarVersions parses instead of comparing strings, and the bug
		// would only have surfaced in a month with ten releases.
		expect(compareCalendarVersions("2026.08.10", "2026.08.9")).toBeGreaterThan(
			0,
		);
		const s = resolveWhatsNew({
			releases: [release("2026.08.10"), release("2026.08.9")],
			seenVersion: "2026.08.9",
			currentVersion: "2026.08.10",
		});
		expect([...s.unseenVersions]).toEqual(["2026.08.10"]);
	});

	test("an unparseable stored version shows the notes rather than hiding them", () => {
		// Degrade toward "show", never "silently suppress" — a note shown twice is
		// a papercut, a note never shown defeats the feature.
		const s = resolveWhatsNew({
			releases: FIXTURE,
			seenVersion: "garbage",
			currentVersion: "2026.09.1",
		});
		expect(s.unseenVersions.size).toBe(3);
	});
});

describe("localized", () => {
	test("falls back to English for a locale the entry doesn't carry", () => {
		expect(localized({ en: "Hello", ms: "Helo" }, "ms")).toBe("Helo");
		expect(localized({ en: "Hello", ms: "Helo" }, "zh")).toBe("Hello");
		expect(localized({ en: "Hello" }, "ms")).toBe("Hello");
	});
});

describe("the shipped RELEASES content", () => {
	test("every version is a valid calendar version", () => {
		for (const r of RELEASES) {
			expect(
				isCalendarVersion(r.version),
				`${r.version} is not a YYYY.MM.N version`,
			).toBe(true);
		}
	});

	test("is ordered newest-first", () => {
		// Enforced rather than left to convention: an out-of-order entry makes
		// "everything newer than X" return the wrong set, and the list renders in
		// array order, so the seller would read them backwards.
		for (let i = 1; i < RELEASES.length; i++) {
			expect(
				compareCalendarVersions(RELEASES[i - 1].version, RELEASES[i].version),
				`${RELEASES[i - 1].version} should sort after ${RELEASES[i].version}`,
			).toBeGreaterThan(0);
		}
	});

	test("has no duplicate versions", () => {
		const seen = new Set(RELEASES.map((r) => r.version));
		expect(seen.size).toBe(RELEASES.length);
	});

	test("every entry has non-empty English copy", () => {
		// `en` is the fallback every other locale resolves to, so an empty one
		// renders a blank row rather than degrading.
		for (const r of RELEASES) {
			expect(r.entries.length).toBeGreaterThan(0);
			for (const e of r.entries) {
				expect(e.title.en.trim().length).toBeGreaterThan(0);
				expect(e.body.en.trim().length).toBeGreaterThan(0);
			}
		}
	});

	test("every href is an in-app path, never an external URL", () => {
		// These render as router links inside /app. An absolute URL would either
		// break the router or quietly send a seller off-site from a dialog they
		// opened to read release notes.
		for (const r of RELEASES) {
			for (const e of r.entries) {
				if (e.href === undefined) continue;
				expect(e.href.startsWith("/app"), `${e.href} must start with /app`).toBe(
					true,
				);
			}
		}
	});

	test("every href resolves to a route that actually exists", () => {
		// A release note's deep link is the whole reason the note converts into
		// adoption, and a dead one is worse than no link — the seller taps, lands
		// nowhere, and learns not to trust the panel. `startsWith("/app")` above
		// only proves the shape; this proves the destination.
		//
		// Matched against the GENERATED route tree (the `buyer-routes.test.ts`
		// precedent) so a route rename breaks the note in CI rather than in a
		// seller's face.
		//
		// This checks the PATH only. `?tab=` is checked by the next test;
		// whether that tab is the right one for the feature stays an authoring
		// judgement — see docs/whats-new.md.
		const routeTree = readFileSync(
			join(__dirname, "../routeTree.gen.ts"),
			"utf8",
		);
		for (const r of RELEASES) {
			for (const e of r.entries) {
				if (e.href === undefined) continue;
				const path = e.href.split("?")[0].replace(/\/$/, "");
				expect(
					routeTree.includes(`'${path}'`),
					`${e.href} points at ${path}, which is not a route in routeTree.gen.ts`,
				).toBe(true);
			}
		}
	});

	test("every `?tab=` deep link names a settings tab that exists", () => {
		// `/app/settings` is the one destination where the path alone doesn't
		// locate the feature — the page is six tabs, and an unrecognised `tab`
		// silently falls back to Store. So a typo (`?tab=fulfillment`) or a tab
		// renamed out from under a note reads as "the feature moved" to the
		// seller, with nothing failing anywhere.
		//
		// Read as text, like the route tree above, rather than imported:
		// `app.settings.tsx` is a route module and pulling it into a unit test
		// drags the whole settings page with it.
		const settingsSource = readFileSync(
			join(__dirname, "../routes/app.settings.tsx"),
			"utf8",
		);
		const declared = settingsSource.match(
			/type SettingsTab =\s*([\s\S]*?);/,
		)?.[1];
		expect(declared, "could not find the SettingsTab union").toBeDefined();
		const tabs = [...(declared as string).matchAll(/"([a-z-]+)"/g)].map(
			(m) => m[1],
		);
		expect(tabs.length).toBeGreaterThan(1);

		for (const r of RELEASES) {
			for (const e of r.entries) {
				const tab = new URLSearchParams(e.href?.split("?")[1] ?? "").get(
					"tab",
				);
				if (tab === null) continue;
				expect(
					tabs.includes(tab),
					`${e.href} names tab "${tab}", which is not one of: ${tabs.join(", ")}`,
				).toBe(true);
			}
		}
	});
});
