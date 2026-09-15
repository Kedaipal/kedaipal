// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the dialog shell's height contract (PR #273).
 *
 * `DialogContent` caps itself at `calc(100dvh-2rem)` and scrolls the y-axis,
 * because a dialog is centred with `-translate-y-1/2`: without the pair, content
 * taller than the viewport overflows at BOTH ends and is clipped rather than
 * scrolled, and `DialogFooter`'s Cancel and confirm buttons go out of reach with
 * nothing to scroll back.
 *
 * `cn()` is `twMerge`, so a CALL SITE can quietly undo that. A caller passing
 * `overflow-hidden` strips both classes and restores the exact bug; `max-h-none`
 * removes the cap on its own. dialog.test.tsx proves the shell's own contract
 * and is blind to this — a class the caller passes never reaches it.
 *
 * No call site does either today. This test exists so that stays true, in the
 * house style of `convex-read-pattern.test.ts` and `landing-funnel.test.ts`:
 * a rule that lives only in a comment does not fail a build.
 */

const SRC = join(__dirname, "..");
const SKIP_DIRS = new Set(["paraglide", "node_modules"]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) sourceFiles(full, acc);
		} else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
			acc.push(full);
		}
	}
	return acc;
}

const FILES = sourceFiles(SRC);

/**
 * Every `<DialogContent …>` opening tag's attribute text. Brace-aware so a
 * `>` inside `className={cond ? … : …}` doesn't end the tag early.
 */
function dialogContentTags(source: string): string[] {
	const tags: string[] = [];
	const open = /<DialogContent(?=[\s/>])/g;
	let m = open.exec(source);
	while (m !== null) {
		let depth = 0;
		let i = m.index + m[0].length;
		for (; i < source.length; i++) {
			const c = source[i];
			if (c === "{") depth++;
			else if (c === "}") depth--;
			else if (c === ">" && depth === 0) break;
		}
		tags.push(source.slice(m.index, i));
		m = open.exec(source);
	}
	return tags;
}

/**
 * Classes that would undo the contract via twMerge.
 *
 * `overflow-y-scroll` is deliberately absent — it keeps the scroll and only
 * pins the scrollbar visible. A bigger or smaller `max-h-*` is fine too: it is
 * still a cap, which is the thing that matters (app.checkout passes
 * `max-h-[85dvh]`).
 */
const FORBIDDEN = [
	// The shorthand replaces BOTH axes — always wrong here.
	/\boverflow-(?:auto|hidden|clip|visible|scroll)\b/,
	// Kills the scroll, so tall content is clipped again.
	/\boverflow-y-(?:hidden|clip|visible)\b/,
	// The x-axis is what rounds the full-bleed footer's corners.
	/\boverflow-x-(?:auto|visible|scroll)\b/,
	// Removes the cap outright.
	/\bmax-h-none\b/,
];

describe("DialogContent call sites keep the shell's height contract", () => {
	test("the scan finds the call sites it is meant to police", () => {
		// A matcher that silently finds nothing is worse than no test — it also
		// stops anyone from writing a real one.
		const withDialogs = FILES.filter(
			(f) => dialogContentTags(readFileSync(f, "utf8")).length > 0,
		);
		expect(withDialogs.length).toBeGreaterThan(10);
		expect(
			withDialogs.some((f) => f.endsWith("confirm-dialog.tsx")),
			"confirm-dialog.tsx is the most-used DialogContent call site; not seeing it means the tag scanner is broken.",
		).toBe(true);
		// And it must actually read the attributes, not just the tag name.
		const checkout = FILES.find((f) => f.endsWith("app.checkout.tsx"));
		if (!checkout) throw new Error("app.checkout.tsx not found");
		expect(
			dialogContentTags(readFileSync(checkout, "utf8")).some((t) =>
				t.includes("max-h-"),
			),
			"app.checkout.tsx passes its own max-h to a DialogContent; not seeing it means attributes are being truncated.",
		).toBe(true);
	});

	test("no call site overrides the shell's overflow or removes its cap", () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			for (const tag of dialogContentTags(readFileSync(file, "utf8"))) {
				const bad = FORBIDDEN.filter((re) => re.test(tag));
				if (bad.length)
					offenders.push(
						`${relative(SRC, file)} — ${bad.map((re) => String(re)).join(", ")}`,
					);
			}
		}

		expect(
			offenders,
			[
				"These DialogContent call sites pass a class that undoes the shell's",
				"height contract. cn() is twMerge, so the caller's class WINS and the",
				"shell's own `max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto`",
				"is stripped — which puts DialogFooter's Cancel and confirm buttons back",
				"out of reach on any dialog taller than the viewport.",
				"",
				"If a region inside the dialog should scroll while the rest holds still,",
				"put the max-h + overflow-y-auto on THAT region, not on DialogContent.",
				"A different `max-h-*` on the shell is fine; removing the cap is not.",
				"See docs/design-system.md.",
			].join("\n"),
		).toEqual([]);
	});
});
