// The admin seller directory's view-model (z8r3fdh37c): what "expires" reads
// as per state, why a status is what it is, the chip buckets, the sorts, the
// search, the Copy-summary text and the CSV — all pure, all pinned here so the
// table, cards, sheet and export can't drift apart.
import { describe, expect, it } from "vitest";
import type { AdminSellerRow } from "../../convex/admin";
import {
	countSellerBuckets,
	daysFromNow,
	describeDays,
	filterSellers,
	formatDeadline,
	isSellerFilter,
	isSellerSort,
	matchesSellerSearch,
	SELLER_FILTERS,
	sellerBucket,
	sellerExpiry,
	sellerPlanLabel,
	sellerRail,
	sellerReason,
	sellerSummaryText,
	sellersToCsv,
	sortSellers,
} from "./admin-seller-view";
import { formatShortDate } from "./format";

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now": 22 Sep 2026, noon local.
const NOW = new Date(2026, 8, 22, 12).getTime();
const at = (days: number) => NOW + days * DAY;

function row(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r1" as AdminSellerRow["_id"],
		storeName: "Bearcamp Malaysia",
		slug: "bearcamp-malaysia",
		ownerUserId: "u1",
		ownerIsAdmin: false,
		isFoundingMember: false,
		comped: false,
		createdAt: at(-180),
		purging: false,
		country: "MY",
		currency: "MYR",
		...overrides,
	};
}

describe("sellerBucket / counts", () => {
	it("admin and comped outrank the raw status; no subscription is its own bucket", () => {
		expect(
			sellerBucket(row({ ownerIsAdmin: true, subscriptionStatus: "past_due" })),
		).toBe("admin");
		expect(
			sellerBucket(row({ comped: true, subscriptionStatus: "active" })),
		).toBe("comped");
		expect(sellerBucket(row({ subscriptionStatus: "on_hold" }))).toBe(
			"on_hold",
		);
		expect(sellerBucket(row())).toBe("none");
	});

	it("counts every bucket plus All, and Past due sits first after All", () => {
		const counts = countSellerBuckets([
			row({ subscriptionStatus: "past_due" }),
			row({ subscriptionStatus: "past_due" }),
			row({ subscriptionStatus: "active" }),
			row({ ownerIsAdmin: true }),
		]);
		expect(counts.all).toBe(4);
		expect(counts.past_due).toBe(2);
		expect(counts.active).toBe(1);
		expect(counts.admin).toBe(1);
		expect(counts.trialing).toBe(0);
		expect(SELLER_FILTERS.slice(0, 2)).toEqual(["all", "past_due"]);
	});

	it("validates URL values", () => {
		expect(isSellerFilter("past_due")).toBe(true);
		expect(isSellerFilter("bogus")).toBe(false);
		expect(isSellerSort("expiry")).toBe(true);
		expect(isSellerSort(42)).toBe(false);
	});
});

describe("formatDeadline", () => {
	it("drops the year inside the current year and keeps it across the boundary", () => {
		expect(formatDeadline(at(22), NOW)).toBe(
			formatShortDate(at(22)).replace(/,? ?2026/, ""),
		);
		expect(formatDeadline(at(161), NOW)).toBe(formatShortDate(at(161)));
		expect(formatDeadline(at(161), NOW)).toContain("2027");
	});
});

describe("describeDays", () => {
	it("rounds to whole days and names what a past date means", () => {
		expect(daysFromNow(at(5.5), NOW)).toBe(6);
		expect(describeDays(at(6), NOW)).toBe("in 6 days");
		expect(describeDays(at(1), NOW)).toBe("in 1 day");
		expect(describeDays(NOW + 1000, NOW)).toBe("today");
		expect(describeDays(at(-19), NOW, "overdue")).toBe("19 days overdue");
		expect(describeDays(at(-21), NOW, "locked")).toBe("21 days locked");
		expect(describeDays(at(-52), NOW)).toBe("52 days ago");
	});
});

