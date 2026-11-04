// The admin seller directory's filter language, shared by the paginated Convex
// query (server-side post-filter + counts) and the page (labels, URL guards).
// One author so the chip a row lands under on the server is the chip the page
// names — and so the search that finds a store on the server is the search the
// page describes in its placeholder.
import { describe, expect, it } from "vitest";
import {
	isSellerFilter,
	isSellerSort,
	matchesSellerSearch,
	parseSellerStatuses,
	passesAnySellerFilter,
	passesSellerFilter,
	SELLER_FILTER_GROUPS,
	SELLER_FILTERS,
	SELLER_SORTS,
	type SellerFacts,
	sellerBucket,
	sellerSelectionLabel,
	toggleSellerStatus,
} from "./adminSellerFilters";

const facts = (over: Partial<SellerFacts> = {}): SellerFacts => ({
	unclaimed: false,
	ownerIsAdmin: false,
	comped: false,
	subscriptionStatus: "active",
	enterpriseInterestAt: undefined,
	hasEnterpriseContract: false,
	availabilityState: "open",
	hasPaidInvoice: false,
	acquisitionSetBy: undefined,
	...over,
});

describe("sellerBucket on the narrow facts", () => {
	it("unclaimed outranks admin, admin outranks comped, comped outranks status", () => {
		expect(sellerBucket(facts({ unclaimed: true, ownerIsAdmin: true }))).toBe(
			"unclaimed",
		);
		expect(sellerBucket(facts({ ownerIsAdmin: true, comped: true }))).toBe(
			"admin",
		);
		expect(
			sellerBucket(facts({ comped: true, subscriptionStatus: "past_due" })),
		).toBe("comped");
		expect(sellerBucket(facts({ subscriptionStatus: undefined }))).toBe("none");
	});
});

describe("passesSellerFilter", () => {
	it("all passes everything", () => {
		expect(passesSellerFilter(facts(), "all")).toBe(true);
	});
	it("status buckets match on the bucket, not the raw status", () => {
		expect(
			passesSellerFilter(
				facts({ comped: true, subscriptionStatus: "active" }),
				"active",
			),
		).toBe(false);
		expect(passesSellerFilter(facts({ subscriptionStatus: "past_due" }), "past_due")).toBe(true);
	});
	it("wants_enterprise is an OPEN lead: stamped and no contract", () => {
		expect(
			passesSellerFilter(facts({ enterpriseInterestAt: 1 }), "wants_enterprise"),
		).toBe(true);
		expect(
			passesSellerFilter(
				facts({ enterpriseInterestAt: 1, hasEnterpriseContract: true }),
				"wants_enterprise",
			),
		).toBe(false);
	});
	it("unavailable is anything not open", () => {
		expect(passesSellerFilter(facts({ availabilityState: "paused" }), "unavailable")).toBe(true);
		expect(passesSellerFilter(facts(), "unavailable")).toBe(false);
	});
	it("untagged_payers needs a paid invoice, no admin owner and no admin-set channel", () => {
		expect(passesSellerFilter(facts({ hasPaidInvoice: true }), "untagged_payers")).toBe(true);
		expect(
			passesSellerFilter(
				facts({ hasPaidInvoice: true, acquisitionSetBy: "admin" }),
				"untagged_payers",
			),
		).toBe(false);
		expect(
			passesSellerFilter(
				facts({ hasPaidInvoice: true, ownerIsAdmin: true }),
				"untagged_payers",
			),
		).toBe(false);
	});
});

