import { describe, expect, test } from "vitest";
import {
	addMoney,
	type BusinessReportInput,
	BUSINESS_REPORT_ORDER_SCAN_CAP,
	classifyPastDue,
	isExcludedRetailer,
	latestPaidInvoiceByRetailer,
	MAX_SLUGS_PER_BUCKET,
	monthlyEquivalent,
	monthsInInvoicePeriod,
	mytWeekWindow,
	reduceBusinessReport,
	type ReportOrderInput,
	type ReportPaidInvoiceInput,
	type ReportPendingInvoiceInput,
	type ReportRetailerInput,
	type ReportSubscriptionInput,
	reportSecretMatches,
	soonestPendingByRetailer,
} from "./businessReport";
import { MYT_OFFSET_MS, mytMidnightFromYmd } from "./fulfilmentDate";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Monday-morning "now": 2026-08-24 09:00 MYT = 01:00 UTC. The window it
 * produces therefore covers 2026-08-17 .. 2026-08-23 inclusive. */
const NOW = mytMidnightFromYmd("2026-08-24") + 9 * 60 * 60 * 1000;
const WEEK_START = mytMidnightFromYmd("2026-08-17");
const WEEK_END_EXCLUSIVE = mytMidnightFromYmd("2026-08-24");

// --- fixtures --------------------------------------------------------------

function retailer(
	overrides: Partial<ReportRetailerInput> = {},
): ReportRetailerInput {
	return {
		id: "r1",
		slug: "kedai-satu",
		userId: "user_1",
		notifyEmail: "owner@example.com",
		createdAt: mytMidnightFromYmd("2026-01-01"),
		...overrides,
	};
}

function sub(
	overrides: Partial<ReportSubscriptionInput> = {},
): ReportSubscriptionInput {
	return {
		retailerId: "r1",
		status: "active",
		comped: undefined,
		updatedAt: mytMidnightFromYmd("2026-08-20"),
		...overrides,
	};
}

function paidInvoice(
	overrides: Partial<ReportPaidInvoiceInput> = {},
): ReportPaidInvoiceInput {
	const periodStart = mytMidnightFromYmd("2026-08-01");
	return {
		retailerId: "r1",
		total: 14_900, // Pro monthly, MYR
		currency: "MYR",
		periodStart,
		periodEnd: periodStart + 30 * DAY_MS,
		billingCycle: "monthly",
		markedPaidAt: periodStart,
		createdAt: periodStart,
		...overrides,
	};
}

function pendingInvoice(
	overrides: Partial<ReportPendingInvoiceInput> = {},
): ReportPendingInvoiceInput {
	return {
		retailerId: "r1",
		dueDate: mytMidnightFromYmd("2026-08-20"),
		...overrides,
	};
}

function order(overrides: Partial<ReportOrderInput> = {}): ReportOrderInput {
	return {
		retailerId: "r1",
		createdAt: mytMidnightFromYmd("2026-08-19"),
		status: "confirmed",
		total: 5_000,
		...overrides,
	};
}

function input(
	overrides: Partial<BusinessReportInput> = {},
): BusinessReportInput {
	return {
		now: NOW,
		adminUserIds: [],
		retailers: [],
		subscriptions: [],
		paidInvoices: [],
		pendingInvoices: [],
		orders: [],
		ordersCapped: false,
		founding: { reserved: 0, paid: 0 },
		...overrides,
	};
}

// --- window ----------------------------------------------------------------

describe("mytWeekWindow", () => {
	test("is a 7-day span ending at today's MYT midnight, exclusive", () => {
		const w = mytWeekWindow(NOW);
		expect(w.endExclusive).toBe(WEEK_END_EXCLUSIVE);
		expect(w.start).toBe(WEEK_END_EXCLUSIVE - 7 * DAY_MS);
	});

	test("both bounds land exactly on MYT midnight", () => {
		const w = mytWeekWindow(NOW);
		expect((w.start + MYT_OFFSET_MS) % DAY_MS).toBe(0);
		expect((w.endExclusive + MYT_OFFSET_MS) % DAY_MS).toBe(0);
	});

	test("endYmd names the last day COVERED, not the exclusive bound", () => {
		const w = mytWeekWindow(NOW);
		expect(w.startYmd).toBe("2026-08-17");
		expect(w.endYmd).toBe("2026-08-23");
	});

	test("rolls on the MYT day boundary, not the UTC one", () => {
		// 2026-08-23T16:30Z is already 24 Aug in Malaysia; 15:30Z is still 23 Aug.
		const after = mytWeekWindow(Date.parse("2026-08-23T16:30:00Z"));
		const before = mytWeekWindow(Date.parse("2026-08-23T15:30:00Z"));
		expect(after.endExclusive - before.endExclusive).toBe(DAY_MS);
	});

	test("is stable across any two moments in the same MYT day", () => {
		const early = mytWeekWindow(WEEK_END_EXCLUSIVE + 1);
		const late = mytWeekWindow(WEEK_END_EXCLUSIVE + DAY_MS - 1);
		expect(early).toEqual(late);
	});
});

