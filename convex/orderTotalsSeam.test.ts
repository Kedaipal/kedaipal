// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	computeOrderTotals,
	orderExtras,
	storedDiscount,
} from "./lib/order";

/**
 * The order-total seam (`z8r3fdr617`).
 *
 * A voucher is the FIRST SUBTRACTIVE term `total` has ever carried, and the
 * failure it introduces is silent: a recompute site that drops it charges the
 * buyer FULL PRICE with no error anywhere. Six sites in `convex/orders.ts`
 * recompute an existing order's total, and before this feature all six
 * hand-listed the extras they happened to know about — a list that had already
 * drifted (every one of them omitted `securityDeposit`).
 *
 * So the discount is not threaded through six lists. It rides `orderExtras()`,
 * and this file holds the two halves of keeping that true:
 *
 *  1. the MATHS — the clamp, the rounding, and the rule that a voucher never
 *     touches a fee or a deposit;
 *  2. the STRUCTURE — a source scan asserting every `computeOrderTotals` call
 *     in `convex/` either spreads `orderExtras(...)` or is a classified
 *     order-CREATE door, so a seventh recompute site cannot be written the old
 *     way without failing here.
 *
 * The behavioural proof that each of the six actually preserves a live
 * voucher is in `voucherRedemption.test.ts`.
 */

const line = (price: number, quantity = 1) => ({ price, quantity });

describe("computeOrderTotals — the additive terms are unchanged", () => {
	test("subtotal is the sum of lines; no extras means total === subtotal", () => {
		const { subtotal, discount, total } = computeOrderTotals([
			line(1200, 2),
			line(500),
		]);
		expect(subtotal).toBe(2900);
		expect(discount).toBe(0);
		expect(total).toBe(2900);
	});

	test("quote, pickup fee, delivery fee and deposit all ADD", () => {
		const { total } = computeOrderTotals([line(1000)], {
			quotedAmount: 400,
			pickupFee: 200,
			deliveryFee: 800,
			securityDeposit: 5000,
		});
		expect(total).toBe(1000 + 400 + 200 + 800 + 5000);
	});

	test("negative extras floor to 0", () => {
		const { total } = computeOrderTotals([line(1000)], {
			pickupFee: -500,
			deliveryFee: -500,
		});
		expect(total).toBe(1000);
	});
});

describe("computeOrderTotals — the voucher term", () => {
	test("a fixed voucher comes off the total", () => {
		const { subtotal, discount, total } = computeOrderTotals([line(5000)], {
			voucher: { kind: "fixed", value: 1000 },
		});
		expect(subtotal).toBe(5000);
		expect(discount).toBe(1000);
		expect(total).toBe(4000);
	});

	test("subtotal stays GROSS — the discount is reported separately", () => {
		// Load-bearing: the min-order rules and the free-delivery thresholds read
		// `subtotal`, so netting the discount into it would silently move every
		// threshold in the app.
		const { subtotal, total } = computeOrderTotals([line(5000)], {
			voucher: { kind: "percent", value: 50 },
		});
		expect(subtotal).toBe(5000);
		expect(total).toBe(2500);
	});

	test("the discount NEVER eats a fee or a deposit", () => {
		// The doc's guard rail. A RM50 code on a RM30 basket with RM8 delivery
		// takes the RM30 of goods and leaves the RM8 standing — the buyer still
		// pays the courier.
		const { discount, total } = computeOrderTotals([line(3000)], {
			deliveryFee: 800,
			voucher: { kind: "fixed", value: 5000 },
		});
		expect(discount).toBe(3000);
		expect(total).toBe(800);
	});

	test("a 100% voucher leaves the deposit and the fees payable", () => {
		const { total } = computeOrderTotals([line(4000)], {
			pickupFee: 200,
			deliveryFee: 800,
			securityDeposit: 5000,
			voucher: { kind: "percent", value: 100 },
		});
		expect(total).toBe(6000);
	});

	test("the total can never go negative, whatever the voucher is worth", () => {
		for (const value of [5000, 100_000, VERY_LARGE]) {
			const { total } = computeOrderTotals([line(1000)], {
				voucher: { kind: "fixed", value },
			});
			expect(total).toBeGreaterThanOrEqual(0);
		}
		// …and the degenerate case: nothing in the basket at all.
		const empty = computeOrderTotals([], {
			voucher: { kind: "fixed", value: 5000 },
		});
		expect(empty.total).toBe(0);
		expect(empty.discount).toBe(0);
	});

	test("the mockup quote is NOT discountable — it isn't an item", () => {
		// A 100% voucher on a made-to-order order takes off the (zero) item
		// subtotal, not the seller's quote. Discounting bespoke work the seller
		// priced by hand is not something a giveaway code may do.
		const { discount, total } = computeOrderTotals([line(0)], {
			quotedAmount: 20_000,
			voucher: { kind: "percent", value: 100 },
		});
		expect(discount).toBe(0);
		expect(total).toBe(20_000);
	});

	test("a voucher stacks on top of promo-discounted LINE prices", () => {
		// Promo changes the line price; the voucher is an order-level deduction.
		// Two mechanisms, and the voucher's base is whatever the lines now sum
		// to — so a 10% code on a promo-priced basket discounts the promo price.
		const { subtotal, discount, total } = computeOrderTotals([line(2160, 2)], {
			voucher: { kind: "percent", value: 10 },
		});
		expect(subtotal).toBe(4320);
		expect(discount).toBe(432);
		expect(total).toBe(3888);
	});
});

