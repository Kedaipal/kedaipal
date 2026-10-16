import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `blur-[0.3px]` COMPILES TO NOTHING in this Tailwind v4 setup — silently.
 *
 * Verified against a real `pnpm build` (z8r3fdcw72): `blur(1px)` and
 * `blur(3px)` are both present in `dist/**\/*.css`, `blur(0.3px)` and
 * `blur(0.4px)` are not. It is specific to `blur` with a fractional length —
 * `translate-x-[0.5px]` compiles fine — so the usual "arbitrary values work"
 * intuition does not save you, and nothing fails: the class is simply absent
 * and the element renders unblurred.
 *
 * That is a bad failure mode for a blur, because the thing a blur is usually
 * hiding (a locked Pro sample, a smudged countdown in a torn receipt) looks
 * *fine* when the blur silently doesn't apply. Set a sub-pixel blur as an
 * inline `filter` style instead — see `CountdownStrip`'s `SMUDGE`.
 *
 * This scans source rather than the build so it fails in the fast gate, next
 * to the person who typed it. Same posture as
 * `src/lib/convex-read-pattern.test.ts`.
 */

const SRC = join(import.meta.dirname, "..");
const EXTENSIONS = [".ts", ".tsx"];
/** `blur-[0.3px]`, `backdrop-blur-[.5rem]` — any fractional arbitrary blur. */
const FRACTIONAL_BLUR =
	/\bbackdrop-blur-\[\s*\.?\d*\.\d|\bblur-\[\s*\.?\d*\.\d/;

/** A `//`, `*` or `/*` line — close enough for a scanner whose only job is
 * to let a warning describe the thing it warns about. */
function isComment(line: string): boolean {
	const t = line.trim();
	return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "paraglide" || entry === "node_modules") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
			continue;
		}
		if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
	}
	return out;
}

describe("Tailwind arbitrary blur", () => {
	test("no source uses a fractional blur-[…] — it compiles to nothing", () => {
		const offenders = sourceFiles(SRC)
			.filter(
				(file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
			)
			.flatMap((file) => {
				const lines = readFileSync(file, "utf8").split("\n");
				return (
					lines
						.map((line, i) => ({ file, line: i + 1, text: line }))
						// Comments are where this trap gets EXPLAINED, so they must be
						// allowed to name the class they are warning about.
						.filter(({ text }) => !isComment(text))
						.filter(({ text }) => FRACTIONAL_BLUR.test(text))
				);
			})
			.map(({ file, line }) => `${file.slice(SRC.length + 1)}:${line}`);
		expect(offenders).toEqual([]);
	});

	test("the pattern catches what it is meant to, and lets whole pixels through", () => {
		expect(FRACTIONAL_BLUR.test('className="blur-[0.3px]"')).toBe(true);
		expect(FRACTIONAL_BLUR.test('className="blur-[.5px]"')).toBe(true);
		expect(FRACTIONAL_BLUR.test('className="backdrop-blur-[1.5px]"')).toBe(
			true,
		);
		// These DO compile — the two already in the codebase must stay legal.
		expect(FRACTIONAL_BLUR.test('className="blur-[3px]"')).toBe(false);
		expect(FRACTIONAL_BLUR.test('className="backdrop-blur-[1px]"')).toBe(false);
		expect(FRACTIONAL_BLUR.test('className="blur-sm"')).toBe(false);
	});
});