// --- classifier ------------------------------------------------------------

describe("classifyPastDue", () => {
	const now = NOW;

	test("never paid → trial_expired, with or without a pending invoice", () => {
		expect(
			classifyPastDue({ hasPaidInvoice: false, pending: undefined, now }),
		).toBe("trial_expired");
		expect(
			classifyPastDue({ hasPaidInvoice: false, pending: pendingInvoice(), now }),
		).toBe("trial_expired");
	});

	test("paid before, no pending invoice → awaiting_invoice (Arif's action)", () => {
		expect(
			classifyPastDue({ hasPaidInvoice: true, pending: undefined, now }),
		).toBe("awaiting_invoice");
	});

	test("paid before, pending invoice past due → lapsed_customer", () => {
		expect(
			classifyPastDue({
				hasPaidInvoice: true,
				pending: pendingInvoice({ dueDate: now - DAY_MS }),
				now,
			}),
		).toBe("lapsed_customer");
	});

	test("paid before, pending invoice not yet due → awaiting_payment", () => {
		expect(
			classifyPastDue({
				hasPaidInvoice: true,
				pending: pendingInvoice({ dueDate: now + DAY_MS }),
				now,
			}),
		).toBe("awaiting_payment");
	});

	test("dueDate exactly now is NOT yet overdue (matches the cron's `<`)", () => {
		expect(
			classifyPastDue({
				hasPaidInvoice: true,
				pending: pendingInvoice({ dueDate: now }),
				now,
			}),
		).toBe("awaiting_payment");
	});
});

// --- money -----------------------------------------------------------------

describe("monthsInInvoicePeriod / monthlyEquivalent", () => {
	test("monthly invoice contributes its full total", () => {
		const inv = paidInvoice({ billingCycle: "monthly", total: 14_900 });
		expect(monthsInInvoicePeriod(inv)).toBe(1);
		expect(monthlyEquivalent(inv)).toBe(14_900);
	});

	test("annual invoice divides by 12", () => {
		const inv = paidInvoice({ billingCycle: "annual", total: 149_000 });
		expect(monthsInInvoicePeriod(inv)).toBe(12);
		expect(monthlyEquivalent(inv)).toBe(12_417);
	});

	test("reduces the discounted total, not the pre-discount amount", () => {
		// Founding Pro is RM104, not RM149.
		expect(monthlyEquivalent(paidInvoice({ total: 10_400 }))).toBe(10_400);
	});

	test("legacy row without billingCycle: a 365-day span reads as 12 months", () => {
		const start = mytMidnightFromYmd("2026-01-01");
		const inv = paidInvoice({
			billingCycle: undefined,
			periodStart: start,
			periodEnd: start + 365 * DAY_MS,
			total: 149_000,
		});
		// A naive /30 would give 12.17 and mis-price this.
		expect(monthsInInvoicePeriod(inv)).toBe(12);
	});

	test("legacy row without billingCycle: a 30-day span reads as 1 month", () => {
		const start = mytMidnightFromYmd("2026-01-01");
		expect(
			monthsInInvoicePeriod(
				paidInvoice({
					billingCycle: undefined,
					periodStart: start,
					periodEnd: start + 30 * DAY_MS,
				}),
			),
		).toBe(1);
	});

	test("degenerate zero-length period floors at 1 month, never Infinity", () => {
		const start = mytMidnightFromYmd("2026-01-01");
		const inv = paidInvoice({
			billingCycle: undefined,
			periodStart: start,
			periodEnd: start,
			total: 9_900,
		});
		expect(monthsInInvoicePeriod(inv)).toBe(1);
		expect(Number.isFinite(monthlyEquivalent(inv))).toBe(true);
	});

	test("addMoney keeps currencies in separate buckets", () => {
		const acc = {};
		addMoney(acc, "MYR", 100);
		addMoney(acc, "SGD", 50);
		addMoney(acc, "MYR", 25);
		expect(acc).toEqual({ MYR: 125, SGD: 50 });
	});
});

