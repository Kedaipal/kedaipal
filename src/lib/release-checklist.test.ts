// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for `docs/release-checklist.md`.
 *
 * The checklist's §2 table is a list of `git diff origin/main..origin/staging --
 * <paths>` commands, one per category of operator work. A row whose path is
 * WRONG does not error — `git diff` against a nonexistent path prints nothing
 * and exits 0 — so the row reports a clean "none" and the release PR body tells
 * the person merging there is nothing to do.
 *
 * That is not hypothetical. The plan-gating row pointed at `convex/plans.ts`,
 * which has never existed (the file is `convex/lib/plans.ts`). It reported
 * "none" across every release it was used on, including one that lowered Pro's
 * order cap 500→200 and raised Scale's price — a capability removal for paying
 * sellers, invisible to the audit that exists to catch exactly that.
 *
 * A stale path is indistinguishable from good news, which is the worst property
 * a safety checklist can have. This test makes it a red build instead.
 *
 * House precedent for a scan-the-source gate test: `convex-read-pattern.test.ts`,
 * `dependency-pins.test.ts`, `landing-funnel.test.ts`.
 */

const REPO_ROOT = join(__dirname, "../..");
const CHECKLIST = join(REPO_ROOT, "docs/release-checklist.md");

/**
 * Pull every path out of the `git diff … -- <paths>` invocations in the doc.
 *
 * Paths are the whitespace-separated tokens after ` -- `, stopping at the end of
 * the command (a pipe, a backtick, or the end of the markdown cell). Tokens
 * carrying a glob or a shell operator are skipped — only literal paths can be
 * checked for existence.
 */
function checklistPaths(markdown: string): string[] {
	const found = new Set<string>();
	for (const match of markdown.matchAll(/git diff[^`|]*? -- ([^`|\n]+)/g)) {
		for (const raw of match[1].trim().split(/\s+/)) {
			const token = raw.replace(/\\/g, "");
			if (!token || token.startsWith("-")) continue;
			if (/[*?$();]/.test(token)) continue;
			found.add(token);
		}
	}
	return [...found];
}

describe("docs/release-checklist.md", () => {
	test("every path a §2 audit row diffs actually exists in the repo", () => {
		const paths = checklistPaths(readFileSync(CHECKLIST, "utf8"));

		// Guard the parser itself: if the table is restructured and this stops
		// matching, an empty result would pass vacuously and the gate would be
		// silently gone — the same failure mode the test exists to prevent.
		expect(paths.length).toBeGreaterThanOrEqual(8);

		const missing = paths.filter((p) => !existsSync(join(REPO_ROOT, p)));
		expect(
			missing,
			`docs/release-checklist.md audits paths that do not exist: ${missing.join(
				", ",
			)}. \`git diff -- <missing path>\` prints nothing and exits 0, so the row ` +
				`reports "none" and the release ships with that category unaudited. ` +
				`Fix the path or drop the row.`,
		).toEqual([]);
	});

	test("the plan-gating row diffs the real plans module", () => {
		// The specific regression above, pinned by name so a future edit that
		// reintroduces `convex/plans.ts` fails with the reason attached.
		//
		// Asserted against the PARSED paths, not the raw markdown: the row's
		// prose names the dead path deliberately, to explain why the row is
		// written the way it is. Only what the command actually diffs counts.
		const paths = checklistPaths(readFileSync(CHECKLIST, "utf8"));
		expect(paths).toContain("convex/lib/plans.ts");
		expect(paths).not.toContain("convex/plans.ts");
	});

	test("every operator category is still listed, including the empty ones", () => {
		// The checklist's whole promise is that the merger never has to ask "is
		// there anything for me to do?" — which only holds if no category can
		// quietly fall out of the table.
		//
		// This list is deliberately hand-maintained rather than derived from the
		// doc: a derived list would delete itself along with the row it was
		// meant to protect, and pass. The count assertion below is what keeps
		// the two in step — a row added to the table without a name added here
		// fails, which is exactly how "Env vars CI does not sync" slipped
		// through its own PR (#276 review).
		const markdown = readFileSync(CHECKLIST, "utf8");
		const CATEGORIES = [
			"Environment variables",
			"Env vars CI does not sync",
			"Backfills / migrations",
			"Schema + indexes",
			"Crons",
			"HTTP routes / auth",
			"Outbound messaging",
			"Third-party setup",
			"Privacy policy",
			"Plan gating",
			"Assets",
		];

		for (const category of CATEGORIES) {
			expect(markdown, `checklist lost its "${category}" row`).toContain(
				`| **${category}**`,
			);
		}

		const rowCount = (markdown.match(/^\| \*\*/gm) ?? []).length;
		expect(
			rowCount,
			`the §2 table has ${rowCount} rows but only ${CATEGORIES.length} are ` +
				`pinned here. An unpinned row can be deleted with a green build — ` +
				`add its name to CATEGORIES.`,
		).toBe(CATEGORIES.length);
	});
});
