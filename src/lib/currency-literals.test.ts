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
 * Everything here prices KEDAIPAL'S OWN subscription, which really is billed
 * in MYR regardless of which country the seller's shop is in — the landing
 * page, the pricing table, the cost calculator, the billing tab and the admin
 * console (where an operator picks the currency explicitly). Confusing the two
 * is the actual hazard: "0% cut" is Kedaipal's subscription posture, never a
 * statement about the seller's own prices.
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
