// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for store availability (`z8r3fdudf7`).
 *
 * "Is this store taking orders?" has ONE author (`lib/storeAvailability.ts`),
 * and a closed store is only closed if EVERY door asks it. A new order path
 * that forgets is exactly the kind of gap a reviewer misses — the store looks
 * paused on its storefront while one door quietly still takes orders. So:
 *
 *  1. every public function that inserts an order must call one of the
 *     availability guards;
 *  2. nothing outside the resolver's feeders reads the Off-Season Hold stamp
 *     directly — a raw `orderingPausedAt` check would see the hold and miss
 *     the seller's pause and Kedaipal's switch.
 *
 * Sibling of `creditLockCoverage.test.ts` / `sellerLockCoverage.test.ts`.
 */

const CONVEX = __dirname;
const GUARDS = [
	"assertTakesBuyerOrders(",
	"assertTakesCounterOrders(",
	// counterCheckout's local wrapper around assertTakesCounterOrders.
	"assertOrderingNotPaused(",
];

const sources = readdirSync(CONVEX)
	.filter((f) => f.endsWith(".ts") && !f.includes(".test."))
	.map((f) => ({ file: f, text: readFileSync(join(CONVEX, f), "utf8") }));

/** The body of the exported function each match sits in. */
function enclosingExport(text: string, index: number): { name: string; body: string } {
	const head = /export const (\w+) = (?:internal)?(?:mutation|action|internalMutation|internalAction)\(/g;
	let match: RegExpExecArray | null;
	let last: { name: string; start: number } | null = null;
	for (match = head.exec(text); match; match = head.exec(text)) {
		if (match.index > index) break;
		last = { name: match[1], start: match.index };
	}
	if (!last) return { name: "(module level)", body: "" };
	const next = text.indexOf("\nexport ", index);
	return {
		name: last.name,
		body: text.slice(last.start, next === -1 ? undefined : next),
	};
}

describe("every order door asks whether the store takes orders", () => {
	const doors: string[] = [];
	for (const { file, text } of sources) {
		for (const m of text.matchAll(/db\.insert\("orders"/g)) {
			const fn = enclosingExport(text, m.index ?? 0);
			doors.push(`${file.replace(/\.ts$/, "")}.${fn.name}`);
			test(`${file.replace(/\.ts$/, "")}.${fn.name} is guarded`, () => {
				expect(
					GUARDS.some((g) => fn.body.includes(g)),
					`${fn.name} inserts an order but never calls an availability guard`,
				).toBe(true);
			});
		}
	}

	test("the doors found are the four known ones (a new one must be added on purpose)", () => {
		expect(doors.sort()).toEqual([
			"bookings.requestBooking",
			"counterCheckout.createOrderFromSession",
			"orderClaims.commit",
			"orders.create",
		]);
	});
});

describe("the hold stamp is only read through the resolver", () => {
	// Files allowed to touch `orderingPausedAt`: the resolver's feeders (they
	// pass it in as `holdPausedAt`) and the hold's own writer.
	const ALLOWED = new Set(["storeAvailability.ts", "admin.ts", "subscriptions.ts", "schema.ts"]);
	for (const { file, text } of sources) {
		if (ALLOWED.has(file)) continue;
		test(`${file} never reads orderingPausedAt directly`, () => {
			expect(text.includes(".orderingPausedAt")).toBe(false);
		});
	}
});
