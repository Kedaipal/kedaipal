// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for "a store's money is rendered in the store's
 * currency" (ClickUp 86eyqgujv).
 *
 * Kedaipal sells in two countries now. A Singapore store's dashboard was
 * quoting Malaysian ringgit on its delivery fee, pickup fee, minimum-order and
 * counter-checkout price fields, because `CURRENCY_SYMBOL_OVERRIDE` was
 * module-private in `format.ts` and eleven call sites each hardcoded their own
 * "RM" prefix. Zaki hit it on a live SG store: "dont want any loose ends text
 * or whatever to still show RM or anything related to MY when they're on SG
 * store, except the currency that they selected."
 *
 * A one-time sweep does not hold — the next money input someone adds will copy
 * the nearest existing one. So the rule is a test: outside the allowlist
 * below, a seller- or buyer-facing surface may not name a currency at all. It
 * reads one from data (`retailer.currency`, `order.currency`, a `currency`
 * prop) and renders it via `formatPrice` / `currencySymbol`.
 *
 * The scan caught two sites beyond the ones the ticket listed
 * (`app.checkout.tsx`, the counter price inputs), which is the point.
 *
 * House precedent for a scan-the-source gate test: `convex-read-pattern.test.ts`
 * (adapter reads), `dependency-pins.test.ts` (package.json specs) and
 * `landing-funnel.test.ts` (forbidden copy strings).
 */

const SRC = join(__dirname, "..");

/**
 * Surfaces that legitimately name a currency.
 *
 * Everything here prices KEDAIPAL'S OWN subscription — the landing page, the
 * pricing table, the cost calculator, the billing tab and the admin console
 * (where an operator picks the currency explicitly). Confusing the two is the
 * actual hazard: "0% cut" is Kedaipal's subscription posture, never a statement
 * about the seller's own prices.
 *
 * Note this is NOT "always MYR" any more, whatever this comment used to say:
 * Kedaipal invoices Singaporean sellers in SGD, the billing tab renders those
 * invoices, and the annual card quotes SGD yearly totals. These surfaces name a
 * currency because they name KEDAIPAL'S, resolved from `BillingCurrency`.
 *
 * Prefer NOT extending this list. `src/lib/annual-billing.ts` needed a default
 * currency and took `DEFAULT_BILLING_CURRENCY` from `convex/lib/plans.ts`
 * instead of an entry here — an allowlist entry licenses every future literal
 * in that file, not just the one you were thinking of.
 *
 * `format.ts` and the `convex/lib` currency/country tables are the definitions
 * themselves — they are where the strings are allowed to live.
 */
const ALLOWED = [
	"components/landing/",
	"components/cost/",
	"components/settings/billing-tab.tsx",
	"routes/pricing.tsx",
	"routes/index.tsx",
	"routes/cost.tsx",
	"routes/app.admin.billing.tsx",
	"lib/format.ts",
];

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
		if (entry.name.includes(".test.")) continue;
		if (!/\.tsx?$/.test(entry.name)) continue;
		acc.push(join(dir, entry.name));
	}
	return acc;
}

function scannedFiles(): string[] {
	return sourceFiles(SRC).filter((abs) => {
		const rel = relative(SRC, abs).replaceAll("\\", "/");
		return !ALLOWED.some((a) => rel === a || rel.startsWith(a));
	});
}

/**
 * A line the copy tests below may not flag, even outside the allowlist: it
 * carries — or sits directly under — a `currency-literal-ok: <why>` comment.
 * For the few lines that NAME a currency on purpose (the Currency card's
 * "yours is set to SGD", a note quoting Kedaipal's own plan price) without
 * licensing a whole file the way an allowlist entry would. Always say why.
 */
const OK_MARKER = "currency-literal-ok";

/**
 * Code with comments removed, line by line — prose in a comment ("the
 * buyer sees it as From RM 40") describes money, it doesn't render any.
 * Handles `//` and multi-line block comments, JSX `{/* … *\/}` included.
 */
