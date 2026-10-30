// @vitest-environment node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { DARK_COVERAGE_BUDGET } from "./dark-mode-coverage-budget";

const BUDGET_HEADER = `// GENERATED — do not hand-edit.
// Regenerate: KP_WRITE_DARK_BUDGET=1 pnpm vitest run src/lib/dark-mode-coverage.test.ts
//
// How many raw palette colours each themed file still carries without a \`dark:\`
// counterpart. Every entry is a small dark-mode blemish that has not been worth
// a diff yet; a file missing from this list must have ZERO. The counts are
// asserted exactly, so they can only ever go down. See dark-mode-coverage.test.ts.

`;

/**
 * Machine enforcement for dark mode (ClickUp z8r3fdadub).
 *
 * Semantic tokens (`bg-card`, `text-foreground`, `border-border`) flip between
 * themes on their own. Raw palette colours (`bg-amber-50`, `text-emerald-800`)
 * do not: on a dark page they become a light plate or dark-on-dark text. So the
 * house rule is "a raw palette colour needs a `dark:` counterpart on the same
 * element" — and that rule is exactly the kind a busy person forgets, which is
 * why it lives here and not only in docs/design-system.md.
 *
 * This answers the question every new component raises: no, you do not have to
 * remember. Use semantic tokens and nothing fires; reach for a raw palette
 * colour and the gate asks you for its dark pair.
 *
 * SCOPE: only files that can actually render dark. The marketing site is
 * deliberately always-light (`isThemedRouteId` in lib/theme.ts never matches it,
 * and the shell omits the theme script there), so policing it would demand dark
 * pairs that can never be seen.
 *
 * THE BUDGET: `dark-mode-coverage-budget.ts` records how many uncovered colours
 * each file still has. A file absent from it must have zero. The counts are
 * asserted EXACTLY, not as a ceiling — fixing a colour makes the test fail until
 * you lower the number, which is what stops the list quietly rotting back
 * upward. Numbers only ever go down.
 *
 * House precedent for a scan-the-source gate: `convex-read-pattern.test.ts`,
 * `dependency-pins.test.ts`, `landing-funnel.test.ts`.
 */

const SRC = join(__dirname, "..");

/** Tailwind palette families. `white`/`black` have no numeric step. */
const PALETTE =
	"white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Properties whose colour we care about; `shadow`/`outline` rarely matter. */
const PROPS =
	"bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|caret|decoration";

const COLOUR_RE = new RegExp(
	`^(${PROPS})-(${PALETTE})(?:-(\\d{2,3}))?(?:\\/(\\d+))?$`,
);

/**
 * A saturated fill (400 and up). These are picked for their own hue — an amber
 * "attention" pill, an orange unread dot, an emerald confirm button — and read
 * on either ground, so they are not what breaks in dark. The light PLATES are:
 * `bg-X-50/100/200/300` and `bg-white`, which is what this gate hunts.
 */
const SATURATED_BG_RE = new RegExp(
	`^bg-(?:${PALETTE})-(?:[4-9]00|950)(?:\\/\\d+)?$`,
);

/**
 * Directories whose files can render with `.dark` on <html> — since 20 Oct
 * 2026 that is every directory of UI (the first cut themed only the app and
 * the storefront; the marketing site, /stores and the legal pages joined when
 * the seam between them stopped being defensible).
 */
const THEMED_COMPONENT_DIRS = [
	"components/dashboard",
	"components/settings",
	"components/order",
	"components/forms",
	"components/insights",
	"components/storefront",
	"components/claim",
	"components/admin",
	"components/app",
	"components/ui",
	// Added when staging caught up (Oct 2026): every one of these renders under
	// /app, so a raw colour in them is a dark-mode bug like any other.
	"components/counter",
	"components/credits",
	"components/deliveries",
	"components/home",
	"components/hours",
	"components/orders",
	"components/product",
	"components/products",
	"components/promotions",
	"components/vouchers",
	"components/cost",
	"components/landing",
	"components/legal",
	"components/onboarding",
	"components/marketplace",
	"components/not-found",
];

