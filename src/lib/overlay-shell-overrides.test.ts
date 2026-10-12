// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the OVERLAY shells' height contracts — `DialogContent`
 * (PR #273) and `DropdownMenuContent` (the admin Sellers "Manage" menu, whose
 * seven described items overflowed a laptop window with the first item,
 * "Open store", pushed above the top edge and unreachable).
 *
 * Both shells cap their height and scroll the y-axis, and in both the caller
 * can quietly undo it, so both are policed here by one scan.
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
 * Every `<Component …>` opening tag's attribute text. Brace-aware so a `>`
 * inside `className={cond ? … : …}` doesn't end the tag early.
 */
function openingTags(source: string, component: string): string[] {
	const tags: string[] = [];
	const open = new RegExp(`<${component}(?=[\\s/>])`, "g");
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
			(f) => openingTags(readFileSync(f, "utf8"), "DialogContent").length > 0,
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
			openingTags(readFileSync(checkout, "utf8"), "DialogContent").some((t) =>
				t.includes("max-h-"),
			),
			"app.checkout.tsx passes its own max-h to a DialogContent; not seeing it means attributes are being truncated.",
		).toBe(true);
	});

	test("no call site overrides the shell's overflow or removes its cap", () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			for (const tag of openingTags(
				readFileSync(file, "utf8"),
				"DialogContent",
			)) {
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

/**
 * The menu shell's forbidden set. It differs from the dialog's in one place:
 * a menu is anchored to its trigger, so its cap is Radix's measured
 * `--radix-dropdown-menu-content-available-height` rather than a dvh figure.
 * A caller pinning its own `max-h-*` would ignore the space actually below the
 * trigger, so — unlike the dialog, where any cap is a cap — only the measured
 * one is right here, and overriding it at all is forbidden.
 */
const MENU_FORBIDDEN = [
	// The shorthand replaces BOTH axes — always wrong here.
	/\boverflow-(?:auto|hidden|clip|visible|scroll)\b/,
	// Kills the scroll, so a tall menu is clipped again.
	/\boverflow-y-(?:hidden|clip|visible)\b/,
	// The x-axis is what keeps the rounded corners clipping.
	/\boverflow-x-(?:auto|visible|scroll)\b/,
	// Any cap of the caller's own, including removing it outright.
	/\bmax-h-/,
];

describe("DropdownMenuContent call sites keep the shell's height contract", () => {
	test("the scan finds the call sites it is meant to police", () => {
		const withMenus = FILES.filter(
			(f) =>
				openingTags(readFileSync(f, "utf8"), "DropdownMenuContent").length > 0,
		);
		// Five real call sites today, plus the primitive's own test.
		expect(withMenus.length).toBeGreaterThan(3);
		expect(
			withMenus.some((f) => f.endsWith("seller-manage-menu.tsx")),
			"seller-manage-menu.tsx is the call site this contract was written for; not seeing it means the tag scanner is broken.",
		).toBe(true);
		// And it must actually read the attributes, not just the tag name.
		const manage = FILES.find((f) => f.endsWith("seller-manage-menu.tsx"));
		if (!manage) throw new Error("seller-manage-menu.tsx not found");
		expect(
			openingTags(readFileSync(manage, "utf8"), "DropdownMenuContent").some(
				(t) => t.includes("w-72"),
			),
			"seller-manage-menu.tsx passes w-72 to its DropdownMenuContent; not seeing it means attributes are being truncated.",
		).toBe(true);
	});

	test("no call site overrides the shell's overflow or its measured cap", () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			if (file.endsWith("dropdown-menu.test.tsx")) continue; // asserts the contract itself
			for (const tag of openingTags(
				readFileSync(file, "utf8"),
				"DropdownMenuContent",
			)) {
				const bad = MENU_FORBIDDEN.filter((re) => re.test(tag));
				if (bad.length)
					offenders.push(
						`${relative(SRC, file)} — ${bad.map((re) => String(re)).join(", ")}`,
					);
			}
		}

		expect(
			offenders,
			[
				"These DropdownMenuContent call sites pass a class that undoes the",
				"shell's height contract. cn() is twMerge, so the caller's class WINS",
				"and the shell's own",
				"`max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto`",
				"is stripped — which puts a tall menu's top items back above the",
				"viewport with nothing to scroll back to.",
				"",
				"The cap must stay Radix's measured available height: a hand-picked",
				"max-h ignores how much room is actually below the trigger. If a region",
				"inside the menu should scroll on its own, put the max-h on THAT region.",
				"See docs/design-system.md.",
			].join("\n"),
		).toEqual([]);
	});
});
