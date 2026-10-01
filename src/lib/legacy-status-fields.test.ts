// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The invariant the NARROW depends on: nothing writes the legacy status fields
 * any more (`z8r3fdh3w1`).
 *
 * `retailers.statusLabels` and the flat `retailers.orderStages` are read-only
 * legacy — the per-kind `orderFlows` replaced both. They still exist because 5
 * prod stores carry an `orderStages` list that `migrations:backfillOrderFlows`
 * has yet to move, and Convex validates EVERY existing document against the
 * schema, so the fields cannot be dropped until those rows are converted.
 *
 * That makes "nothing writes them" load-bearing rather than tidy: a single new
 * write would mint fresh legacy rows, the backfill would never converge, and
 * the narrow could never land. `retailers.updateSettings` still ACCEPTS both
 * args (the migration's own tests author pre-`orderFlows` rows through them),
 * so the wire is open and only this test keeps it unused.
 *
 * House precedent for a scan-the-source gate: `convex-read-pattern.test.ts`,
 * `dependency-pins.test.ts`, `landing-funnel.test.ts`.
 *
 * **When the narrow lands, delete this file** — the fields it guards will be
 * gone, and a test guarding nothing is worse than no test.
 */

const SRC = join(__dirname, "..");
const LEGACY_WRITE_KEYS = ["statusLabels", "orderStages"] as const;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "paraglide" || entry.name === "node_modules") continue;
			out.push(...sourceFiles(full));
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		if (/\.test\.tsx?$/.test(entry.name)) continue;
		out.push(full);
	}
	return out;
}

/** The argument text of every `updateSettings(...)` call in a file, extracted
 * by balancing parentheses so a nested object or arrow body can't truncate it. */
function updateSettingsArgs(src: string): string[] {
	const calls: string[] = [];
	const needle = "updateSettings(";
	let from = 0;
	for (;;) {
		const start = src.indexOf(needle, from);
		if (start < 0) break;
		let depth = 0;
		let i = start + needle.length - 1;
		for (; i < src.length; i++) {
			if (src[i] === "(") depth++;
			else if (src[i] === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		calls.push(src.slice(start, i + 1));
		from = i + 1;
	}
	return calls;
}

describe("legacy status fields are read-only from the frontend", () => {
	test("no updateSettings call passes statusLabels or orderStages", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const src = readFileSync(file, "utf8");
			for (const call of updateSettingsArgs(src)) {
				for (const key of LEGACY_WRITE_KEYS) {
					// `key:` as an object property — a read like `retailer.statusLabels`
					// passed along as a prop is fine and must not trip this.
					if (new RegExp(`[{,]\\s*${key}\\s*:`).test(call)) {
						offenders.push(`${relative(SRC, file)} → updateSettings({ ${key}: … })`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the guard actually catches a write (it is not vacuous)", () => {
		// A scan test that matches nothing is indistinguishable from a broken one,
		// so prove the matcher fires on the shape it is meant to forbid.
		const bad = "await updateSettings({ statusLabels: { en: { shipped: 'x' } } });";
		const calls = updateSettingsArgs(bad);
		expect(calls).toHaveLength(1);
		expect(/[{,]\s*statusLabels\s*:/.test(calls[0])).toBe(true);

		// …and does NOT fire on a legitimate read being forwarded as a prop.
		const good = "await updateSettings({ orderFlows });";
		expect(/[{,]\s*orderStages\s*:/.test(updateSettingsArgs(good)[0])).toBe(false);
	});
});