// Every route. Only the blog is outside the theme, and it is another repo.
const THEMED_ROUTE_RE = /^routes[/\\]/;

/**
 * Exempt inside themed scope, with the reason. These are not oversights: a
 * colour here is doing a job that has nothing to do with the viewer's theme.
 */
const EXEMPT_FILES: Record<string, string> = {
	"components/dashboard/brand-icons.tsx":
		"external brand identities — a mint WhatsApp glyph reads as a bug",
	"components/ui/my-phone-input.tsx":
		"national flag SVGs are fixed by law of flags",
	"components/dashboard/order-bulk-bar.tsx":
		"documented deliberate inversion — the floating bar stays high-contrast in both modes",
	"components/ui/zoomable-image.tsx":
		"fullscreen lightbox chrome on a fixed bg-black/90 ground",
	"components/storefront/category-rail.tsx":
		"the deterministic fallback gradients — saturated decorative fills standing in for photography, read under the same scrim a real photo gets; a per-line marker on each of the five would be noise",
	"components/landing/hero-stage.tsx":
		"the product acted out on a phone — a PICTURE of the app, with its own light screen and black bezel in both themes; a screenshot does not follow the viewer's theme",
	"components/landing/payment-handshake.tsx":
		"the payment flow acted out on a phone — same reasoning as hero-stage",
	"components/landing/pay-now.tsx":
		"the online-payment flow acted out on a phone — same reasoning as hero-stage",
	"components/marketplace/showcase-stage.tsx":
		"showcase art: every mood is a dark ground with light text, read the same in both themes (styles.css, kp-showcase-*)",
	"components/marketplace/showcase-ticket.tsx":
		"showcase art, as showcase-stage",
};

/** Whole subtrees that never see the theme. */
const EXEMPT_DIRS = ["components/poster"];

/**
 * Directories that never render under `.dark`, with the reason. Empty since
 * 20 Oct 2026 — everything renders under the theme now — but kept so a future
 * unthemed directory has a home and the classification guard stays exhaustive.
 *
 * Every directory under src/components must be in THIS map, in
 * THEMED_COMPONENT_DIRS or in EXEMPT_DIRS — the test below fails otherwise.
 * Without that, a new feature folder silently falls outside the scan, which is
 * exactly how the list above went stale between August and October while
 * `home/`, `promotions/`, `vouchers/` and seven others shipped unscanned.
 */
const UNTHEMED_COMPONENT_DIRS: Record<string, string> = {};

/**
 * Black is not a Kedaipal colour. The dark ink is NAVY: `bg-segment` for chips,
 * badges, pill toggles and the countdown's paper (`--primary` at 11% lightness
 * reads black at that size — Arif, 19 Oct 2026, "use our navy blue, not
 * black"; Zaki, 20 Oct, for the badges and the countdown), `bg-primary` for
 * buttons. The one place black belongs is a phone bezel inside a product
 * mockup, and those files are exempt above. Translucent `bg-black/NN` scrims
 * are not ink and stay allowed.
 */
/**
 * A translucent WHITE fill at or above this opacity is a light PLATE, not a
 * scrim (z8r3fdwf9t). Below it, white is a sheen that composites over whatever
 * is behind it and reads in both themes (`bg-white/10` on a dark card,
 * `bg-white/15` on a photo). At 40% and up it dominates the ground: the admin
 * billing tiles shipped `bg-white/70` icon wells that were near-white discs on
 * a `-950` tile in dark, and the blanket "any `/NN` is a scrim" exemption is
 * what let them through. Black stays exempt at any opacity — a dark scrim is
 * dark in both themes.
 */
const WHITE_PLATE_MIN_OPACITY = 40;

const BLACK_INK_RE =
	/\b(?:bg|border|from|via|to)-(?:black|(?:slate|zinc|neutral|gray|stone)-9[05]0)\b(?!\/)/g;

const SKIP_DIRS = new Set(["paraglide", "node_modules"]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), acc);
			continue;
		}
		if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
			acc.push(join(dir, entry.name));
		}
	}
	return acc;
}

