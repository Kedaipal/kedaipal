// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the view-only lock (ClickUp `z8r3fdeub2`).
 *
 * A store whose subscription has lapsed — an unpaid invoice, or an admin
 * turning a comp upgrade off — is VIEW-ONLY: it reads everything it ever
 * could, and nothing it does changes a row. Until 19 Sep 2026 the lock covered
 * only "growth-writes" (products, settings), so a lapsed seller could still
 * run their shop: move orders through packed → shipped, take payment, book a
 * rider, print labels. Owner decision that day: "all actions will be locked,
 * it's all view only. BE should also reject it if they try something funny on
 * the FE."
 *
 * The lock is a line-by-line `assertSubscriptionActive` call, which is exactly
 * the kind of rule a new mutation forgets. So instead of trusting a reviewer to
 * notice, every public seller-facing `mutation`/`action` in `convex/` must
 * either carry a guard or be named below WITH ITS REASON. A new one that is
 * neither fails this test — the author has to make the call deliberately.
 *
 * House precedent for a scan-the-source gate test: `convex-read-pattern.test.ts`
 * (frontend reads) and `dependency-pins.test.ts` (package.json specs).
 */

/** Anything that proves the caller can't be a locked seller. */
const GUARDS = [
	// The guard itself, in a mutation or a query the action runs.
	"assertSubscriptionActive(",
	// Same lock for a write whose args carry no store (upload-URL minters).
	"assertOwnStoreActive(",
	// Same lock from an action, which has no ctx.db.
	"internal.subscriptions.assertWritable",
	"internal.subscriptions.assertWritableForOrder",
	// Admin-console only: admins are never locked (they run the app), so an
	// admin-gated function is out of scope by construction, not by choice.
	"requireAdmin(",
];

/**
 * Public functions that are deliberately NOT locked, and why. Three kinds:
 *
 *  1. BUYER — the storefront and the buyer's own order page. The whole point of
 *     a SOFT lock is that the seller's customers never feel it: they browse,
 *     order, pay, track and fix their own details exactly as before.
 *  2. BILLING — the way out of the lock. Locking these would trap the seller
 *     in it forever.
 *  3. ACCOUNT / VIEW — legal consent, onboarding state, dismissals, read-only
 *     artifacts, and idempotent "mint the token this screen displays" calls.
 *     None of them change the store or its orders.
 */
const UNLOCKED: Record<string, string> = {
	// 1. Buyer side — never locked.
	"orders.create": "buyer: places an order from the storefront",
	"orders.updateBuyerPhone": "buyer: repairs the number a failed push went to",
	"orders.updateDeliveryAddress": "buyer: edits their own delivery address",
	"orders.updatePickupLocation": "buyer: changes where they collect",
	"orders.claimPayment": "buyer: 'I've paid'",
	"orders.generateOrderProofUploadUrl": "buyer: uploads their payment proof",
	"orders.generateCustomImageUploadUrl": "buyer: uploads a reference image",
	"orders.approveMockup": "buyer: approves the seller's mockup",
	"orders.requestMockupChanges": "buyer: asks for a change",
	"orders.declineMockupItem": "buyer: declines the custom item",
	"bookings.requestBooking": "buyer: requests a stay",
	"orderClaims.commit": "buyer: completes a claim link",
	"lalamove.quoteForCheckout": "buyer: priced at checkout",
	"liveQuote.quoteForCheckout": "buyer: priced at checkout",
	"google.autocompleteAddress": "buyer + seller: read-only address lookup",
	"google.getPlaceDetails": "buyer + seller: read-only address lookup",
	"hitpay.createCheckout": "buyer: pays the seller",
	"hitpay.verifyCheckout": "buyer: confirms their own payment",

	// 2. Billing — the door out. Locking these locks the seller in.
	"invoices.subscribeSelf": "billing: buying a plan IS the unlock",
	"invoices.changePlan": "billing: schedule a plan change",
	"invoices.cancelPlanChange": "billing: undo that",
	"invoices.switchPendingPlan": "billing: change the plan before paying",
	"invoices.getOrCreateInvoicePdfUrl": "billing: read their own bill",
	"invoices.getOrCreateInvoiceReceiptPdfUrl": "billing: read their own receipt",
	"subscriptionPayments.verifyInvoicePayment": "billing: confirm a payment",
	"subscriptionPayments.startAutoRenewSetup": "billing: save a payment method",
	"subscriptionPayments.finishAutoRenewSetup": "billing: save a payment method",
	"subscriptionPayments.cancelAutoRenew":
		"billing: turning auto-renewal off must never need an active sub — that would be a trap",

	// 3. Account, legal, onboarding state, and read-only artifacts.
	"retailers.createRetailer": "no store yet — nothing to lock",
	"retailers.recordConsentAcceptance": "legal consent is never withheld",
	"retailers.ensureNotifyEmailFromIdentity": "account housekeeping",
	"retailers.ackCountrySetup": "dismisses a banner",
	"retailers.markPickupSetupSeen": "dismisses a hint",
	"retailers.markGreetingSetupDone": "onboarding checklist state",
	"retailers.markLinkShared": "onboarding checklist state",
	"releases.markSeen": "dismisses the what's-new modal",
	"foundingMembers.markWhiteGloveScheduled":
		"records that they booked their onboarding call",
	"calendarFeed.ensureCalendarFeedToken":
		"idempotent view-enabler: returns the token the Bookings card displays, minting only on first view (rotate IS locked)",
	"counterCheckout.ensureCounterQrToken":
		"idempotent view-enabler: returns the token the poster displays (rotate IS locked, and the counter sale it leads to is too)",
	"orders.generateReceiptPdf": "read-only: renders an existing order",
	"orders.exportOrders": "read-only: their own data, never held hostage",
	"orders.markSeen":
		"involuntary: fires when the seller OPENS an order, so locking it would error on a page view — and 'I looked at it' is the one write that view-only must allow. Pinning (setPinned) IS locked: that's a deliberate tap",
	"orders.deleteOrder": "Kedaipal admin only (isAdmin check, Forbidden)",
	"orders.bulkDeleteOrders": "Kedaipal admin only (isAdmin check, Forbidden)",
	"subscriptions.setSeasonalHold":
		"billing, and already refused: canEnterHold turns down a lapsed, comped or comp-ended store with copy written for each — a second guard would only replace a good message with a generic one",
};