// --- invoice indexing ------------------------------------------------------

describe("latestPaidInvoiceByRetailer / soonestPendingByRetailer", () => {
	test("keeps only the most recently paid invoice per retailer", () => {
		const older = paidInvoice({
			markedPaidAt: mytMidnightFromYmd("2026-06-01"),
			total: 7_900,
		});
		const newer = paidInvoice({
			markedPaidAt: mytMidnightFromYmd("2026-08-01"),
			total: 14_900,
		});
		const map = latestPaidInvoiceByRetailer([older, newer]);
		expect(map.get("r1")?.total).toBe(14_900);
	});

	test("falls back to createdAt when markedPaidAt is absent", () => {
		const older = paidInvoice({
			markedPaidAt: undefined,
			createdAt: mytMidnightFromYmd("2026-06-01"),
			total: 7_900,
		});
		const newer = paidInvoice({
			markedPaidAt: undefined,
			createdAt: mytMidnightFromYmd("2026-08-01"),
			total: 14_900,
		});
		expect(latestPaidInvoiceByRetailer([newer, older]).get("r1")?.total).toBe(
			14_900,
		);
	});

	test("keeps the soonest-due pending invoice per retailer", () => {
		const map = soonestPendingByRetailer([
			pendingInvoice({ dueDate: mytMidnightFromYmd("2026-09-01") }),
			pendingInvoice({ dueDate: mytMidnightFromYmd("2026-08-01") }),
		]);
		expect(map.get("r1")?.dueDate).toBe(mytMidnightFromYmd("2026-08-01"));
	});
});

// --- MRR -------------------------------------------------------------------

describe("reduceBusinessReport — MRR", () => {
	test("MYR and SGD never blend into one figure", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [
					retailer({ id: "r1", slug: "my-store", userId: "u1" }),
					retailer({ id: "r2", slug: "sg-store", userId: "u2" }),
				],
				subscriptions: [
					sub({ retailerId: "r1" }),
					sub({ retailerId: "r2" }),
				],
				paidInvoices: [
					paidInvoice({ retailerId: "r1", total: 14_900, currency: "MYR" }),
					paidInvoice({ retailerId: "r2", total: 5_900, currency: "SGD" }),
				],
			}),
		);
		// toEqual on the whole object: a blended sum cannot pass this.
		expect(report.mrr.byCurrency).toEqual({ MYR: 14_900, SGD: 5_900 });
		expect(report.mrr.contributingCount).toBe(2);
	});

	test("only the most recent paid invoice counts, not the sum of all", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				subscriptions: [sub()],
				paidInvoices: [
					paidInvoice({
						markedPaidAt: mytMidnightFromYmd("2026-06-01"),
						total: 7_900,
					}),
					paidInvoice({
						markedPaidAt: mytMidnightFromYmd("2026-07-01"),
						total: 7_900,
					}),
					paidInvoice({
						markedPaidAt: mytMidnightFromYmd("2026-08-01"),
						total: 14_900,
					}),
				],
			}),
		);
		expect(report.mrr.byCurrency).toEqual({ MYR: 14_900 });
	});

	test("active with no paid invoice is surfaced, not silently zero", () => {
		const report = reduceBusinessReport(
			input({ retailers: [retailer()], subscriptions: [sub()] }),
		);
		expect(report.mrr.activeWithoutPaidInvoice).toBe(1);
		expect(report.mrr.byCurrency).toEqual({});
	});

	test("a comped active store contributes nothing and is not miscounted", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				subscriptions: [sub({ comped: true })],
				paidInvoices: [paidInvoice()],
			}),
		);
		expect(report.mrr.byCurrency).toEqual({});
		expect(report.mrr.activeWithoutPaidInvoice).toBe(0);
		expect(report.subscriptions.comped).toBe(1);
		expect(report.subscriptions.active).toBe(1);
	});

	test("an unexpected currency surfaces as its own key rather than vanishing", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				subscriptions: [sub()],
				paidInvoices: [paidInvoice({ currency: "USD", total: 3_000 })],
			}),
		);
		expect(report.mrr.byCurrency).toEqual({ USD: 3_000 });
	});
});

