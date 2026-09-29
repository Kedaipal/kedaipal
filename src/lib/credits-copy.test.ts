// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Credits are always ORDERS (Credits T3, ClickUp z8r3fdf8hy, register item 7):
 * "42 orders left", "15 orders owed" — never money. So no credit copy anywhere
 * — dashboard, emails, lock refusals, the message catalogs — may call them a
 * wallet, a fee, a commission, a percentage, pay-as-you-go, or put an RM
 * figure on a balance. A single slip makes credits read as a charge on every
 * order, which is the exact framing the pricing was built to avoid.
 *
 * Code comments are stripped first: the files that keep this rule also state
 * it, and the rule is about what a seller reads.
 */

const ROOT = join(__dirname, "..", "..");

/** Every file that authors seller-facing credit copy. */
const CREDIT_SOURCES = [
	"src/lib/credits-ui.ts",
	"src/components/app/subscription-banner.tsx",
	"convex/lib/credits.ts",
	"convex/lib/creditEmailCopy.ts",
	"convex/creditNotices.ts",
	...readdirSync(join(ROOT, "src/components/credits"))
		.filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
		.map((f) => `src/components/credits/${f}`),
];

const BANNED: { name: string; re: RegExp }[] = [
	{ name: "wallet", re: /\bwallets?\b|\bdompet\b|钱包/i },
	{ name: "fee", re: /\bfees?\b|\byuran\b|费用|手续费/i },
	{ name: "commission", re: /\bcommissions?\b|\bkomisen\b|佣金/i },
	{ name: "pay as you go", re: /pay[\s-]+as[\s-]+you[\s-]+go|\bpayg\b/i },
	{ name: "a percentage", re: /\d\s*%|\bpercent|\bperatus\b|百分/i },
	{ name: "an RM balance", re: /\bRM\s?\d|S\$\s?\d/ },
];

function stripComments(src: string): string {
	return (
		src
			// Block comments (JSDoc included) and JSX comments.
			.replace(/\/\*[\s\S]*?\*\//g, "")
			// Line comments — but not the `//` inside "https://".
			.replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
	);
}

function offences(text: string): string[] {
	return BANNED.filter((b) => b.re.test(text)).map((b) => b.name);
}

describe("credit copy never speaks money", () => {
	test("the scanned files exist (a rename must move the guard with it)", () => {
		for (const rel of CREDIT_SOURCES)
			expect(() => readFileSync(join(ROOT, rel), "utf8"), rel).not.toThrow();
		// The credits components folder is scanned whole — it must not be empty.
		expect(
			CREDIT_SOURCES.some((f) => f.startsWith("src/components/credits/")),
		).toBe(true);
	});

	test.each(CREDIT_SOURCES)("%s", (rel) => {
		const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
		const found = code
			.split("\n")
			.map((line, i) => ({ line: i + 1, hits: offences(line), text: line }))
			.filter((l) => l.hits.length > 0)
			.map((l) => `${rel}:${l.line} [${l.hits.join(", ")}] ${l.text.trim()}`);
		expect(found).toEqual([]);
	});

	test("message catalogs: any line about credits stays in orders", () => {
		// "Credit card" and a courier's own prepaid credit (Delyva) aren't ours.
		const aboutCredits =
			/\bcredits?\b(?!\s+card)|\bkredit\b(?<!kad kredit)|额度/i;
		const notOurs =
			/credit card|kad kredit|信用卡|Delyva credit|kredit Delyva/i;
		const found: string[] = [];
		for (const locale of readdirSync(join(ROOT, "messages")).filter((f) =>
			f.endsWith(".json"),
		)) {
			const catalog = JSON.parse(
				readFileSync(join(ROOT, "messages", locale), "utf8"),
			) as Record<string, unknown>;
			for (const [key, value] of Object.entries(catalog)) {
				if (typeof value !== "string") continue;
				const scrubbed = value.replace(notOurs, "");
				if (!aboutCredits.test(scrubbed)) continue;
				const hits = offences(scrubbed);
				if (hits.length > 0)
					found.push(`${locale} ${key} [${hits.join(", ")}] ${value}`);
			}
		}
		expect(found).toEqual([]);
	});

	test("the guard itself bites (so a green run means something)", () => {
		expect(offences("Top up your wallet")).toEqual(["wallet"]);
		expect(offences("A small fee per order")).toEqual(["fee"]);
		expect(offences("Save 20% on packs")).toEqual(["a percentage"]);
		expect(offences("You have RM 12.50 left")).toEqual(["an RM balance"]);
		expect(offences("Tiada yuran tersembunyi")).toEqual(["fee"]);
		expect(offences("42 orders left")).toEqual([]);
		expect(stripComments('const u = "https://x.y"; // wallet')).toBe(
			'const u = "https://x.y"; ',
		);
	});
});
