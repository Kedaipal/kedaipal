// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Every file under `src/routes/` is either a route or deliberately excluded.
 *
 * TanStack Router's generator scans that directory and warns — on every dev
 * boot and every HMR pass — about any file that exports no `Route`. The comp
 * accounts work (z8r3fdeub2) put `app.admin.sellers.test.tsx` there, beside
 * the route whose `CompDialog`/`SellerCard` it imports, which is the right
 * home for it; the warning was the generator's, not the placement's.
 *
 * `vite.config.ts` now carries `routeFileIgnorePattern`, and this test is why
 * it can't quietly regress: the generator only WARNS, so dropping that line
 * would restore the noise without failing a single gate. It also catches the
 * other direction — a new non-route file under `src/routes/` that the pattern
 * doesn't cover — and tells you which knob to reach for.
 *
 * House precedent for a scan-the-source gate test: `convex-read-pattern.test.ts`,
 * `dependency-pins.test.ts`, `reserved-slugs.test.ts`.
 */

const ROUTES_DIR = join(__dirname, "../routes");
const VITE_CONFIG = join(__dirname, "../../vite.config.ts");

/** The pattern as the generator builds it: matched against the BASENAME. */
function configuredIgnoreRegExp(): RegExp {
	const source = readFileSync(VITE_CONFIG, "utf8");
	const declared = source.match(/routeFileIgnorePattern:\s*"((?:[^"\\]|\\.)*)"/);
	expect(
		declared,
		"vite.config.ts declares no routeFileIgnorePattern — a route test would warn on every dev boot",
	).not.toBeNull();
	// The literal is TS source, so its backslashes are escaped twice over.
	return new RegExp(JSON.parse(`"${(declared as RegExpMatchArray)[1]}"`));
}

/** Files the generator looks at: `.ts`/`.tsx`, minus the `-` prefix it skips. */
function routeDirFiles(): string[] {
	return readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" })
		.filter((name) => /\.tsx?$/.test(name))
		.filter((name) => !name.split("/").some((part) => part.startsWith("-")));
}

describe("src/routes contains only routes", () => {
	test("every file either exports a Route or is excluded by the config", () => {
		const ignore = configuredIgnoreRegExp();
		const offenders = routeDirFiles().filter((name) => {
			const basename = name.split("/").pop() as string;
			if (ignore.test(basename)) return false;
			return !/export const Route\b/.test(
				readFileSync(join(ROUTES_DIR, name), "utf8"),
			);
		});
		expect(
			offenders,
			`these exist under src/routes/ but export no Route, so the generator warns on every dev boot. Either give them a Route, move them out, or widen routeFileIgnorePattern in vite.config.ts:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	test("the pattern excludes route tests and nothing else", () => {
		const ignore = configuredIgnoreRegExp();
		expect(ignore.test("app.admin.sellers.test.tsx")).toBe(true);
		expect(ignore.test("checkout.test.ts")).toBe(true);
		// A real route must never be swallowed — including one whose own name
		// merely contains the word.
		expect(ignore.test("app.admin.sellers.tsx")).toBe(false);
		expect(ignore.test("app.test-drive.tsx")).toBe(false);
	});
});
