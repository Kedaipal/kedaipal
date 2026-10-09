// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the PER-ORDER credit gate (Credits T3.1, ClickUp
 * z8r3fdmg4h — convex/creditLock.ts).
 *
 * An order is workable once its own credit is paid for. Only orders that
 * arrived while the balance was at or below zero wait, and while they wait
 * they are INVISIBLE to the seller, not merely un-actionable. So there are two
 * halves to cover, and a new function can forget either:
 *
 *  1. the WRITES — every public write in an order-handling module is
 *     classified gated or open, with a reason for every open one;
 *  2. the READS — every public query that hands a seller order or customer
 *     data either runs it through the redaction or is excused with a reason.
 *
 * Plus the decision that makes this version different from the store-wide lock
 * it replaced: the CATALOGUE is never gated (Zaki, 6 Oct 2026). Products and
 * categories are paid for by the subscription, not by credits, so no public
 * write in those modules may carry the guard at all — the previous release
 * shipped the store-wide version, and nothing but a test stops it coming back.
 *
 * Sibling of `sellerLockCoverage.test.ts` (the past-due view-only lock).
 */

const CREDIT_GUARDS = [
	"assertOrderCreditAvailable(",
	"internal.creditLock.assertCreditsForOrder",
	"isOrderGated(",
];

/** The REDACTION seam: the ways a read ANSWERS the gate — hand back a
 * stripped row, hand back nothing, or drop the row from the result. Filtering
 * counts: `customers.search` drops gated buyers rather than redacting them,
 * because the search index reads the stored `searchText` and a redacted hit
 * would still be a hit (an oracle). */
const REDACTION_CALLS = [
	"forSeller(",
	"customerForSeller(",
	"orderGatedForSeller(",
	"isCustomerGated(",
	// The BOOKING surfaces read whole order rows straight off
	// `bookingsOverlapping` rather than through the allowlist, so they redact
	// the one field that identifies the guest instead of the whole row — see
	// `guestNameForSeller`.
	"guestNameForSeller(",
	// The explicit per-row test, for a surface that blanks one field of its
	// own shape (`awb.readyToShipQueue`).
	"isOrderGated(",
];

/**
 * The catalogue. Paid for by the subscription, NEVER by credits — so no public
 * write here may carry the gate. This list is the inverse of what it was
 * before T3.1, which is the whole point of having it.
 */
const NEVER_GATED_MODULES = ["products", "categories"];

/** Order-handling modules: every public write is classified below. */
const MIXED_MODULES = ["orders", "bookings", "lalamove", "delyva", "awb"];

const GATED_FUNCTIONS = [
	// Accepting and moving an order forward (cancel excepted inside).
	"orders.updateStatus",
	"orders.advanceToStage",
	"bookings.approveBookingRequest",
	// Taking payment by hand.
	"orders.markPaymentReceived",
	// Fulfilment work.
	"orders.setShipmentTracking",
	"orders.setDeliveryFee",
	"orders.rescheduleFulfilment",
	"orders.submitMockup",
	"orders.updateMockupQuote",
	"orders.waiveMockup",
	"lalamove.prepareBooking",
	"lalamove.confirmBooking",
	"delyva.prepareBooking",
	"delyva.confirmBooking",
	// Chasing and documents.
	"orders.sendPaymentReminder",
	"orders.generateReceiptPdf",
	// Despatch labels — order-scoped since T3.1, NOT store-wide: a single label
	// IS one order. (The batch is the selection case, classified below.)
	"awb.generateAwbPdf",
];

/**
 * The BATCH shape. With the gate per order a selection is routinely mixed, so
 * these two can't refuse — they do what they can and NAME what they skipped,
 * which is the inbox's existing bulk-skip rule. Refusing the whole batch
 * because one order of forty is waiting would be the store-wide lock all over
 * again, which is exactly the defect T3.1 exists to remove.
 *
 * Each must carry a named skip counter, asserted below — a batch that silently
 * dropped the gated rows would be worse than one that refused.
 */