const CONVEX = __dirname;

/** Hand-written Convex modules — the generated tree and tests aren't ours. */
function moduleFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "_generated") moduleFiles(full, acc);
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			acc.push(full);
		}
	}
	return acc;
}

const DEF =
	/export const (\w+)\s*=\s*(mutation|action|query|internalMutation|internalQuery|internalAction)\(/g;

type Fn = { key: string; kind: string; body: string };

function publicWrites(): Fn[] {
	const out: Fn[] = [];
	for (const file of moduleFiles(CONVEX)) {
		const src = readFileSync(file, "utf8");
		const mod = basename(file, ".ts");
		const hits = [...src.matchAll(DEF)];
		for (let i = 0; i < hits.length; i++) {
			const [, name, kind] = hits[i];
			// Only PUBLIC writes: `internal*` can't be called from a browser, and a
			// `query` doesn't write. Both are out of scope for a view-only lock.
			if (kind !== "mutation" && kind !== "action") continue;
			const start = hits[i].index ?? 0;
			const end = hits[i + 1]?.index ?? src.length;
			out.push({ key: `${mod}.${name}`, kind, body: src.slice(start, end) });
		}
	}
	return out;
}

describe("view-only lock — every public seller write is classified", () => {
	const fns = publicWrites();

	test("the scan finds the whole surface (a broken regex would pass vacuously)", () => {
		expect(fns.length).toBeGreaterThan(80);
		expect(fns.map((f) => f.key)).toContain("orders.updateStatus");
	});

	test("no public mutation or action is both unguarded and unlisted", () => {
		const unclassified = fns
			.filter((f) => !GUARDS.some((g) => f.body.includes(g)))
			.filter((f) => UNLOCKED[f.key] === undefined)
			.map((f) => f.key);
		expect(unclassified).toEqual([]);
	});

	test("the allowlist has no stale entries", () => {
		const live = new Set(fns.map((f) => f.key));
		expect(Object.keys(UNLOCKED).filter((k) => !live.has(k))).toEqual([]);
	});

	test("every allowlisted exemption states a reason", () => {
		expect(
			Object.entries(UNLOCKED)
				.filter(([, why]) => why.trim().length < 10)
				.map(([k]) => k),
		).toEqual([]);
	});

	test("an allowlisted function isn't secretly guarded (the note would be a lie)", () => {
		const both = fns
			.filter((f) => UNLOCKED[f.key] !== undefined)
			.filter((f) => GUARDS.some((g) => f.body.includes(g)))
			.map((f) => f.key);
		expect(both).toEqual([]);
	});

	// The four that made the owner raise this: order actions a lapsed seller
	// used to be able to run. Named individually so deleting a guard fails HERE
	// with the reason, not just in the catch-all above.
	test.each([
		"orders.updateStatus",
		"orders.bulkUpdateStatus",
		"orders.advanceToStage",
		"orders.markPaymentReceived",
		"orders.setShipmentTracking",
		"orders.rescheduleFulfilment",
		"counterCheckout.createOrderFromSession",
		"orderClaims.sendClaim",
		"lalamove.confirmBooking",
		"delyva.confirmBooking",
		"awb.generateAwbPdf",
		"orders.sendPaymentReminder",
	])("%s is locked", (key) => {
		const fn = fns.find((f) => f.key === key);
		expect(fn, `${key} not found — was it renamed?`).toBeDefined();
		expect(GUARDS.some((g) => (fn?.body ?? "").includes(g))).toBe(true);
	});
});