const VERY_LARGE = Number.MAX_SAFE_INTEGER;

describe("orderExtras — the one author for an existing order's terms", () => {
	test("carries every term the order holds", () => {
		expect(
			orderExtras({
				mockupQuotedAmount: 400,
				pickupFee: 200,
				deliveryFee: 800,
				securityDeposit: 5000,
				voucherSnapshot: { code: "KP-7F3K-Q2WM", kind: "fixed", value: 1000 },
			}),
		).toEqual({
			quotedAmount: 400,
			pickupFee: 200,
			deliveryFee: 800,
			securityDeposit: 5000,
			voucher: { code: "KP-7F3K-Q2WM", kind: "fixed", value: 1000 },
		});
	});

	test("an order with nothing on it yields no terms", () => {
		const extras = orderExtras({});
		expect(computeOrderTotals([line(1000)], extras).total).toBe(1000);
	});

	test("a spread site can override ONE term and keep the rest", () => {
		const order = {
			mockupQuotedAmount: 400,
			pickupFee: 200,
			deliveryFee: 800,
			securityDeposit: 5000,
			voucherSnapshot: { code: "KP-7F3K-Q2WM", kind: "fixed" as const, value: 1000 },
		};
		// The shape every recompute site uses — change the delivery fee, keep
		// the quote, the pickup fee, the deposit AND the voucher.
		const { discount, total } = computeOrderTotals([line(5000)], {
			...orderExtras(order),
			deliveryFee: 1500,
		});
		expect(discount).toBe(1000);
		expect(total).toBe(5000 + 400 + 200 + 1500 + 5000 - 1000);
	});

	test("every term orderExtras carries reaches the total", () => {
		// Guards the real failure mode: a term added to `OrderExtrasSource` but
		// forgotten in the returned object would be silently dropped at all six
		// sites at once. Each key is zeroed in turn; every one must move the
		// total, which can only be true if `orderExtras` is passing it through.
		const full = {
			mockupQuotedAmount: 400,
			pickupFee: 200,
			deliveryFee: 800,
			securityDeposit: 5000,
			voucherSnapshot: { code: "KP-7F3K-Q2WM", kind: "fixed" as const, value: 1000 },
		};
		const baseline = computeOrderTotals([line(5000)], orderExtras(full)).total;
		for (const key of Object.keys(full) as Array<keyof typeof full>) {
			const without = { ...full, [key]: undefined };
			const total = computeOrderTotals([line(5000)], orderExtras(without)).total;
			expect(total, `${key} is not reaching the total`).not.toBe(baseline);
		}
	});
});

