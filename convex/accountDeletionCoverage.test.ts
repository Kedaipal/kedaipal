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
 * here, and enforces three rules:
 *
 *  1. a table whose fields look like a person's contact details must be
 *     VISITED by a phase — PDPA erasure has no "keep it" answer;
 *  2. every `retailerId`-keyed table must be visited OR classified as
 *     retained by decision, with a reason — otherwise its rows simply dangle
 *     after teardown, which is how `bookingBlocks` and `messageLogRollups`
 *     were found (both unvisited, and one of them wrongly so);
 *  3. a table retained by decision must carry NO person-identifying field.
 *     The code header asserts in prose that each retained table holds "no
 *     buyer PII" — rule 3 is what makes that claim checkable, so retention
 *     can never quietly become a way to keep a buyer's phone number.
 *
 * Sibling of `creditLockCoverage.test.ts` / `sellerLockCoverage.test.ts` — and
 * a list that claims a completeness it doesn't check is worse than no list,
 * because it stops the next person going to look.
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
	products: [
		"products",
		"productVariants",
		"productCategories",
		"promotionMembers",
	],
	// Members are swept before the promotions they point at (`z8r3fducfd`).
	promotions: ["promotions", "promotionMembers"],
};

/**
 * RETAINED BY DECISION — mirrors the block at the top of
 * `convex/lib/accountDeletion.ts`. A table here is deliberately NOT erased
 * with the tenant, and the reason has to say why keeping it is right. Their
 * `retailerId` refs dangle afterwards, which is expected for a retained record
 * of a deleted tenant. Rule 3 below proves none of them holds buyer PII.
 */
const RETAINED_BY_DECISION: Record<string, string> = {
	invoices:
		"financial record of what Kedaipal charged the seller — a business must be able to produce its own invoicing history after a customer leaves",
	creditLedger:
		"the financial record of what the seller bought and spent; purchased credits are deferred revenue until spent or expired",
	adminAuditLog:
		"an audit trail must outlive the tenant it audited — 'who at Kedaipal touched this store?' is unanswerable if the answer is deleted with the store",
	messageLogRollups:
		"the PERMANENT WhatsApp cost ledger: purgeExpiredOutboundLog folds every expiring outboundMessageLog row into it so aggregate cost accounting survives the 90-day purge, and Meta bills per send — a record of what Kedaipal was charged for this seller's traffic. The raw rows, which carry the buyer's number, ARE deleted",
};