function toPosix(p: string): string {
	return p.split(sep).join("/");
}

function isThemed(rel: string): boolean {
	if (EXEMPT_DIRS.some((d) => rel.startsWith(`${d}/`))) return false;
	if (rel in EXEMPT_FILES) return false;
	if (THEMED_ROUTE_RE.test(rel)) return true;
	return THEMED_COMPONENT_DIRS.some((d) => rel.startsWith(`${d}/`));
}

type Token = { variants: string[]; utility: string };

/** Splits `md:dark:hover:bg-amber-50` into variants + bare utility. */
function parseToken(raw: string): Token | null {
	if (!raw || raw.includes("[") || raw.includes("(")) return null;
	const parts = raw.split(":");
	const utility = parts.pop() ?? "";
	return { variants: parts, utility: utility.replace(/^-/, "") };
}

/**
 * Class-ish string literals on a line. Deliberately loose: it over-collects
 * (any quoted word can look like a class), which is safe because only strings
 * matching COLOUR_RE are ever counted.
 */
function tokensOn(line: string): Token[] {
	const out: Token[] = [];
	for (const chunk of line.split(/[\s"'`{}(),;]+/)) {
		const token = parseToken(chunk);
		if (token) out.push(token);
	}
	return out;
}

function variantKey(variants: string[]): string {
	return [...variants]
		.filter((v) => v !== "dark")
		.sort()
		.join(":");
}

/** Uncovered = a palette colour with no same-property, same-variant dark twin. */
function uncoveredOn(line: string): string[] {
	const tokens = tokensOn(line);
	const hasSaturatedBg = tokens.some(
		(t) => !t.variants.includes("dark") && SATURATED_BG_RE.test(t.utility),
	);

	const darkByKey = new Set(
		tokens
			.filter((t) => t.variants.includes("dark"))
			.map((t) => `${t.utility.split("-")[0]}|${variantKey(t.variants)}`),
	);

	const found: string[] = [];
	for (const token of tokens) {
		if (token.variants.includes("dark")) continue;
		const match = COLOUR_RE.exec(token.utility);
		if (!match) continue;

		const [, prop, family, step] = match;

		// Translucent scrims composite over whatever is behind them — except a
		// white FILL dense enough to be a plate (WHITE_PLATE_MIN_OPACITY).
		if (
			(family === "white" || family === "black") &&
			token.utility.includes("/") &&
			!(
				prop === "bg" &&
				family === "white" &&
				Number(token.utility.split("/")[1]) >= WHITE_PLATE_MIN_OPACITY
			)
		) {
			continue;
		}
		// A saturated fill is chosen for its hue, not for contrast with the page.
		if (SATURATED_BG_RE.test(token.utility)) continue;
		// White text on such a fill is legible on either ground.
		if (prop === "text" && family === "white" && hasSaturatedBg) continue;
		// `text-black` is vanishingly rare and always deliberate.
		if (family === "black" && prop === "text") continue;
		// 500-level marks (icons, dots) carry through both themes.
		if (prop !== "bg" && step && Number(step) === 500) continue;

		if (darkByKey.has(`${prop}|${variantKey(token.variants)}`)) continue;
		found.push(token.variants.concat(token.utility).join(":"));
	}
	return found;
}

const FILES = sourceFiles(SRC)
	.map((f) => ({ abs: f, rel: toPosix(relative(SRC, f)) }))
	.filter((f) => isThemed(f.rel));

/**
 * Per-line opt-out: write `dark-ok` in a comment on the line or just above it,
 * with the reason. For colours that are deliberately theme-invariant in ONE
 * place — a QR plate, a light mat under a user's transparent logo, a swatch that
 * must show the theme you are not in. File-level EXEMPT_FILES is the blunt
 * version; this is the one to reach for first, because the reason ends up next
 * to the code instead of in a list nobody opens.
 */
const OPT_OUT = /dark-ok/;
/** Backstop so a marker can never reach an unrelated block far below. */
const OPT_OUT_MAX_BLOCK = 14;

/**
 * Marks every line that is comment text — `//`, a `/* … *\/` block including its
 * middle and closing lines, and JSX's `{/* … *\/}`. Computed top-down because a
 * block comment can only be recognised by where it opened, which an
 * upward-walking scan cannot see.
 */
function commentMask(lines: string[]): boolean[] {
	const mask: boolean[] = [];
	let inBlock = false;
	for (const line of lines) {
		const t = line.trim();
		if (inBlock) {
			mask.push(true);
			if (t.includes("*/")) inBlock = false;
			continue;
		}
		const opens = t.startsWith("/*") || t.startsWith("{/*");
		mask.push(opens || t.startsWith("//") || t.startsWith("*"));
		if (opens && !t.includes("*/")) inBlock = true;
	}
	return mask;
}

/**
 * True when `dark-ok` appears on this line, or anywhere in the CONTIGUOUS
 * comment block directly above it. Scanning the block rather than a fixed
 * number of lines matters: the convention demands a REASON, and any reason
 * worth writing is long enough to push the marker out of a 2–3 line window —
 * the rule would otherwise fight itself.
 *
 * Note the marker attaches to the LINE carrying the colour, not to the element:
 * on a multi-line JSX tag, put it directly above the `className`. That keeps the
 * reason next to the thing it excuses.
 */
function optedOut(lines: string[], mask: boolean[], i: number): boolean {
	if (OPT_OUT.test(lines[i])) return true;
	for (
		let j = i - 1, seen = 0;
		j >= 0 && seen < OPT_OUT_MAX_BLOCK;
		j--, seen++
	) {
		if (!mask[j]) return false;
		if (OPT_OUT.test(lines[j])) return true;
	}
	return false;
}

function countFor(abs: string): string[] {
	const lines = readFileSync(abs, "utf8").split("\n");
	const mask = commentMask(lines);
	// Comment text is not a class list: a comment that NAMES the colour it
	// replaced (`was \`bg-white/70\``) must not count. Same rule as blackInkSites.
	return lines.flatMap((line, i) =>
		mask[i] || optedOut(lines, mask, i) ? [] : uncoveredOn(line),
	);
}

const ACTUAL = new Map<string, string[]>();
for (const file of FILES) {
	const hits = countFor(file.abs);
	if (hits.length > 0) ACTUAL.set(file.rel, hits);
}

/**
 * Regenerate the budget after fixing colours:
 *   KP_WRITE_DARK_BUDGET=1 pnpm vitest run src/lib/dark-mode-coverage.test.ts
 *
 * Deliberately driven by this same scan rather than a separate script: a
 * generator that can disagree with its checker is the bug this whole file is
 * about.
 */
if (process.env.KP_WRITE_DARK_BUDGET) {
	const rows = [...ACTUAL.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([rel, hits]) => `\t"${rel}": ${hits.length},`)
		.join("\n");
	writeFileSync(
		join(__dirname, "dark-mode-coverage-budget.ts"),
		`${BUDGET_HEADER}export const DARK_COVERAGE_BUDGET: Record<string, number> = {\n${rows}\n};\n`,
	);
}

function blackInkSites(abs: string): string[] {
	const lines = readFileSync(abs, "utf8").split("\n");
	const mask = commentMask(lines);
	const out: string[] = [];
	lines.forEach((line, i) => {
		if (mask[i]) return;
		const hits = [...line.matchAll(BLACK_INK_RE)].map((m) => m[0]);
		if (hits.length === 0 || optedOut(lines, mask, i)) return;
		out.push(`${i + 1}: ${[...new Set(hits)].join(" ")}`);
	});
	return out;
}

describe("dark-mode colour coverage", () => {
	test("no solid black surface — the dark ink is navy", () => {
		const found = FILES.flatMap((f) => {
			const sites = blackInkSites(f.abs);
			return sites.length ? [`${f.rel}: ${sites.join("; ")}`] : [];
		});
		expect(
			found.sort(),
			[
				"Black is not a Kedaipal colour. For a dark badge, chip, pill or band",
				"use `bg-segment text-segment-foreground` (navy a step lighter than",
				"--primary, in both themes); for a button use `bg-primary`.",
				"A translucent scrim (`bg-black/40`) is fine. If this really is a",
				"black object — a device bezel — mark the line `dark-ok` with the reason.",
			].join("\n"),
		).toEqual([]);
	});

	test("every component directory is classified: themed, unthemed or exempt", () => {
		const dirs = readdirSync(join(__dirname, "..", "components"), {
			withFileTypes: true,
		})
			.filter((e) => e.isDirectory())
			.map((e) => `components/${e.name}`);
		const known = new Set([
			...THEMED_COMPONENT_DIRS,
			...EXEMPT_DIRS,
			...Object.keys(UNTHEMED_COMPONENT_DIRS),
		]);
		expect(
			dirs.filter((d) => !known.has(d)).sort(),
			[
				"New component directories must be classified before they ship, or",
				"the dark-mode scan quietly stops covering them:",
				"  - renders under /app or a buyer route → THEMED_COMPONENT_DIRS",
				"  - marketing / pre-sign-in / an unthemed route → UNTHEMED_COMPONENT_DIRS, with the reason",
				"  - a print or export surface → EXEMPT_DIRS",
			].join("\n"),
		).toEqual([]);
	});

	test("the scan actually walked the themed source tree", () => {
		// A broken walk would make every assertion below vacuously pass, which is
		// worse than no test: it also stops anyone writing a real one.
		expect(FILES.length).toBeGreaterThan(60);
		expect(FILES.some((f) => f.rel === "routes/app.orders.index.tsx")).toBe(
			true,
		);
		expect(FILES.some((f) => f.rel.startsWith("components/storefront/"))).toBe(
			true,
		);
		expect(FILES.some((f) => f.rel.startsWith("components/poster/"))).toBe(
			false,
		);
	});

	test("the matcher recognises covered and uncovered colours", () => {
		// Guards the other direction — an over-eager or dead matcher.
		expect(uncoveredOn('className="bg-amber-50"')).toEqual(["bg-amber-50"]);
		expect(uncoveredOn('className="bg-amber-50 dark:bg-amber-950"')).toEqual(
			[],
		);
		expect(uncoveredOn('className="hover:bg-amber-50"')).toEqual([
			"hover:bg-amber-50",
		]);
		expect(
			uncoveredOn('className="hover:bg-amber-50 dark:hover:bg-amber-950"'),
		).toEqual([]);
		// A dark pair on a DIFFERENT property does not cover this one.
		expect(uncoveredOn('className="bg-amber-50 dark:text-amber-200"')).toEqual([
			"bg-amber-50",
		]);
		// Semantic tokens are never flagged.
		expect(
			uncoveredOn('className="bg-card text-foreground border-border"'),
		).toEqual([]);
		// Deliberate invariants.
		expect(uncoveredOn('className="bg-black/50"')).toEqual([]);
		expect(uncoveredOn('className="bg-emerald-600 text-white"')).toEqual([]);
		expect(uncoveredOn('className="bg-orange-500"')).toEqual([]);
		// A thin white sheen is a scrim; a dense one is a plate (z8r3fdwf9t).
		expect(uncoveredOn('className="bg-white/15"')).toEqual([]);
		expect(uncoveredOn('className="border-white/70"')).toEqual([]);
		expect(uncoveredOn('className="bg-white/70"')).toEqual(["bg-white/70"]);
		expect(uncoveredOn('className="bg-white/40"')).toEqual(["bg-white/40"]);
		expect(uncoveredOn('className="bg-white/70 dark:bg-current/15"')).toEqual(
			[],
		);
		expect(uncoveredOn('className="bg-black/70"')).toEqual([]);
		// …but a light PLATE is still caught, saturated sibling or not.
		expect(uncoveredOn('className="bg-amber-100 text-amber-800"')).toEqual([
			"bg-amber-100",
			"text-amber-800",
		]);
	});

	test("arbitrary values are out of scope, deliberately", () => {
		// `bg-[hsl(222_47%_6%)]` may be a considered theme-invariant swatch or a
		// mistake, and nothing here can tell the two apart. Flagging them all
		// would train people to reach for `dark-ok` to silence noise, which is
		// how a gate stops meaning anything.
		expect(uncoveredOn('className="bg-[hsl(222_47%_6%)]"')).toEqual([]);
	});

	test("the dark-ok marker suppresses a line, and only its own comment block", () => {
		const scan = (src: string) => {
			const lines = src.split("\n");
			const mask = commentMask(lines);
			return lines.flatMap((line, i) =>
				optedOut(lines, mask, i) ? [] : uncoveredOn(line),
			);
		};
		expect(scan('className="bg-white" // dark-ok: QR must scan')).toEqual([]);
		expect(scan('// dark-ok: QR must scan\nclassName="bg-white"')).toEqual([]);

		// A real multi-line reason still reaches the class — this is the case a
		// fixed 3-line lookbehind got wrong, silently suppressing nothing.
		expect(
			scan(
				[
					"// dark-ok. This mat stays white in both themes because sellers",
					"// routinely upload a logo that is dark ink on a transparent",
					"// background, and object-contain means the mat is visible behind",
					"// it — a dark mat swallows the mark entirely.",
					'className="bg-white"',
				].join("\n"),
			),
		).toEqual([]);

		// A JSX comment, including its closing line — the shape that silently
		// suppressed nothing when the scan only recognised OPENING comment lines.
		expect(
			scan(
				[
					"{/* dark-ok. The QR quiet zone must stay white in both themes,",
					"    or phone cameras stop reading it. */}",
					'<div className="bg-white">',
				].join("\n"),
			),
		).toEqual([]);

		// But a break in the comment block ends its reach.
		expect(scan('// dark-ok\n\nclassName="bg-white"')).toEqual(["bg-white"]);
		expect(scan('// dark-ok\nconst x = 1;\nclassName="bg-white"')).toEqual([
			"bg-white",
		]);
	});

	test("no themed file has an uncovered colour outside the budget", () => {
		const offenders: string[] = [];
		for (const [rel, hits] of ACTUAL) {
			const budget = DARK_COVERAGE_BUDGET[rel];
			if (budget === undefined) {
				offenders.push(
					`${rel}: ${hits.length} uncovered (${[...new Set(hits)].slice(0, 6).join(", ")})`,
				);
			}
		}
		expect(
			offenders.sort(),
			[
				"These files use raw Tailwind palette colours with no `dark:` counterpart,",
				"so they render as a light plate or dark-on-dark text in dark mode.",
				"",
				"Fix by either:",
				"  - using a semantic token (bg-card, text-foreground, border-border …), or",
				"  - adding the dark pair on the same element:",
				"      bg-amber-50 dark:bg-amber-950",
				"      text-amber-800 dark:text-amber-200",
				"  - for a status pill or notice card, use src/lib/tone.ts so the colours",
				"    cannot drift from the other places that show the same state.",
				"",
				"If the colour is deliberately theme-invariant (a QR plate, a brand logo,",
				"a print surface), add the file to EXEMPT_FILES above WITH THE REASON.",
			].join("\n"),
		).toEqual([]);
	});

	test("budgeted files match their recorded count exactly", () => {
		// Exact, not a ceiling: fixing a colour must fail this test until the
		// number comes down. That is the ratchet — without it the budget drifts
		// back up unnoticed.
		const wrong: string[] = [];
		for (const [rel, budget] of Object.entries(DARK_COVERAGE_BUDGET)) {
			const actual = ACTUAL.get(rel)?.length ?? 0;
			if (actual !== budget) {
				wrong.push(
					actual < budget
						? `${rel}: now ${actual}, budget says ${budget} — lower it to ${actual}.`
						: `${rel}: now ${actual}, budget allows ${budget} — you added ${actual - budget}.`,
				);
			}
		}
		expect(
			wrong.sort(),
			"src/lib/dark-mode-coverage-budget.ts is out of date. Numbers only ever go down.",
		).toEqual([]);
	});
});