// --- past due --------------------------------------------------------------

describe("reduceBusinessReport — past_due breakdown", () => {
	const four = () =>
		input({
			retailers: [
				retailer({ id: "r1", slug: "lapsed", userId: "u1" }),
				retailer({ id: "r2", slug: "grace", userId: "u2" }),
				retailer({ id: "r3", slug: "needs-invoice", userId: "u3" }),
				retailer({ id: "r4", slug: "dead-trial", userId: "u4" }),
			],
			subscriptions: [
				sub({ retailerId: "r1", status: "past_due" }),
				sub({ retailerId: "r2", status: "past_due" }),
				sub({ retailerId: "r3", status: "past_due" }),
				sub({ retailerId: "r4", status: "past_due" }),
			],
			paidInvoices: [
				paidInvoice({ retailerId: "r1" }),
				paidInvoice({ retailerId: "r2" }),
				paidInvoice({ retailerId: "r3" }),
				// r4 never paid.
			],
			pendingInvoices: [
				pendingInvoice({ retailerId: "r1", dueDate: NOW - DAY_MS }),
				pendingInvoice({ retailerId: "r2", dueDate: NOW + DAY_MS }),
				// r3 has none — that's what makes it "awaiting invoice".
			],
		});

	test("splits four ways and names the right store in each", () => {
		const { pastDue } = reduceBusinessReport(four());
		expect(pastDue.total).toBe(4);
		expect(pastDue.lapsedCustomer.slugs).toEqual(["lapsed"]);
		expect(pastDue.awaitingPayment.slugs).toEqual(["grace"]);
		expect(pastDue.awaitingInvoice.slugs).toEqual(["needs-invoice"]);
		expect(pastDue.trialExpired.slugs).toEqual(["dead-trial"]);
	});

	test("a store that was just correctly invoiced is NOT reported as churn", () => {
		// The regression this bucket exists for: issueInvoice leaves the sub in
		// past_due, so the right action must not look like a lost customer.
		const { pastDue } = reduceBusinessReport(four());
		expect(pastDue.lapsedCustomer.count).toBe(1);
		expect(pastDue.awaitingPayment.count).toBe(1);
	});

	test("buckets carry the monthly value of the last paid invoice", () => {
		const { pastDue } = reduceBusinessReport(four());
		expect(pastDue.awaitingInvoice.monthlyValueByCurrency).toEqual({
			MYR: 14_900,
		});
		// A never-paying trial has no value to lose.
		expect(pastDue.trialExpired.monthlyValueByCurrency).toEqual({});
	});

	test("one bucket can hold more than one currency", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [
					retailer({ id: "r1", slug: "my", userId: "u1" }),
					retailer({ id: "r2", slug: "sg", userId: "u2" }),
				],
				subscriptions: [
					sub({ retailerId: "r1", status: "past_due" }),
					sub({ retailerId: "r2", status: "past_due" }),
				],
				paidInvoices: [
					paidInvoice({ retailerId: "r1", currency: "MYR", total: 14_900 }),
					paidInvoice({ retailerId: "r2", currency: "SGD", total: 5_900 }),
				],
				pendingInvoices: [
					pendingInvoice({ retailerId: "r1", dueDate: NOW - DAY_MS }),
					pendingInvoice({ retailerId: "r2", dueDate: NOW - DAY_MS }),
				],
			}),
		);
		expect(report.pastDue.lapsedCustomer.monthlyValueByCurrency).toEqual({
			MYR: 14_900,
			SGD: 5_900,
		});
	});

	test("a comped past_due row is surfaced separately, never as churn", () => {
		// The cron's trial path flips comped rows too, unlike the other two.
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				subscriptions: [sub({ status: "past_due", comped: true })],
			}),
		);
		expect(report.pastDue.compedExcluded).toBe(1);
		expect(report.pastDue.total).toBe(0);
		expect(report.pastDue.trialExpired.count).toBe(0);
	});

	test("the raw past_due count reconciles: pastDue === total + compedExcluded", () => {
		// The two figures deliberately differ (one includes comped rows, the other
		// doesn't). This pins the arithmetic that reconciles them, so a reader
		// seeing "past_due: 3" and two buckets isn't looking at a bug.
		const report = reduceBusinessReport(
			input({
				retailers: [
					retailer({ id: "r1", slug: "a", userId: "u1" }),
					retailer({ id: "r2", slug: "b", userId: "u2" }),
					retailer({ id: "r3", slug: "c", userId: "u3" }),
				],
				subscriptions: [
					sub({ retailerId: "r1", status: "past_due" }),
					sub({ retailerId: "r2", status: "past_due" }),
					sub({ retailerId: "r3", status: "past_due", comped: true }),
				],
			}),
		);
		expect(report.subscriptions.pastDue).toBe(3);
		expect(report.pastDue.total).toBe(2);
		expect(report.pastDue.compedExcluded).toBe(1);
		expect(report.pastDue.total + report.pastDue.compedExcluded).toBe(
			report.subscriptions.pastDue,
		);
	});

	test("lapsedThisWeek respects the window, inclusive start / exclusive end", () => {
		const build = (updatedAt: number) =>
			reduceBusinessReport(
				input({
					retailers: [retailer()],
					subscriptions: [sub({ status: "past_due", updatedAt })],
					paidInvoices: [paidInvoice()],
					pendingInvoices: [pendingInvoice({ dueDate: NOW - DAY_MS })],
				}),
			).pastDue.lapsedThisWeek;

		expect(build(WEEK_START)).toBe(1);
		expect(build(WEEK_END_EXCLUSIVE - 1)).toBe(1);
		expect(build(WEEK_END_EXCLUSIVE)).toBe(0);
		expect(build(WEEK_START - DAY_MS)).toBe(0);
	});

	test("only lapsed customers count toward lapsedThisWeek", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				subscriptions: [
					sub({ status: "past_due", updatedAt: WEEK_START + DAY_MS }),
				],
				paidInvoices: [paidInvoice()],
				// No pending invoice → awaiting_invoice, not churn.
			}),
		);
		expect(report.pastDue.awaitingInvoice.count).toBe(1);
		expect(report.pastDue.lapsedThisWeek).toBe(0);
	});

	test("caps how many slugs a bucket names", () => {
		const n = MAX_SLUGS_PER_BUCKET + 5;
		const report = reduceBusinessReport(
			input({
				retailers: Array.from({ length: n }, (_, i) =>
					retailer({ id: `r${i}`, slug: `store-${i}`, userId: `u${i}` }),
				),
				subscriptions: Array.from({ length: n }, (_, i) =>
					sub({ retailerId: `r${i}`, status: "past_due" }),
				),
			}),
		);
		expect(report.pastDue.total).toBe(n);
		expect(report.pastDue.trialExpired.slugs).toHaveLength(
			MAX_SLUGS_PER_BUCKET,
		);
	});
});