const SKIPS_GATED_FUNCTIONS: Record<string, string> = {
	"orders.bulkUpdateStatus": "skippedCreditGated",
	"awb.generateAwbBatchPdf": "credit_gated",
};

const OPEN_FUNCTIONS: Record<string, string> = {
	// The buyer's side — buyers never feel a seller's balance.
	"orders.create": "buyer: order intake never stops, it uses a credit instead",
	"orders.updateBuyerPhone": "buyer: repairs their own number",
	"orders.updateDeliveryAddress": "buyer: edits their own address",
	"orders.updatePickupLocation": "buyer: changes where they collect",
	"orders.claimPayment": "buyer: 'I've paid'",
	"orders.generateOrderProofUploadUrl": "buyer: uploads payment proof",
	"orders.generateCustomImageUploadUrl": "buyer: uploads a reference image",
	"orders.approveMockup": "buyer: approves a mockup",
	"orders.requestMockupChanges": "buyer: asks for a change",
	"orders.declineMockupItem":
		"buyer: backs out — and the credit comes back",
	"bookings.requestBooking": "buyer: booking intake never stops",
	"lalamove.quoteForCheckout": "buyer: priced at checkout",
	// Releasing a buyer — must stay open, or a gated seller is stuck holding a
	// paid order they can neither see nor hand back. This is the mitigation the
	// whole invisibility rule rests on.
	"bookings.declineBookingRequest":
		"reject = cancel: always open (and the credit comes back for a request never accepted)",
	"bookings.settleSecurityDeposit":
		"returning or keeping a deposit is refund handling — always open",
	"orders.clearGatewayPaymentIssue":
		"closes out a refund the seller made in HitPay — refunds are always open",
	"lalamove.cancelBooking": "cancelling a rider releases the order",
	"delyva.cancelBooking": "cancelling a courier releases the order",
	// Housekeeping and reads.
	"orders.markSeen": "involuntary: fires on a page view",
	"orders.setPinned": "organising the inbox — no fulfilment, no cost",
	"orders.exportOrders":
		"read-only: their own data, and every gated row is redacted inside exportPage / exportByIds",
	"orders.generateMockupUploadUrl":
		"mints an upload URL only — the mockup is attached by submitMockup, which is gated",
	"orders.discardMockupUploads":
		"cleans up abandoned uploads — never trap a cleanup",
	"orders.deleteOrder": "Kedaipal admin only",
	"orders.bulkDeleteOrders": "Kedaipal admin only",
	// Settings are always open.
	"delyva.connect": "settings: connecting a courier account",
	"delyva.resubscribeWebhooks": "settings: re-registers the courier webhooks",
	"delyva.refreshEnvironment": "settings: re-reads the courier account's mode",
	"delyva.disconnect": "settings: removing a courier account is never trapped",
	"delyva.updateSettings": "settings: courier defaults and preferences",
};

/**
 * Every public QUERY that can hand a seller order or customer data. Each one
 * either calls the redaction seam, or is listed below with the reason it
 * doesn't need to. A new seller read that does neither fails this test, and
 * its author has to decide — which is the only thing that keeps "a gated order
 * is invisible" true as the app grows.
 *
 * `orderGate.test.ts` then proves the ones that DO redact actually hide every
 * buyer field, by sentinel sweep. This test proves none got forgotten.
 */
// Every module with a public seller read that can return ORDER data.
//
// This list was `["orders", "customers"]` and the PR's own description called
// the read sweep machine enforcement — while four queries in `bookingBlocks`
// and `closedDates` returned gated guests' names in full, because the sweep
// never looked at those files. A list that states a completeness it doesn't
// check is worse than no list: it stops the next person going to look.
//
// A booking REQUEST debits its credit at request time and `holdsCapacity`
// keeps it on the calendar, so a request that lands at or below zero is born
// gated and shows up on the grid, the day sheet and both impact lists. The
// `.ics` feed already skipped gated bookings; these are its in-app mirror.
const READ_MODULES = [
	"orders",
	"customers",
	"bookingBlocks",
	"closedDates",
	"awb",
];