function codeLines(src: string): string[] {
	let inBlock = false;
	return src.split("\n").map((line) => {
		let out = "";
		let j = 0;
		while (j < line.length) {
			if (inBlock) {
				const end = line.indexOf("*/", j);
				if (end < 0) break;
				inBlock = false;
				j = end + 2;
				continue;
			}
			const start = line.indexOf("/*", j);
			if (start < 0) {
				out += line.slice(j);
				break;
			}
			out += line.slice(j, start);
			inBlock = true;
			j = start + 2;
		}
		// A `//` comment — but not the `//` inside "https://".
		return out.replace(/(^|[^:])\/\/.*$/, "$1");
	});
}

/** Every scanned `file:line — code` matching `pattern` outside comments,
 * minus lines excused by the `currency-literal-ok` marker. */
function offendingLines(pattern: RegExp): string[] {
	const offenders: string[] = [];
	for (const abs of scannedFiles()) {
		const raw = readFileSync(abs, "utf8").split("\n");
		codeLines(raw.join("\n")).forEach((code, i) => {
			if (!pattern.test(code)) return;
			if (raw[i].includes(OK_MARKER) || raw[i - 1]?.includes(OK_MARKER)) {
				return;
			}
			offenders.push(`${relative(SRC, abs)}:${i + 1} — ${code.trim()}`);
		});
	}
	return offenders;
}

describe("store money never names a currency in source", () => {
	/**
	 * An ISO code passed to `formatPrice` / stored as a default. The store's
	 * currency comes from the retailer or the order — an order in particular
	 * keeps the currency it was PLACED in, which a literal cannot follow.
	 * `DEFAULT_CURRENCY` (convex/lib/currency.ts) is the named stand-in for
	 * "we don't know yet because the retailer is still loading".
	 */
	test("no hardcoded MYR / SGD ISO codes", () => {
		const offenders: string[] = [];
		for (const abs of scannedFiles()) {
			const src = readFileSync(abs, "utf8");
			src.split("\n").forEach((line, i) => {
				if (/"(MYR|SGD)"|'(MYR|SGD)'/.test(line)) {
					offenders.push(`${relative(SRC, abs)}:${i + 1} — ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * The money-input prefix. Matched as a JSX text node standing alone on its
	 * line — the shape every one of these took — so prose in a comment
	 * ("RM display strings; sen on the wire") is untouched.
	 */
	test("no hardcoded RM / S$ symbol in a money field prefix", () => {
		const offenders: string[] = [];
		for (const abs of scannedFiles()) {
			const src = readFileSync(abs, "utf8");
			src.split("\n").forEach((line, i) => {
				if (/^\s*(RM|S\$)\s*$/.test(line)) {
					offenders.push(`${relative(SRC, abs)}:${i + 1} — ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * Money written INTO a sentence — "A band fee of RM0 means free", "Enter
	 * an amount between RM 0 and RM 10,000". The prefix test above only sees
	 * a symbol standing alone on its line, so both product forms, the delivery
	 * bands and the counter's price check all quoted ringgit to SG stores
	 * through it. Spell the amount with `formatDraftPrice` / `formatPrice`.
	 */
	test("no hardcoded RM / S$ amount in copy", () => {
		expect(offendingLines(/\b(RM|S\$)\s?\d/)).toEqual([]);
	});

	/**
	 * The ISO code RENDERED as if it were a symbol — `{currency}` as a JSX
	 * child, or `${currency} 12` in a string. Every product form did this
	 * ("Price (MYR)", "MYR 12"): the code is data, the seller reads the
	 * symbol. Wrap it in `currencySymbol(...)` or format the amount. A prop
	 * pass-through (`currency={currency}`) and a call argument never match.
	 */
	test("never renders a raw currency code where a symbol belongs", () => {
		expect(
			offendingLines(
				/(?<![=\w])\{[\w.?]*[cC]urrency\}|\$\{[\w.?]*[cC]urrency\}\s/,
			),
		).toEqual([]);
	});

	/** The allowlist is a claim about which files exist — keep it honest. */
	test("every allowlisted path still exists", () => {
		const all = sourceFiles(SRC).map((abs) =>
			relative(SRC, abs).replaceAll("\\", "/"),
		);
		for (const a of ALLOWED) {
			expect(
				all.some((rel) => rel === a || rel.startsWith(a)),
				`allowlisted path no longer matches anything: ${a}`,
			).toBe(true);
		}
	});
});
