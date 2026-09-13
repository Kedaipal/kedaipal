/// <reference types="vite/client" />
/**
 * A committed conflict marker must never reach a branch.
 *
 * This exists because one did: a `<<<<<<< ours` line survived a merge
 * resolution inside a BLOCK COMMENT in `convex/http.ts`, where neither `tsc`
 * nor `biome` could see it — both parse it as comment text. It would have
 * shipped. The gate is the only place that can catch that class, so it does.
 *
 * Same posture as `convex-read-pattern.test.ts` and `dependency-pins.test.ts`:
 * a rule you'd otherwise have to remember becomes a rule the machine keeps.
 */
import { describe, expect, test } from "vitest";

// Assembled at runtime so this file can't trip its own check.
const OPEN = "<".repeat(7);
const SPLIT = "=".repeat(7);
const CLOSE = ">".repeat(7);

const sources = import.meta.glob("../../{convex,src}/**/*.{ts,tsx}", {
	eager: true,
	query: "?raw",
	import: "default",
}) as Record<string, string>;

describe("no committed merge conflict markers", () => {
	test("scans the whole source tree", () => {
		// Sanity: if the glob ever stops matching, the test must fail loudly
		// rather than silently pass over zero files.
		expect(Object.keys(sources).length).toBeGreaterThan(100);
	});

	test("finds none", () => {
		const offenders: string[] = [];
		for (const [file, contents] of Object.entries(sources)) {
			if (file.endsWith("no-merge-markers.test.ts")) continue;
			const lines = contents.split("\n");
			lines.forEach((line, i) => {
				if (
					line.startsWith(OPEN) ||
					line.startsWith(CLOSE) ||
					line === SPLIT
				) {
					offenders.push(`${file}:${i + 1} — ${line.slice(0, 40)}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