// --- counts, signups, founding --------------------------------------------

describe("reduceBusinessReport — counts, signups, founding", () => {
	test("counts every status, and reports cancelled as a structural zero", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [
					retailer({ id: "r1", userId: "u1" }),
					retailer({ id: "r2", userId: "u2" }),
					retailer({ id: "r3", userId: "u3" }),
				],
				subscriptions: [
					sub({ retailerId: "r1", status: "trialing" }),
					sub({ retailerId: "r2", status: "active" }),
					sub({ retailerId: "r3", status: "past_due" }),
				],
			}),
		);
		expect(report.subscriptions).toEqual({
			trialing: 1,
			active: 1,
			pastDue: 1,
			cancelled: 0,
			comped: 0,
		});
	});

	test("signups respect the window, inclusive start / exclusive end", () => {
		const build = (createdAt: number) =>
			reduceBusinessReport(input({ retailers: [retailer({ createdAt })] }))
				.signupsThisWeek;

		expect(build(WEEK_START)).toBe(1);
		expect(build(WEEK_END_EXCLUSIVE - 1)).toBe(1);
		expect(build(WEEK_END_EXCLUSIVE)).toBe(0);
		expect(build(WEEK_START - 1)).toBe(0);
	});

	test("founding remaining is derived and never negative", () => {
		expect(
			reduceBusinessReport(input({ founding: { reserved: 4, paid: 2 } }))
				.founding,
		).toEqual({ reserved: 4, remaining: 6, paid: 2 });
		expect(
			reduceBusinessReport(input({ founding: { reserved: 12, paid: 9 } }))
				.founding.remaining,
		).toBe(0);
	});
});

