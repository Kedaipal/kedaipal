// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DELETION_PHASES } from "./lib/accountDeletion";

/**
 * Machine enforcement for the PDPA erasure cascade (86eyetzbk —
 * convex/lib/accountDeletion.ts, docs/account-deletion.md).
 *
 * Deleting a seller's account must take every person-identifying row with it.
 * Which tables those are is not a property of the cascade, it is a property of
 * the SCHEMA — a new table with a `waPhone` on it is a new PDPA obligation,
 * and the cascade is a hand-maintained list in another file that nothing
 * forced anyone to update. That is exactly how `orderClaims` was missed: it
 * shipped with a required buyer phone and an optional buyer name, its own
 * purge cron deliberately exempted `completed` rows as "the PDPA pack's job",
 * and the PDPA pack had no phase for it — so after a store was erased its
 * buyers' numbers stayed.
 *
 * So this reads the tables out of `schema.ts` rather than trusting a list
 * here: a table whose fields look like a person's contact details must be
 * VISITED by the cascade, or the author has to classify it below and say what
 * erases it instead. Sibling of `creditLockCoverage.test.ts` /
 * `sellerLockCoverage.test.ts` — and a list that claims a completeness it
 * doesn't check is worse than no list, because it stops the next person going
 * to look.
 *
 * Scope note: membership proves the cascade VISITS a table. What it does there
 * is the phase's own call — `optOuts` is visited to clear an attribution ref
 * and keep the row on purpose — and `retailers.test.ts` is what asserts the
 * actual row-level outcome of every phase.
 */

/**
 * Field names that mean a row can identify a PERSON: the buyer, a buyer's
 * contact, or one of the seller's own people-records. Deliberately narrow —
 * `name` alone is a product or a store far more often than a human, so only
 * the qualified forms count.
 */
const PII_FIELD = [
	/phone/i,
	/email/i,
	/address/i,
	/(buyer|customer|manager|guest|contact|recipient|profile)name/i,
];

/**
 * Which tables each phase actually erases, for the phases whose name is not
 * simply the table's. Three real cases today, and this is the one extension
 * point: a new PII-bearing table either gets its own phase, or gets listed
 * under the phase whose cascade already takes it — with the cascade named, so
 * the claim can be checked.
 */
const PHASE_TABLES: Record<string, readonly string[]> = {
	// The tenant anchor: one row, deleted last so continuations can re-resolve
	// it by userId. Singular phase name, plural table.
	retailer: ["retailers"],
	// The order phase deletes each order's event timeline inline and calls
	// `deleteOrderOwnedBlobs` (lib/orderBlobs.ts), which frees every
	// payment-claim row along with its proof screenshot.
	orders: ["orders", "orderEvents", "paymentClaims"],
	// `deleteProductCascade` (lib/productDelete.ts) takes each product's
	// variants and category junctions with it. (`productCategories` also has
	// its own leftovers-sweep phase.)
	products: ["products", "productVariants", "productCategories"],
};

/** `\tname: defineTable({` — every table is declared at one tab of indent. */
const TABLE_HEADER = /^\t(\w+): defineTable\(\{/gm;

/**
 * Table name → its declared field names, read from the schema source. Comment
 * lines are stripped first: the schema's prose mentions `waPhone` constantly,
 * and a comment is not a column.
 */
function schemaTables(): Map<string, string[]> {
	const src = readFileSync(join(__dirname, "schema.ts"), "utf8");
	const heads = [...src.matchAll(TABLE_HEADER)];
	const out = new Map<string, string[]>();
	heads.forEach((head, i) => {
		const end = i + 1 < heads.length ? heads[i + 1].index : src.length;
		const body = (head.index === undefined ? "" : src.slice(head.index, end))
			.split("\n")
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n");
		// Field declarations, nested ones inside v.object() included.
		out.set(
			head[1],
			[...body.matchAll(/(\w+):\s*v\./g)].map((m) => m[1]),
		);
	});
	return out;
}

const TABLES = schemaTables();

/** Every table the cascade visits, phase aliases resolved. */
const VISITED = new Set(
	DELETION_PHASES.flatMap((phase) => PHASE_TABLES[phase] ?? [phase]),
);

const piiFields = (fields: readonly string[]) => [
	...new Set(fields.filter((f) => PII_FIELD.some((p) => p.test(f)))),
];

describe("the account-deletion cascade covers every table holding PII", () => {
	test("the schema scan actually found the tables (guards the regex)", () => {
		// If `defineTable` is ever written differently the scan would silently
		// find nothing and every assertion below would vacuously pass.
		expect(TABLES.size).toBeGreaterThan(25);
		expect(TABLES.get("orderClaims")).toContain("waPhone");
		expect(TABLES.get("products")).toContain("price");
	});

	test("every table with person-identifying fields is visited by a phase", () => {
		const unvisited = [...TABLES]
			.map(([table, fields]) => ({ table, pii: piiFields(fields) }))
			.filter(({ table, pii }) => pii.length > 0 && !VISITED.has(table))
			.map(({ table, pii }) => `${table} (${pii.join(", ")})`);

		// A failure here is a PDPA gap, not a test to relax: add a phase to
		// DELETION_PHASES + runDeletionPhase, or — if another phase's cascade
		// already erases these rows — list the table under that phase in
		// PHASE_TABLES above and name the cascade that does it.
		expect(unvisited).toEqual([]);
	});

	test("the cascade visits orderClaims — the gap this test was written for", () => {
		// Pinned by name as well as by sweep: the sweep is only as good as
		// PII_FIELD, and a claim's buyer phone is the thing that went missing.
		expect(piiFields(TABLES.get("orderClaims") ?? [])).toEqual([
			"waPhone",
			"buyerName",
		]);
		expect(DELETION_PHASES).toContain("orderClaims");
	});

	test("PHASE_TABLES names real phases and real tables", () => {
		// Stale keys are how an exemption outlives the thing it excused.
		for (const [phase, tables] of Object.entries(PHASE_TABLES)) {
			expect(DELETION_PHASES).toContain(phase);
			for (const table of tables) expect([...TABLES.keys()]).toContain(table);
		}
	});

	test("every phase names a real table", () => {
		// Catches a typo'd or renamed phase, which would otherwise look like
		// coverage while sweeping nothing.
		const unknown = DELETION_PHASES.filter(
			(phase) => !(PHASE_TABLES[phase] ?? [phase]).some((t) => TABLES.has(t)),
		);
		expect(unknown).toEqual([]);
	});
});
