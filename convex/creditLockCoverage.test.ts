// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the seller lock at zero credits (Credits T3, ClickUp
 * z8r3fdf8hy — convex/creditLock.ts).
 *
 * At a credit balance of 0 or below the seller can't edit the catalogue or move
 * an order forward — but cancelling, refunding, settings and billing stay open,
 * and order INTAKE never stops. That split is a line-by-line guard call, which
 * is exactly the kind of rule a new mutation forgets, so:
 *
 *  - every public write in a CATALOGUE / DESPATCH module is locked (or excused
 *    below with a reason);
 *  - every public write in an ORDER-HANDLING module is classified, locked or
 *    open, with a reason for every open one — a new function that is neither
 *    fails this test and its author has to decide;
 *  - the open ones must NOT carry the guard (a guarded cancel would trap a
 *    locked seller with a buyer who already paid);
 *  - order-INTAKE modules never carry it at all.
 *
 * Sibling of `sellerLockCoverage.test.ts` (the past-due view-only lock).
 */

const CREDIT_GUARDS = [
	"assertCreditsAvailable(",
	"internal.creditLock.assertCreditsForAction",
	"internal.creditLock.assertCreditsForOrder",
];

/** Every public write here edits the catalogue or despatches an order. */
const LOCKED_MODULES = ["products", "categories", "awb"];

const LOCKED_MODULE_EXCEPTIONS: Record<string, string> = {
	"products.generateUploadUrl":
		"mints an upload URL and nothing else — the image only reaches a product through create/update, which are locked",
};

/** Order-handling modules: every public write is classified below. */
const MIXED_MODULES = ["orders", "bookings", "lalamove", "delyva"];

const LOCKED_FUNCTIONS = [
	// Accepting and moving an order forward (cancel excepted inside).
	"orders.updateStatus",
	"orders.bulkUpdateStatus",
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
];

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
	// Releasing a buyer — must stay open, or a locked seller is stuck holding
	// a paid order they can't hand back.
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
	"orders.exportOrders": "read-only: their own data",
	"orders.generateMockupUploadUrl":
		"mints an upload URL only — the mockup is attached by submitMockup, which is locked",
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

/** Seller-keyed order INTAKE — "order intake never stops" (the counter, claim
 * links): none of their public writes may carry the credit guard. */
const INTAKE_MODULES = ["counterCheckout", "orderClaims"];

/** The WAYS BACK — topping up (T2), paying or changing a plan, resuming a
 * hold, settings and the team: a locked store must always be able to reach
 * every one of them, or the lock becomes a trap. None may carry the guard. */
const WAY_BACK_MODULES = [
	"creditPurchases",
	"invoices",
	"subscriptionPayments",
	"subscriptions",
	"billing",
	"retailers",
	"team",
];

const CONVEX = __dirname;
const DEF =
	/export const (\w+)\s*=\s*(mutation|action|query|internalMutation|internalQuery|internalAction)\(/g;

/** Public writes of one module, with the source text of each body. */
function publicWrites(mod: string): Map<string, string> {
	const src = readFileSync(join(CONVEX, `${mod}.ts`), "utf8");
	const defs = [...src.matchAll(DEF)];
	const out = new Map<string, string>();
	defs.forEach((m, i) => {
		if (m[2] !== "mutation" && m[2] !== "action") return;
		const end = i + 1 < defs.length ? defs[i + 1].index : src.length;
		out.set(`${mod}.${m[1]}`, src.slice(m.index, end));
	});
	return out;
}

const guarded = (body: string) => CREDIT_GUARDS.some((g) => body.includes(g));

describe("the seller lock at zero credits covers every write it should", () => {
	test("the module lists point at real files", () => {
		const files = new Set(
			readdirSync(CONVEX)
				.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
				.map((f) => basename(f, ".ts")),
		);
		for (const mod of [
			...LOCKED_MODULES,
			...MIXED_MODULES,
			...INTAKE_MODULES,
			...WAY_BACK_MODULES,
		])
			expect(files.has(mod)).toBe(true);
	});

	test("every public write in a catalogue / despatch module is locked", () => {
		const offenders: string[] = [];
		for (const mod of LOCKED_MODULES) {
			for (const [name, body] of publicWrites(mod)) {
				if (name in LOCKED_MODULE_EXCEPTIONS) continue;
				if (!guarded(body)) offenders.push(name);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("every public write in an order-handling module is classified", () => {
		const unclassified: string[] = [];
		for (const mod of MIXED_MODULES) {
			for (const name of publicWrites(mod).keys()) {
				if (!LOCKED_FUNCTIONS.includes(name) && !(name in OPEN_FUNCTIONS))
					unclassified.push(name);
			}
		}
		expect(unclassified).toEqual([]);
	});

	test("locked functions carry the guard; open ones don't", () => {
		const all = new Map<string, string>();
		for (const mod of MIXED_MODULES)
			for (const [k, body] of publicWrites(mod)) all.set(k, body);
		const missing = LOCKED_FUNCTIONS.filter((n) => {
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
		for (const mod of [...MIXED_MODULES, ...LOCKED_MODULES])
			for (const k of publicWrites(mod).keys()) all.add(k);
		const stale = [
			...Object.keys(OPEN_FUNCTIONS),
			...Object.keys(LOCKED_MODULE_EXCEPTIONS),
			...LOCKED_FUNCTIONS,
		].filter((n) => !all.has(n));
		expect(stale).toEqual([]);
		for (const reason of [
			...Object.values(OPEN_FUNCTIONS),
			...Object.values(LOCKED_MODULE_EXCEPTIONS),
		])
			expect(reason.length).toBeGreaterThan(10);
	});

	test("cancelling through the status mutations is never locked", () => {
		for (const name of ["orders.updateStatus", "orders.bulkUpdateStatus"]) {
			const body = publicWrites("orders").get(name) ?? "";
			const at = body.indexOf("assertCreditsAvailable(");
			expect(at).toBeGreaterThan(-1);
			// The guard sits behind the cancel test, on the same statement.
			const before = body.slice(Math.max(0, at - 80), at);
			expect(before).toContain('status !== "cancelled"');
		}
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
		// Proof the scan reaches the one a locked seller needs most.
		expect(publicWrites("creditPurchases").has("creditPurchases.createTopUp")).toBe(
			true,
		);
	});
});