/** `\tname: defineTable({` — every table is declared at one tab of indent. */
const TABLE_HEADER = /^\t(\w+): defineTable\(\{/gm;

/** Comments are prose, not columns — the schema says `waPhone` constantly. */
const stripComments = (text: string) =>
	text
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");

/** Every `name: v.…` in a block, nested objects included. */
const declaredFields = (block: string) =>
	[...stripComments(block).matchAll(/(\w+):\s*v\./g)].map((m) => m[1]);

/**
 * A table can declare fields through a SHARED validator rather than inline —
 * `permissions: memberPermissionsValidator`, or `frozenAnswerValidator` inside
 * `orderClaims.lines` — and a shared validator can itself SPREAD a field bag
 * (`buyerQuestionValidator` is `v.object({ id, ...questionFields })`). Both are
 * invisible to a scan that only matches `name: v.…`, so a future
 * `buyerContactValidator` carrying a `waPhone` would silently shrink rule 1's
 * coverage to nothing that mattered.
 *
 * So resolve both: every top-level `const <name> = v.…` or `const <name> = {…}`
 * in schema.ts and in each `./lib/*` module it imports from, with spreads
 * followed transitively. `resolvesSharedValidators` below fails if this ever
 * stops finding the ones we know about — a resolver that silently resolves
 * nothing is the same blind spot wearing a disguise.
 */
function validatorFields(): Map<string, string[]> {
	const blocks = new Map<string, { fields: string[]; spreads: string[] }>();

	const addFrom = (src: string) => {
		for (const def of src.matchAll(/^(?:export )?const (\w+) = (v\.|\{)/gm)) {
			// Walk balanced delimiters. Ending the block at "the next const"
			// instead looked fine and was badly wrong: the next top-level const
			// can be hundreds of lines away, so `orderStageEntry` swallowed most
			// of schema.ts and resolved to 868 "fields" — every table referencing
			// it would have inherited the whole schema's field names.
			const [open, close] = def[2] === "{" ? ["{", "}"] : ["(", ")"];
			const from = src.indexOf(open, (def.index ?? 0) + def[0].length - 1);
			if (from === -1) continue;
			let depth = 0;
			let i = from;
			for (; i < src.length; i++) {
				if (src[i] === open) depth++;
				else if (src[i] === close && --depth === 0) break;
			}
			const block = stripComments(src.slice(from, i));
			blocks.set(def[1], {
				fields: declaredFields(block),
				spreads: [...block.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]),
			});
		}
	};

	const schema = readFileSync(join(__dirname, "schema.ts"), "utf8");
	addFrom(schema);
	for (const m of schema.matchAll(/from "\.\/(lib\/\w+)"/g)) {
		try {
			addFrom(readFileSync(join(__dirname, `${m[1]}.ts`), "utf8"));
		} catch {
			// not a module we can read — nothing to resolve from it
		}
	}

	// Follow spreads, guarding against a cycle.
	const resolve = (name: string, seen: Set<string>): string[] => {
		const block = blocks.get(name);
		if (!block || seen.has(name)) return [];
		seen.add(name);
		return [
			...block.fields,
			...block.spreads.flatMap((s) => resolve(s, seen)),
		];
	};

	const out = new Map<string, string[]>();
	for (const name of blocks.keys()) {
		const fields = [...new Set(resolve(name, new Set()))];
		if (fields.length) out.set(name, fields);
	}
	return out;
}

const VALIDATORS = validatorFields();

/**
 * Table name → its declared field names, read from the schema source, with any
 * shared validator it references resolved into the list.
 */
function schemaTables(): Map<string, string[]> {
	const src = readFileSync(join(__dirname, "schema.ts"), "utf8");
	const heads = [...src.matchAll(TABLE_HEADER)];
	const out = new Map<string, string[]>();
	heads.forEach((head, i) => {
		const end = i + 1 < heads.length ? heads[i + 1].index : src.length;
		const body = stripComments(
			head.index === undefined ? "" : src.slice(head.index, end),
		);
		const fields = declaredFields(body);
		for (const [name, shared] of VALIDATORS) {
			if (new RegExp(`\\b${name}\\b`).test(body)) fields.push(...shared);
		}
		out.set(head[1], [...new Set(fields)]);
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

	test("resolvesSharedValidators — the scan sees through imports and spreads", () => {
		// Without this the resolver could quietly resolve nothing and every rule
		// below would narrow to inline fields again, passing all the while.
		expect(VALIDATORS.has("frozenAnswerValidator")).toBe(true);
		expect(VALIDATORS.has("memberPermissionsValidator")).toBe(true);

		// Imported validator: `answer` reaches orderClaims only through
		// frozenAnswerValidator, inside `lines[].answers[]`.
		const claims = TABLES.get("orderClaims") ?? [];
		expect(claims).toContain("answer");
		expect(claims).toContain("waPhone"); // …and the inline fields survive

		// Spread: buyerQuestionValidator is `v.object({ id, ...questionFields })`,
		// so `label` is two hops from any table that uses it.
		expect(VALIDATORS.get("buyerQuestionValidator")).toContain("label");

		// Blocks end at their own closing delimiter, not at the next `const`.
		// orderStageEntry once resolved to 868 fields — most of schema.ts.
		expect((VALIDATORS.get("orderStageEntry") ?? []).length).toBeLessThan(30);
	});

	test("every table with person-identifying fields is visited by a phase", () => {
		const unvisited = [...TABLES]
			.map(([table, fields]) => ({ table, pii: piiFields(fields) }))
			.filter(({ table, pii }) => pii.length > 0 && !VISITED.has(table))
			.map(({ table, pii }) => `${table} (${pii.join(", ")})`)
			.join(" · ");

		// A failure here is a PDPA gap, not a test to relax: add a phase to
		// DELETION_PHASES + runDeletionPhase, or — if another phase's cascade
		// already erases these rows — list the table under that phase in
		// PHASE_TABLES above and name the cascade that does it.
		expect(unvisited).toBe("");
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

	test("every retailerId-keyed table is visited or retained by decision", () => {
		// Rule 2. Not a PDPA rule — a completeness one: an unclassified
		// tenant-keyed table just leaves rows behind pointing at a retailer row
		// that no longer exists. Both tables this caught were real:
		// `bookingBlocks` wanted a phase, `messageLogRollups` wanted retaining.
		const unclassified = [...TABLES]
			.filter(([, fields]) => fields.includes("retailerId"))
			.map(([table]) => table)
			.filter(
				(table) => !VISITED.has(table) && !(table in RETAINED_BY_DECISION),
			)
			.join(" · ");

		// Add a phase, or add the table to RETAINED_BY_DECISION with the reason
		// keeping it is right — and mirror that reason in the header block of
		// convex/lib/accountDeletion.ts.
		expect(unclassified).toBe("");
	});

	test("nothing retained by decision holds person-identifying data", () => {
		// Rule 3 — the check behind the header's "no buyer PII" claim. Without
		// it, "retained by decision" is an unaudited hole in the erasure path.
		const leaks = Object.keys(RETAINED_BY_DECISION)
			.map((table) => ({ table, pii: piiFields(TABLES.get(table) ?? []) }))
			.filter(({ pii }) => pii.length > 0)
			.map(({ table, pii }) => `${table} (${pii.join(", ")})`)
			.join(" · ");

		expect(leaks).toBe("");
	});

	test("RETAINED_BY_DECISION names real tables, and none of them has a phase", () => {
		for (const table of Object.keys(RETAINED_BY_DECISION)) {
			expect([...TABLES.keys()]).toContain(table);
			// A table can't be both erased and retained. `creditPurchases` is the
			// near-miss: it IS retained, but its phase exists to expire pending
			// checkouts rather than to delete rows — so it is deliberately not
			// listed here, and `retailers.test.ts` pins that behaviour.
			expect(VISITED.has(table)).toBe(false);
		}
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
		).join(" · ");
		expect(unknown).toBe("");
	});
});