describe("sellerExpiry — the wording follows the state", () => {
	it("active renews at the period end; amber inside a week", () => {
		const far = sellerExpiry(
			row({ subscriptionStatus: "active", currentPeriodEnd: at(22) }),
			NOW,
		);
		expect(far).toMatchObject({
			headline: `Renews ${formatDeadline(at(22), NOW)}`,
			detail: "in 22 days",
			tone: "muted",
			at: at(22),
		});
		const soon = sellerExpiry(
			row({ subscriptionStatus: "active", currentPeriodEnd: at(3) }),
			NOW,
		);
		expect(soon.tone).toBe("warn");
	});

	it("trialing ends at the backstop until the first invoice exists, then the invoice's due date is the deadline", () => {
		const free = sellerExpiry(
			row({ subscriptionStatus: "trialing", trialEndsAt: at(6) }),
			NOW,
		);
		expect(free).toMatchObject({
			headline: `Trial ends ${formatDeadline(at(6), NOW)}`,
			detail: "in 6 days",
			tone: "warn",
		});
		const billed = sellerExpiry(
			row({
				subscriptionStatus: "trialing",
				trialEndsAt: at(-2),
				freePeriodEndedAt: at(-3),
				pendingInvoice: {
					invoiceNumber: "KP-0150",
					dueDate: at(4),
					total: 9900,
					currency: "MYR",
					hasPayNowLink: true,
				},
			}),
			NOW,
		);
		expect(billed).toMatchObject({
			headline: `Invoice due ${formatDeadline(at(4), NOW)}`,
			detail: "in 4 days",
			tone: "warn",
			at: at(4),
		});
	});

	it("past due: the open bill outranks the comp-off explanation, and each says why in days", () => {
		const bill = sellerExpiry(
			row({
				subscriptionStatus: "past_due",
				compEnded: { at: at(-30) },
				pendingInvoice: {
					invoiceNumber: "KP-0142",
					dueDate: at(-19),
					total: 9900,
					currency: "MYR",
					hasPayNowLink: false,
				},
			}),
			NOW,
		);
		expect(bill).toMatchObject({
			headline: `Was due ${formatDeadline(at(-19), NOW)}`,
			detail: "19 days overdue",
			tone: "danger",
		});
		const comp = sellerExpiry(
			row({ subscriptionStatus: "past_due", compEnded: { at: at(-21) } }),
			NOW,
		);
		expect(comp).toMatchObject({
			headline: `Comp off ${formatDeadline(at(-21), NOW)}`,
			detail: "21 days locked",
			tone: "danger",
		});
		expect(
			sellerExpiry(row({ subscriptionStatus: "past_due" }), NOW),
		).toMatchObject({
			headline: "Past due",
			detail: "No open invoice",
			tone: "danger",
		});
	});

	it("on hold renews the hold; cancelled says when it ended; comped and admin have no date", () => {
		expect(
			sellerExpiry(
				row({
					subscriptionStatus: "on_hold",
					currentPeriodEnd: at(9),
					heldAt: at(-35),
				}),
				NOW,
			),
		).toMatchObject({
			headline: `Hold renews ${formatDeadline(at(9), NOW)}`,
			detail: "in 9 days",
		});
		expect(
			sellerExpiry(
				row({ subscriptionStatus: "cancelled", cancelledAt: at(-52) }),
				NOW,
			),
		).toMatchObject({
			headline: `Ended ${formatDeadline(at(-52), NOW)}`,
			detail: "52 days ago",
			tone: "muted",
		});
		expect(
			sellerExpiry(
				row({ comped: true, comp: { kind: "sponsor", grantedAt: at(-80) } }),
				NOW,
			),
		).toMatchObject({
			headline: "No expiry",
			detail: `Comped since ${formatShortDate(at(-80))}`,
		});
		expect(sellerExpiry(row({ ownerIsAdmin: true }), NOW)).toMatchObject({
			headline: "—",
			detail: "Never billed",
		});
		expect(sellerExpiry(row(), NOW)).toMatchObject({
			headline: "—",
			detail: "No subscription",
		});
		expect(sellerExpiry(row({ ownerIsAdmin: true }), NOW).at).toBeUndefined();
	});
});

