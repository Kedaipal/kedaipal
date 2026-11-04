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
	passesSellerFilter,
	SELLER_FILTER_GROUPS,
	SELLER_FILTERS,
	SELLER_SORTS,
	type SellerFacts,
	sellerBucket,
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