const OPEN_READS: Record<string, string> = {
	"orders.countActionable":
		"counts only, no order data — and a waiting order SHOULD be counted: the nav badge is what sends the seller to look, where the row says what it is waiting for",
	"orders.getPaymentMethods":
		"buyer door only (token), and it returns the STORE's payment rails, never order data",
	"customers.count": "a single number — the dashboard stat tile",
	"bookingBlocks.hasBookingListings":
		"a boolean — does this store sell bookings at all; reads products, never an order",
};

const CONVEX = __dirname;
const DEF =
	/export const (\w+)\s*=\s*(mutation|action|query|internalMutation|internalQuery|internalAction)\(/g;

/** Public definitions of one module, with the source text of each body. */
function publicDefs(mod: string, kinds: readonly string[]): Map<string, string> {
	const src = readFileSync(join(CONVEX, `${mod}.ts`), "utf8");
	const defs = [...src.matchAll(DEF)];
	const out = new Map<string, string>();
	defs.forEach((m, i) => {
		if (!kinds.includes(m[2])) return;
		const end = i + 1 < defs.length ? defs[i + 1].index : src.length;
		out.set(`${mod}.${m[1]}`, src.slice(m.index, end));
	});
	return out;
}

const publicWrites = (mod: string) => publicDefs(mod, ["mutation", "action"]);
const publicReads = (mod: string) => publicDefs(mod, ["query"]);

/** Seller-keyed order INTAKE — "order intake never stops" (the counter, claim
 * links): none of their public writes may carry the credit guard. */
const INTAKE_MODULES = ["counterCheckout", "orderClaims"];

/** The WAYS BACK — topping up (T2), paying or changing a plan, resuming a
 * hold, settings and the team: a gated store must always be able to reach
 * every one of them, or the gate becomes a trap. None may carry the guard. */
const WAY_BACK_MODULES = [
	"creditPurchases",
	"invoices",
	"subscriptionPayments",
	"subscriptions",
	"billing",
	"retailers",
	"team",
];

const guarded = (body: string) => CREDIT_GUARDS.some((g) => body.includes(g));

/** A batch whose per-order skip is decided in an internal helper rather than
 * in the public body — `awb.generateAwbBatchPdf` defers to `batchPageByIds`,
 * which is the only place holding both the order and the gate. */
function readsCounterElsewhere(mod: string, counter: string): boolean {
	return readFileSync(join(CONVEX, `${mod}.ts`), "utf8").includes(counter);
}
const redacts = (body: string) => REDACTION_CALLS.some((g) => body.includes(g));

describe("the per-order credit gate covers every write it should", () => {
	test("the module lists point at real files", () => {
		const files = new Set(
			readdirSync(CONVEX)
				.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
				.map((f) => basename(f, ".ts")),
		);
		for (const mod of [
			...NEVER_GATED_MODULES,
			...MIXED_MODULES,
			...READ_MODULES,
			...INTAKE_MODULES,
			...WAY_BACK_MODULES,
		])
			expect(files.has(mod)).toBe(true);
	});

	test("the CATALOGUE is never gated — no product or category write carries it", () => {
		// The T3.1 decision, machine-enforced (Zaki, 6 Oct 2026): we don't lock
		// features that the subscription pays for. Only the orders a seller
		// hasn't paid the credit for are held. The store-wide version of this
		// lock put the guard on all 17 of these writes; re-adding one here
		// fails, rather than quietly shipping a frozen catalogue again.
		const offenders: string[] = [];
		for (const mod of NEVER_GATED_MODULES)
			for (const [name, body] of publicWrites(mod))
				if (guarded(body)) offenders.push(name);
		expect(offenders).toEqual([]);
		// Proof the scan reaches the writes it is meant to be watching.
		expect(publicWrites("products").has("products.create")).toBe(true);
		expect(publicWrites("categories").has("categories.create")).toBe(true);
	});

	test("every public write in an order-handling module is classified", () => {
		const unclassified: string[] = [];
		for (const mod of MIXED_MODULES) {
			for (const name of publicWrites(mod).keys()) {
				if (
					!GATED_FUNCTIONS.includes(name) &&
					!(name in SKIPS_GATED_FUNCTIONS) &&
					!(name in OPEN_FUNCTIONS)
				)
					unclassified.push(name);
			}
		}
		expect(unclassified).toEqual([]);
	});

	test("gated functions carry the guard; open ones don't", () => {
		const all = new Map<string, string>();
		for (const mod of MIXED_MODULES)
			for (const [k, body] of publicWrites(mod)) all.set(k, body);
		const missing = GATED_FUNCTIONS.filter((n) => {
			const body = all.get(n);
			return body === undefined || !guarded(body);
		});
		const overLocked = Object.keys(OPEN_FUNCTIONS).filter((n) => {
			const body = all.get(n);
			return body !== undefined && guarded(body);
		});
		expect(missing).toEqual([]);
		expect(overLocked).toEqual([]);
	});

	test("no stale names, and every open function says why", () => {
		const all = new Set<string>();
		for (const mod of [...MIXED_MODULES, ...NEVER_GATED_MODULES])
			for (const k of publicWrites(mod).keys()) all.add(k);
		const stale = [
			...Object.keys(OPEN_FUNCTIONS),
			...Object.keys(SKIPS_GATED_FUNCTIONS),
			...GATED_FUNCTIONS,
		].filter((n) => !all.has(n));
		expect(stale).toEqual([]);
		for (const reason of Object.values(OPEN_FUNCTIONS))
			expect(reason.length).toBeGreaterThan(10);
	});

	test("cancelling through the status mutations is never gated", () => {
		// A gated seller can't SEE the order, so cancel is the only way they can
		// release the buyer waiting on it. Trapping that would make the gate
		// something a seller has to escape rather than pay to clear.
		for (const name of ["orders.updateStatus", "orders.bulkUpdateStatus"]) {
			const body = publicWrites("orders").get(name) ?? "";
			const at = body.search(/assertOrderCreditAvailable\(|isOrderGated\(/);
			expect(at, name).toBeGreaterThan(-1);
			// The guard sits behind the cancel test, on the same statement.
			const before = body.slice(Math.max(0, at - 120), at);
			expect(before, name).toContain('status !== "cancelled"');
		}
	});

	test("a batch SKIPS what it can't do, names the skip, and never refuses", () => {
		for (const [name, counter] of Object.entries(SKIPS_GATED_FUNCTIONS)) {
			const mod = name.split(".")[0];
			const body = publicWrites(mod).get(name) ?? "";
			expect(body, name).not.toBe("");
			// The skip is COUNTED under a name the toast can read out. A silent
			// drop is the house's no-silent-skip rule broken.
			expect(body.includes(counter) || readsCounterElsewhere(mod, counter), name).toBe(
				true,
			);
			// …and it never throws the gate refusal at the whole batch.
			expect(body, name).not.toContain("assertOrderCreditAvailable(");
		}
	});

	test("no guard dangles under an unbraced `if` — the indentation never lies", () => {
		// A guard written as the SECOND statement under an unbraced `if` runs
		// unconditionally while reading as conditional:
		//
		//   if (!access.actingAsAdmin)
		//     await assertSubscriptionActive(ctx, id);
		//     await assertOrderCreditAvailable(ctx, order);  // NOT inside the if
		//
		// Ten sites shipped that shape (PR #320 review, 2 Oct). Behaviour was
		// right only by accident — both guards start with their own `isAdmin`
		// early return — so the next person to move an admin bypass, or to copy
		// the shape for a guard that has no bypass, breaks white-glove act-as or
		// opens a hole, in auth-adjacent code. Biome would never catch it: its
		// `files.includes` is `src/**` only, so `convex/` is neither formatted
		// nor linted (bringing it in is its own mechanical PR).
		const offenders: string[] = [];
		for (const file of readdirSync(CONVEX).filter(
			(f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
		)) {
			const lines = readFileSync(join(CONVEX, file), "utf8").split("\n");
			lines.forEach((line, i) => {
				if (!/^\s*(await\s+)?assert[A-Z]\w*\(/.test(line)) return;
				const prev = lines[i - 1] ?? "";
				const head = lines[i - 2] ?? "";
				const indent = (l: string) => /^\t*/.exec(l)?.[0].length ?? 0;
				// Same depth as the line above it, which is itself the lone body
				// of an `if (...)` that opened no block.
				if (
					indent(line) === indent(prev) &&
					/^\s*if \(.*\)\s*$/.test(head) &&
					indent(head) < indent(prev)
				)
					offenders.push(`${file}:${i + 1} ${line.trim()}`);
			});
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	test("order intake never carries the credit guard", () => {
		const offenders: string[] = [];
		for (const mod of INTAKE_MODULES)
			for (const [name, body] of publicWrites(mod))
				if (guarded(body)) offenders.push(name);
		expect(offenders).toEqual([]);
	});

	test("every way back stays open — top-up, billing, plans, settings, team", () => {
		const offenders: string[] = [];
		for (const mod of WAY_BACK_MODULES)
			for (const [name, body] of publicWrites(mod))
				if (guarded(body)) offenders.push(name);
		expect(offenders).toEqual([]);
		// Proof the scan reaches the one a gated seller needs most.
		expect(publicWrites("creditPurchases").has("creditPurchases.createTopUp")).toBe(
			true,
		);
	});
});

describe("…and every seller READ of an order either redacts or says why not", () => {
	test("each public query is classified", () => {
		// The half the store-wide lock never had to think about. A gated order
		// is invisible, so a new seller read that forgets the redaction is a
		// hole — and the hole is a phone number, which is all a seller needs to
		// settle the order by hand and pay us nothing.
		const unclassified: string[] = [];
		for (const mod of READ_MODULES)
			for (const [name, body] of publicReads(mod))
				if (!redacts(body) && !(name in OPEN_READS)) unclassified.push(name);
		expect(unclassified).toEqual([]);
	});

	test("no stale excuses, and every open read says why", () => {
		const all = new Set<string>();
		for (const mod of READ_MODULES)
			for (const k of publicReads(mod).keys()) all.add(k);
		expect(Object.keys(OPEN_READS).filter((n) => !all.has(n))).toEqual([]);
		for (const reason of Object.values(OPEN_READS))
			expect(reason.length).toBeGreaterThan(10);
	});

	test("an excused read must NOT redact — an excuse and a seam is two rules", () => {
		for (const name of Object.keys(OPEN_READS)) {
			const mod = name.split(".")[0];
			const body = publicReads(mod).get(name) ?? "";
			expect(redacts(body), `${name} is excused but redacts anyway`).toBe(false);
		}
	});

	test("the reads that matter most are on the redacting side", () => {
		// Named explicitly rather than left to the classification sweep: these
		// four are the surfaces a seller actually works from, and a regression
		// in any of them is the whole feature failing quietly.
		for (const name of [
			"orders.get",
			"orders.searchOrders",
			"orders.listByRetailer",
			"customers.ordersByCustomer",
		]) {
			const mod = name.split(".")[0];
			const body = publicReads(mod).get(name) ?? "";
			expect(body, `${name} must redact`).not.toBe("");
			expect(redacts(body), `${name} must redact`).toBe(true);
		}
	});
});
