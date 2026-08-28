// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the standing frontend-read rule (ClickUp 86eyqgxe1).
 *
 * CLAUDE.md has said for months that every NEW frontend Convex read goes
 * through the TanStack Query adapter — `useQuery(convexQuery(api.x, args)).data`
 * — never plain `useQuery` from `convex/react`. The rule exists because Convex
 * drops a query's result the moment its last subscriber unmounts, so a plain
 * read makes every back-navigation a fresh skeleton + round-trip. See
 * docs/frontend-caching.md.
 *
 * It was prose in a large instructions file, and prose does not fail a build.
 * When this test was first written it immediately found a real violation on
 * staging (`app.customers.index.tsx` reading `api.customers.search`), missed
 * because the migration note exempting that file was about its PAGINATED list
 * and quietly swallowed the non-paginated read beside it. That is precisely the
 * class of drift a human reviewer will not reliably catch.
 *
 * House precedent for a scan-the-source gate test: `dependency-pins.test.ts`
 * (package.json specs) and `landing-funnel.test.ts` (forbidden copy strings).
 */

const SRC = join(__dirname, "..");

/**
 * Hooks that legitimately still come from `convex/react`.
 *
 * `usePaginatedQuery` is the load-bearing one: `@convex-dev/react-query` ships
 * no pagination wrapper, so paginated reads have no adapter form and must stay
 * native. The three mutation/action/client hooks are not reads at all — there
 * is nothing to cache — so the rule never applied to them.
 */
const ALLOWED_FROM_CONVEX_REACT = new Set([
	"useMutation",
	"useAction",
	"useConvex",
	"usePaginatedQuery",
	"useConvexAuth",
	"ConvexProvider",
	"ConvexReactClient",
	"Authenticated",
	"Unauthenticated",
	"AuthLoading",
]);

/** Reads that MUST go through the adapter instead. */
const BANNED_FROM_CONVEX_REACT = new Set(["useQuery", "useQueries"]);

/** Generated trees — not hand-written, and not ours to police. */
const SKIP_DIRS = new Set(["paraglide", "node_modules"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), acc);
			continue;
		}
		if (SKIP_FILES.has(entry.name)) continue;
		if (/\.tsx?$/.test(entry.name)) acc.push(join(dir, entry.name));
	}
	return acc;
}

/**
 * `[^}]*` spans newlines, so multi-line import blocks are covered — the common
 * shape once a file imports three or four hooks and Biome wraps them.
 */
const NAMED_IMPORT_RE =
	/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']convex\/react["']/g;
const NAMESPACE_IMPORT_RE =
	/import\s+\*\s+as\s+\w+\s+from\s*["']convex\/react["']/;

function importedNames(source: string): string[] {
	const names: string[] = [];
	for (const match of source.matchAll(NAMED_IMPORT_RE)) {
		for (const raw of match[1].split(",")) {
			// Normalise `type useQuery` and `useQuery as useConvexQuery` — an alias
			// still binds the banned hook, so the local name is irrelevant.
			const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
			if (name) names.push(name);
		}
	}
	return names;
}

const FILES = sourceFiles(SRC);

describe("frontend Convex reads use the TanStack adapter", () => {
	test("the scan actually walked the source tree", () => {
		// Without this, a broken walk (wrong path, over-eager skip) would make
		// every assertion below vacuously pass — a green test proving nothing is
		// worse than no test, because it also stops anyone writing a real one.
		expect(FILES.length).toBeGreaterThan(100);
		expect(FILES.some((f) => f.endsWith("app.customers.index.tsx"))).toBe(true);
	});

	test("no file imports useQuery from convex/react", () => {
		const offenders = FILES.filter((file) =>
			importedNames(readFileSync(file, "utf8")).some((n) =>
				BANNED_FROM_CONVEX_REACT.has(n),
			),
		).map((f) => relative(SRC, f));

		expect(
			offenders,
			[
				"These files read Convex through plain `convex/react`, which is not cached",
				"across navigation — every revisit re-fetches and re-renders a skeleton.",
				"",
				"Use the adapter instead:",
				'  import { convexQuery } from "@convex-dev/react-query";',
				'  import { useQuery } from "@tanstack/react-query";',
				"  const thing = useQuery(convexQuery(api.x.y, cond ? args : \"skip\")).data;",
				"",
				'Keep "skip" verbatim inside convexQuery (never hoist it to `enabled:`),',
				"and unwrap into a named `.data` variable so undefined-means-loading and",
				"null-means-not-found still hold. See docs/frontend-caching.md.",
				"",
				"`usePaginatedQuery` is exempt — the adapter has no pagination wrapper.",
			].join("\n"),
		).toEqual([]);
	});

	test("no file namespace-imports convex/react", () => {
		// `import * as convexReact` would let `convexReact.useQuery(...)` slip past
		// the named-import check above. Nobody writes this today; the check exists
		// so the gate can't be sidestepped by accident.
		const offenders = FILES.filter((file) =>
			NAMESPACE_IMPORT_RE.test(readFileSync(file, "utf8")),
		).map((f) => relative(SRC, f));

		expect(
			offenders,
			"Namespace-importing convex/react hides which hooks are used and bypasses the useQuery check. Import the hooks by name.",
		).toEqual([]);
	});

	test("the allowed convex/react hooks are still in use and not flagged", () => {
		// Guards the OTHER direction: if the matcher ever became over-eager, the
		// honest failure is "everything is an offender", which this catches by
		// asserting the legitimate hooks still import cleanly somewhere.
		const allUsed = new Set(
			FILES.flatMap((file) => importedNames(readFileSync(file, "utf8"))),
		);
		expect(allUsed.has("useMutation")).toBe(true);
		expect(allUsed.has("usePaginatedQuery")).toBe(true);
		for (const name of allUsed) {
			expect(
				ALLOWED_FROM_CONVEX_REACT.has(name) ||
					BANNED_FROM_CONVEX_REACT.has(name),
				`\`${name}\` is imported from convex/react but this test does not classify it. Add it to ALLOWED_FROM_CONVEX_REACT (not a read) or BANNED_FROM_CONVEX_REACT (a read that must use the adapter) — an unclassified hook silently escapes the gate.`,
			).toBe(true);
		}
	});
});
