// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement: the browser never loads a Convex FUNCTION module
 * (ClickUp z8r3fdv49m).
 *
 * A file directly under `convex/` (`credits.ts`, `orders.ts`, …) registers
 * queries and mutations at import time. Loading one in the browser makes
 * Convex log "Convex functions should not be imported in the browser. This
 * will throw an error in future versions of `convex`" — once per function in
 * the module. `credit-meter.tsx` value-imported a constant from
 * `convex/credits.ts` and every `/app` load logged it ~20×; in a future Convex
 * release the same import throws and the dashboard does not render.
 *
 * The client may load only:
 *   - `convex/_generated/*` — `api` is a proxy of function REFERENCES, no code;
 *   - `convex/lib/*` — pure helpers shared by client and server;
 *   - anything at all with `import type` / `export type`, which is erased.
 *
 * `verbatimModuleSyntax` is on, so `import { type X } from "…"` is NOT erased —
 * it compiles to `import {} from "…"`, which still loads the module. Only the
 * `type` keyword on the whole statement counts.
 *
 * The walk is TRANSITIVE through `convex/lib`: a lib helper that itself
 * value-imports a function module (`lib/voucherRedemption.ts` →
 * `../subscriptions`) leaks it into any client file that imports the helper,
 * and a per-file check would call that clean.
 *
 * Sibling gate: `convex-read-pattern.test.ts` (same scan-the-source shape).
 */

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..");
const CONVEX = join(ROOT, "convex");

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
 * Every specifier a file LOADS at runtime: static `import … from`, bare
 * side-effect `import "…"`, `export … from`, and dynamic `import("…")` —
 * minus the statement forms TypeScript erases. `[^;]*?` spans newlines, so
 * Biome-wrapped multi-line import blocks are covered.
 */
const STATIC_RE =
	/\b(import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /\bimport\s*["']([^"']+)["']/g;
/** `typeof import("…")` is a type position — erased, so excluded. */
const DYNAMIC_RE = /(typeof\s+)?\bimport\(\s*["']([^"']+)["']\s*\)/g;

function loadedSpecifiers(source: string): string[] {
	const specs: string[] = [];
	for (const m of source.matchAll(STATIC_RE)) if (!m[2]) specs.push(m[3]);
	for (const m of source.matchAll(SIDE_EFFECT_RE)) specs.push(m[1]);
	for (const m of source.matchAll(DYNAMIC_RE)) if (!m[1]) specs.push(m[2]);
	return specs;
}

function resolveFile(fromFile: string, spec: string): string | null {
	if (!spec.startsWith(".")) return null;
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		join(base, "index.ts"),
	];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

type Zone = "generated" | "lib" | "function-module";

function convexZone(file: string): Zone | null {
	const rel = relative(CONVEX, file);
	if (rel.startsWith("..")) return null;
	const top = rel.split(sep)[0];
	if (top === "_generated") return "generated";
	if (top === "lib") return "lib";
	return "function-module";
}

/**
 * For one client file, every chain that ends in a function module, e.g.
 * `src/x.tsx → convex/lib/a.ts → convex/subscriptions.ts`. Recurses only
 * through `convex/lib` (src → src edges are covered because every src file is
 * itself a root; `_generated` is trusted).
 */
function leakChains(root: string): string[][] {
	const chains: string[][] = [];
	const seen = new Set<string>();
	const walk = (file: string, path: string[]) => {
		for (const spec of loadedSpecifiers(readFileSync(file, "utf8"))) {
			const target = resolveFile(file, spec);
			if (!target) continue;
			const zone = convexZone(target);
			if (zone === "function-module") {
				chains.push([...path, target]);
			} else if (zone === "lib" && !seen.has(target)) {
				seen.add(target);
				walk(target, [...path, target]);
			}
		}
	};
	walk(root, [root]);
	return chains;
}

const FILES = sourceFiles(SRC);

describe("the client never loads a Convex function module", () => {
	test("the scan actually walked the source tree", () => {
		// A broken walk would make the real assertion pass vacuously.
		expect(FILES.length).toBeGreaterThan(100);
		expect(
			FILES.some((f) => f.endsWith(join("credits", "credit-meter.tsx"))),
		).toBe(true);
	});

	test("the matcher tells loads from erased type imports", () => {
		// Guards the matcher in BOTH directions, so a regex edit that silently
		// stops seeing loads (or starts flagging type imports) goes red here.
		const src = [
			'import { a } from "../convex/credits";',
			'import {\n\tb,\n\tc,\n} from "../convex/orders";',
			'import { type D } from "../convex/kept";',
			'import * as ns from "../convex/ns";',
			'export { e } from "../convex/reexport";',
			'import "../convex/sideEffect";',
			'const m = await import("../convex/dynamic");',
			'import type { T } from "../convex/typeOnly";',
			'import type {\n\tU,\n} from "../convex/typeOnlyMulti";',
			'export type { V } from "../convex/typeReexport";',
			'type W = typeof import("../convex/typeofImport");',
		].join("\n");
		expect(loadedSpecifiers(src).sort()).toEqual(
			[
				"../convex/credits",
				"../convex/orders",
				"../convex/kept",
				"../convex/ns",
				"../convex/reexport",
				"../convex/sideEffect",
				"../convex/dynamic",
			].sort(),
		);
	});

	test("no src file loads a convex function module, directly or via convex/lib", () => {
		const offenders = FILES.flatMap(leakChains).map((chain) =>
			chain.map((f) => relative(ROOT, f)).join(" → "),
		);

		expect(
			offenders,
			[
				"These client files load a Convex FUNCTION module (a file directly under",
				"convex/ that registers queries/mutations). In the browser that logs",
				'"Convex functions should not be imported in the browser" per function,',
				"and a future Convex release makes it throw.",
				"",
				"Fix by moving the shared value into a pure module under convex/lib/ and",
				"importing it from there (server code imports it from lib too). A type",
				"is fine where it is — use `import type { … }`, not `import { type … }`",
				"(verbatimModuleSyntax keeps the latter as a runtime import).",
			].join("\n"),
		).toEqual([]);
	});
});