describe("matchesSellerSearch on retailer fields", () => {
	const fields = {
		storeName: "Kak Ros Kitchen",
		slug: "kak-ros-kitchen",
		emails: ["ros@kakros.my", "handover@vendor.my"],
		phones: ["60123456789", undefined],
	};
	it("matches a substring of name, slug or either email, case-insensitively", () => {
		expect(matchesSellerSearch(fields, "ros kit")).toBe(true);
		expect(matchesSellerSearch(fields, "-ros-")).toBe(true);
		expect(matchesSellerSearch(fields, "VENDOR.MY")).toBe(true);
		expect(matchesSellerSearch(fields, "nasi")).toBe(false);
	});
	it("matches three or more digits against the phone digits however typed", () => {
		expect(matchesSellerSearch(fields, "+60 12-345")).toBe(true);
		expect(matchesSellerSearch(fields, "12")).toBe(false);
	});
	it("an empty query matches everything", () => {
		expect(matchesSellerSearch(fields, "   ")).toBe(true);
	});
});

describe("the catalogue", () => {
	it("offers exactly the three index-backed sorts", () => {
		expect(SELLER_SORTS.map((s) => s.key)).toEqual(["founding", "newest", "name"]);
		expect(isSellerSort("expiry")).toBe(false);
		expect(isSellerSort("credits")).toBe(false);
		expect(isSellerSort("name")).toBe(true);
	});
	it("groups every non-all filter exactly once, action group first", () => {
		const grouped = SELLER_FILTER_GROUPS.flatMap((g) => g.filters);
		expect(grouped).toEqual(SELLER_FILTERS.filter((f) => f !== "all"));
		expect(SELLER_FILTER_GROUPS[0]?.filters[0]).toBe("past_due");
		expect(isSellerFilter("all")).toBe(true);
	});
});

// z8r3fdzn6r (2 Nov 2026): the statuses combine with OR. The rule lives here
// because the paginated query applies it server-side; the page re-exports it.
describe("statuses combine with OR", () => {
	const pastDueLead = facts({
		subscriptionStatus: "past_due",
		enterpriseInterestAt: 1,
	});
	const cancelled = facts({ subscriptionStatus: "cancelled" });
	const active = facts({ subscriptionStatus: "active" });

	it("an empty selection is All; otherwise a store passes when ANY picked status holds", () => {
		expect(passesAnySellerFilter(active, [])).toBe(true);
		expect(passesAnySellerFilter(active, ["past_due", "cancelled"])).toBe(false);
		expect(passesAnySellerFilter(cancelled, ["past_due", "cancelled"])).toBe(true);
		// In two picked statuses at once — still one answer, never a sum.
		expect(passesAnySellerFilter(pastDueLead, ["past_due", "wants_enterprise"])).toBe(true);
	});

	it("parses ?status= as a list, an older single value, or nothing", () => {
		expect(parseSellerStatuses(["cancelled", "past_due", "cancelled"])).toEqual(["past_due", "cancelled"]);
		expect(parseSellerStatuses("untagged_payers")).toEqual(["untagged_payers"]);
		expect(parseSellerStatuses(["all", "bogus", 3])).toBeUndefined();
		expect(parseSellerStatuses(undefined)).toBeUndefined();
	});

	it("toggles in row order; All clears; every offered status picked folds back to All", () => {
		expect(toggleSellerStatus([], "cancelled", SELLER_FILTERS)).toEqual(["cancelled"]);
		expect(toggleSellerStatus(["cancelled"], "past_due", SELLER_FILTERS)).toEqual(["past_due", "cancelled"]);
		expect(toggleSellerStatus(["past_due", "cancelled"], "past_due", SELLER_FILTERS)).toEqual(["cancelled"]);
		expect(toggleSellerStatus(["past_due"], "all", SELLER_FILTERS)).toEqual([]);
		expect(toggleSellerStatus(["past_due"], "active", ["all", "past_due", "active"])).toEqual([]);
	});

	it("names the selection the way the menu reads it", () => {
		expect(sellerSelectionLabel(["cancelled", "unclaimed"])).toBe("Unclaimed or Cancelled");
		expect(sellerSelectionLabel(["past_due", "unclaimed", "active"])).toBe("Past due, Unclaimed or Active");
		expect(sellerSelectionLabel([])).toBe("All sellers");
	});
});