describe("sellerReason / plan / rail", () => {
	it("names the open invoice, the comp-off, a failing card, or the hold — and nothing when the pill says it all", () => {
		expect(
			sellerReason(
				row({
					subscriptionStatus: "past_due",
					pendingInvoice: {
						invoiceNumber: "KP-0142",
						dueDate: at(-19),
						total: 1,
						currency: "MYR",
						hasPayNowLink: false,
					},
				}),
			),
		).toBe("KP-0142 unpaid");
		expect(
			sellerReason(
				row({ subscriptionStatus: "past_due", compEnded: { at: at(-21) } }),
			),
		).toBe("Comp upgrade turned off");
		expect(
			sellerReason(
				row({
					subscriptionStatus: "past_due",
					autoRenew: {
						method: "card",
						attachedAt: 0,
						failedAttempts: 2,
						nextRetryAt: at(2),
					},
				}),
			),
		).toBe(`Auto-renew failed ×2 · retry ${formatShortDate(at(2))}`);
		expect(
			sellerReason(row({ subscriptionStatus: "on_hold", heldAt: at(-35) })),
		).toBe(`Off-season since ${formatShortDate(at(-35))}`);
		expect(sellerReason(row({ subscriptionStatus: "active" }))).toBeUndefined();
		expect(
			sellerReason(row({ comped: true, subscriptionStatus: "past_due" })),
		).toBeUndefined();
	});

	it("plan and rail read as cycle · how money arrives", () => {
		expect(sellerPlanLabel(row({ plan: "pro" }))).toBe("Pro");
		expect(sellerPlanLabel(row({ ownerIsAdmin: true, plan: "pro" }))).toBe("—");
		expect(
			sellerRail(
				row({
					subscriptionStatus: "active",
					billingCycle: "monthly",
					autoRenew: {
						method: "card",
						methodLabel: "Visa ·· 4242",
						attachedAt: 0,
					},
				}),
			),
		).toBe("Monthly · auto-renew Visa ·· 4242");
		expect(
			sellerRail(
				row({
					subscriptionStatus: "active",
					billingCycle: "annual",
					pendingInvoice: {
						invoiceNumber: "x",
						dueDate: 0,
						total: 1,
						currency: "MYR",
						hasPayNowLink: true,
					},
				}),
			),
		).toBe("Annual · Pay-now link");
		expect(
			sellerRail(
				row({ subscriptionStatus: "trialing", billingCycle: "monthly" }),
			),
		).toBe("Monthly · free period");
		expect(
			sellerRail(
				row({ subscriptionStatus: "on_hold", billingCycle: "monthly" }),
			),
		).toBe("Monthly · held");
		expect(
			sellerRail(
				row({ subscriptionStatus: "active", billingCycle: "monthly" }),
			),
		).toBe("Monthly · manual billing");
		expect(
			sellerRail(
				row({
					comped: true,
					comp: { kind: "sponsor", label: "Maybank SME", grantedAt: 0 },
				}),
			),
		).toBe("Sponsor · Maybank SME");
		expect(sellerRail(row({ ownerIsAdmin: true }))).toBe("Admin store");
	});
});

describe("search + filter", () => {
	const rows = [
		row({
			storeName: "Bearcamp Malaysia",
			slug: "bearcamp-malaysia",
			ownerEmail: "hello@bearcamp.example",
			waPhone: "60123456789",
			subscriptionStatus: "active",
		}),
		row({
			_id: "r2" as AdminSellerRow["_id"],
			storeName: "Kuih Mak Su",
			slug: "kuih-mak-su",
			notifyWaPhone: "60187654321",
			subscriptionStatus: "cancelled",
		}),
	];

	it("matches name, slug, email, and phone digits however typed", () => {
		expect(matchesSellerSearch(rows[0], "BEAR")).toBe(true);
		expect(matchesSellerSearch(rows[0], "bearcamp-mal")).toBe(true);
		expect(matchesSellerSearch(rows[0], "hello@")).toBe(true);
		expect(matchesSellerSearch(rows[0], "+60 12-345")).toBe(true);
		expect(matchesSellerSearch(rows[1], "018-7")).toBe(true); // local form, alerts number
		expect(matchesSellerSearch(rows[1], "6018")).toBe(true);
		expect(matchesSellerSearch(rows[1], "0199")).toBe(false);
		expect(matchesSellerSearch(rows[0], "12")).toBe(false); // too short to match a phone
		expect(matchesSellerSearch(rows[0], "   ")).toBe(true);
	});

	it("filters by bucket and search together", () => {
		expect(filterSellers(rows, "all", "").map((r) => r.slug)).toEqual([
			"bearcamp-malaysia",
			"kuih-mak-su",
		]);
		expect(filterSellers(rows, "cancelled", "").map((r) => r.slug)).toEqual([
			"kuih-mak-su",
		]);
		expect(filterSellers(rows, "active", "kuih")).toEqual([]);
	});
});