// --- orders ----------------------------------------------------------------

describe("reduceBusinessReport — order volume", () => {
	test("excludes pending and cancelled, matching the Insights convention", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				orders: [
					order({ status: "confirmed", total: 1_000 }),
					order({ status: "packed", total: 2_000 }),
					order({ status: "shipped", total: 3_000 }),
					order({ status: "delivered", total: 4_000 }),
					order({ status: "pending", total: 99_000 }),
					order({ status: "cancelled", total: 99_000 }),
				],
			}),
		);
		expect(report.orders.count).toBe(4);
		expect(report.orders.gmv).toBe(10_000);
	});

	test("respects the window, inclusive start / exclusive end", () => {
		const report = reduceBusinessReport(
			input({
				retailers: [retailer()],
				orders: [
					order({ createdAt: WEEK_START, total: 1_000 }),
					order({ createdAt: WEEK_END_EXCLUSIVE, total: 99_000 }),
					order({ createdAt: WEEK_START - 1, total: 99_000 }),
				],
			}),
		);
		expect(report.orders.count).toBe(1);
		expect(report.orders.gmv).toBe(1_000);
	});

	test("capped propagates with the cap, while counts still reflect the scan", () => {
		const report = reduceBusinessReport(
			input({ retailers: [retailer()], orders: [order()], ordersCapped: true }),
		);
		expect(report.orders.capped).toBe(true);
		expect(report.orders.scanCap).toBe(BUSINESS_REPORT_ORDER_SCAN_CAP);
		expect(report.orders.count).toBe(1);
	});
});

// --- exclusions ------------------------------------------------------------

describe("exclusions", () => {
	test("an admin-owned store drops out of EVERY figure at once", () => {
		const report = reduceBusinessReport(
			input({
				adminUserIds: ["admin_1"],
				retailers: [
					retailer({
						id: "r1",
						slug: "arifs-test",
						userId: "admin_1",
						createdAt: WEEK_START + DAY_MS,
					}),
				],
				subscriptions: [sub({ retailerId: "r1", status: "active" })],
				paidInvoices: [paidInvoice({ retailerId: "r1" })],
				orders: [order({ retailerId: "r1" })],
			}),
		);
		expect(report.signupsThisWeek).toBe(0);
		expect(report.subscriptions.active).toBe(0);
		expect(report.mrr.byCurrency).toEqual({});
		expect(report.mrr.activeWithoutPaidInvoice).toBe(0);
		expect(report.orders.count).toBe(0);
		expect(report.orders.gmv).toBe(0);
		expect(report.excluded).toEqual({
			retailerCount: 1,
			slugs: ["arifs-test"],
		});
	});

	test("an internal email fragment excludes even a non-admin owner", () => {
		expect(
			isExcludedRetailer(
				retailer({ notifyEmail: "matrep88+test@gmail.com" }),
				[],
			),
		).toBe(true);
	});

	test("matching is case-insensitive", () => {
		expect(
			isExcludedRetailer(retailer({ notifyEmail: "Kristofer@Example.com" }), []),
		).toBe(true);
	});

	test("a retailer with NO notifyEmail is included", () => {
		// notifyEmail is optional and independent of the Clerk auth email —
		// excluding unset rows would drop real paying stores from MRR and GMV.
		expect(isExcludedRetailer(retailer({ notifyEmail: undefined }), [])).toBe(
			false,
		);
	});
});

// --- endpoint secret -------------------------------------------------------

describe("reportSecretMatches", () => {
	test("accepts the correct secret", async () => {
		expect(await reportSecretMatches("s3cret-value", "s3cret-value")).toBe(true);
	});

	test("rejects a wrong secret of the same length", async () => {
		expect(await reportSecretMatches("s3cret-valuX", "s3cret-value")).toBe(
			false,
		);
	});

	test("rejects a wrong secret of a different length", async () => {
		// Proves the hash-first design: raw lengths never short-circuit.
		expect(await reportSecretMatches("short", "a-much-longer-secret")).toBe(
			false,
		);
	});

	test("rejects a missing header or an unset expected secret", async () => {
		expect(await reportSecretMatches(null, "s3cret")).toBe(false);
		expect(await reportSecretMatches(undefined, "s3cret")).toBe(false);
		expect(await reportSecretMatches("s3cret", "")).toBe(false);
	});
});