describe("storedDiscount — 0 is never stored", () => {
	test("a real discount stores, a zero one clears the field", () => {
		expect(storedDiscount(1000)).toBe(1000);
		expect(storedDiscount(0)).toBeUndefined();
		// Mirrors pickupFee/deliveryFee, so a voucher that computes to nothing
		// leaves no misleading `0` on the order.
		expect(storedDiscount(-5)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// The structural half: no site may hand-list extras again
// ---------------------------------------------------------------------------

const CONVEX = __dirname;

/**
 * Order-CREATE doors. These build their extras from the checkout's own inputs
 * — there is no existing order to read terms off — so they legitimately pass a
 * literal. Each is named with the door it is, which is the point: adding a
 * seventh RECOMPUTE site cannot be waved through here without someone
 * noticing it is not a create door.
 *
 * Keyed by `file:firstArgument`, which is what identifies a call site stably
 * across edits (line numbers move; `snapshotItems` vs `order.items` does not).
 */
const CREATE_DOORS: Record<string, string> = {
	"orders.ts:snapshotItems":
		"storefront checkout — builds the snapshot and resolves the voucher itself",
	"counterCheckout.ts:snapshotItems":
		"counter sale — builds the snapshot and resolves the draft's voucher itself",
	"orderClaims.ts:claim.lines":
		"claim commit — prices the FROZEN claim lines and its own frozen voucher",
	"bookings.ts:items":
		"booking request — builds its lines and deposit; vouchers are not offered on bookings in v1",
};

/** Every `computeOrderTotals(` call in `convex/`, with its file, its first
 * argument and the full call text. */
function totalsCallSites(): Array<{
	file: string;
	firstArg: string;
	text: string;
}> {
	const sites: Array<{ file: string; firstArg: string; text: string }> = [];
	const walk = (dir: string, prefix = ""): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (entry.name === "_generated") continue;
				walk(join(dir, entry.name), `${prefix}${entry.name}/`);
				continue;
			}
			if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts"))
				continue;
			const src = readFileSync(join(dir, entry.name), "utf8");
			// Skip the definition itself and any import line.
			for (const match of src.matchAll(/computeOrderTotals\(([\s\S]*?)\n\t\t\}?\)?;/g)) {
				const text = match[0];
				const firstArg = (match[1].split(",")[0] ?? "").trim();
				if (firstArg === "" || firstArg.startsWith("items: ReadonlyArray"))
					continue;
				sites.push({ file: `${prefix}${entry.name}`, firstArg, text });
			}
		}
	};
	walk(CONVEX);
	return sites;
}

describe("no site may hand-list the order's extras again", () => {
	test("the scan actually finds the call sites", () => {
		const sites = totalsCallSites();
		// 6 recompute sites in orders.ts + its create door = 7 there, plus one
		// door each in counterCheckout, orderClaims and bookings.
		expect(sites.length).toBeGreaterThanOrEqual(10);
		const files = new Set(sites.map((s) => s.file));
		for (const f of [
			"orders.ts",
			"counterCheckout.ts",
			"orderClaims.ts",
			"bookings.ts",
		])
			expect(files, f).toContain(f);
	});

	test("every call either spreads orderExtras() or is a classified create door", () => {
		const unclassified: string[] = [];
		for (const site of totalsCallSites()) {
			if (site.text.includes("...orderExtras(")) continue;
			const key = `${site.file}:${site.firstArg}`;
			if (key in CREATE_DOORS) continue;
			unclassified.push(key);
		}
		expect(
			unclassified,
			`These pass a hand-written extras literal while recomputing an existing order — spread ...orderExtras(order) instead, or classify the site in CREATE_DOORS:\n${unclassified.join("\n")}`,
		).toEqual([]);
	});

	test("all six recompute sites in orders.ts spread orderExtras", () => {
		// Proof the rule above is doing work rather than passing vacuously: the
		// six sites are the mockup submit + re-quote, the custom-decline, the
		// pickup switch, the address re-price and the seller's delivery charge.
		const spreading = totalsCallSites().filter(
			(s) => s.file === "orders.ts" && s.text.includes("...orderExtras("),
		);
		expect(spreading).toHaveLength(6);
		// …and each one reads an EXISTING order's lines, which is what makes it a
		// recompute rather than a door.
		for (const site of spreading)
			expect(["order.items", "kept"], site.firstArg).toContain(site.firstArg);
	});

	test("every create door is a real call site — no stale classifications", () => {
		const keys = new Set(
			totalsCallSites().map((s) => `${s.file}:${s.firstArg}`),
		);
		const stale = Object.keys(CREATE_DOORS).filter((k) => !keys.has(k));
		expect(stale).toEqual([]);
		for (const reason of Object.values(CREATE_DOORS))
			expect(reason.length).toBeGreaterThan(20);
	});

	test("every site that computes a discount also persists it", () => {
		// The second half of the mirror. `voucherDiscount` is a cached copy of
		// `computeOrderTotals(...).discount`, so a site that wrote `total` and
		// forgot this would leave a stale discount on the order and the receipt,
		// the CSV and the inbox would disagree with the money.
		//
		// Counted per file rather than matched per statement: the writes sit
		// anywhere inside an insert that can run eighty lines, so any positional
		// window is a guess. A site that binds `discount` and never stores it
		// shows up as a mismatch here. Behavioural proof per site is in
		// voucherRedemption.test.ts.
		const counts: Record<string, { binds: number; stores: number }> = {};
		for (const file of ["orders.ts", "counterCheckout.ts", "orderClaims.ts"]) {
			const src = readFileSync(join(CONVEX, file), "utf8");
			counts[file] = {
				binds: [...src.matchAll(/const \{ subtotal, discount, total \}/g)]
					.length,
				stores: [...src.matchAll(/voucherDiscount: storedDiscount\(discount\)/g)]
					.length,
			};
		}
		// Proof the scan reaches the sites it watches — 6 recompute + 1 door.
		expect(counts["orders.ts"].binds).toBe(7);
		expect(counts["counterCheckout.ts"].binds).toBe(1);
		expect(counts["orderClaims.ts"].binds).toBe(1);
		for (const [file, { binds, stores }] of Object.entries(counts))
			expect(stores, `${file} binds ${binds} discounts but stores ${stores}`).toBe(
				binds,
			);
	});
});