describe("sortSellers", () => {
	const a = row({
		_id: "a" as AdminSellerRow["_id"],
		storeName: "Zed",
		foundingMemberRank: 2,
		createdAt: at(-10),
		subscriptionStatus: "active",
		currentPeriodEnd: at(30),
	});
	const b = row({
		_id: "b" as AdminSellerRow["_id"],
		storeName: "Alpha",
		createdAt: at(-1),
		subscriptionStatus: "trialing",
		trialEndsAt: at(3),
	});
	const c = row({
		_id: "c" as AdminSellerRow["_id"],
		storeName: "Mid",
		foundingMemberRank: 1,
		createdAt: at(-50),
		ownerIsAdmin: true,
	});

	it("founding rank first then newest; expiry soonest with dateless rows last; newest; name", () => {
		expect(
			sortSellers([a, b, c], "founding", NOW).map((r) => r.storeName),
		).toEqual(["Mid", "Zed", "Alpha"]);
		expect(
			sortSellers([a, b, c], "expiry", NOW).map((r) => r.storeName),
		).toEqual(["Alpha", "Zed", "Mid"]);
		expect(
			sortSellers([a, b, c], "newest", NOW).map((r) => r.storeName),
		).toEqual(["Alpha", "Zed", "Mid"]);
		expect(sortSellers([a, b, c], "name", NOW).map((r) => r.storeName)).toEqual(
			["Alpha", "Mid", "Zed"],
		);
	});

	it("never mutates the input", () => {
		const input = [a, b, c];
		sortSellers(input, "name", NOW);
		expect(input.map((r) => r.storeName)).toEqual(["Zed", "Alpha", "Mid"]);
	});
});

describe("sellerSummaryText + CSV", () => {
	const full = row({
		ownerEmail: "hello@bearcamp.example",
		waPhone: "60123456789",
		plan: "pro",
		billingCycle: "monthly",
		subscriptionStatus: "active",
		currentPeriodEnd: at(22),
		autoRenew: { method: "card", methodLabel: "Visa ·· 4242", attachedAt: 0 },
		foundingMemberRank: 1,
	});

	it("writes the block an admin pastes into WhatsApp, with absent facts named", () => {
		expect(sellerSummaryText(full, "https://kedaipal.com", NOW)).toBe(
			[
				"Bearcamp Malaysia — https://kedaipal.com/bearcamp-malaysia",
				"Email: hello@bearcamp.example",
				"WhatsApp: +60 12-345 6789",
				"Plan: Pro · Monthly · auto-renew Visa ·· 4242 · Active",
				`Renews ${formatDeadline(at(22), NOW)} · in 22 days`,
			].join("\n"),
		);
		expect(sellerSummaryText(row(), "https://kedaipal.com", NOW)).toContain(
			"Email: none on file",
		);
		expect(sellerSummaryText(row(), "https://kedaipal.com", NOW)).toContain(
			"WhatsApp: none on file",
		);
	});

	it("exports one row per seller with a header, phones as stored digits and dates sortable", () => {
		const csv = sellersToCsv([full], "https://kedaipal.com", NOW);
		const [header, line] = csv.split("\r\n");
		expect(header.split(",")).toContain("Store WhatsApp");
		expect(line).toContain(
			"Bearcamp Malaysia,bearcamp-malaysia,https://kedaipal.com/bearcamp-malaysia,Active,,Pro,",
		);
		expect(line).toContain("60123456789");
		expect(line).toMatch(/,\d{4}-\d{2}-\d{2},/);
	});
});
