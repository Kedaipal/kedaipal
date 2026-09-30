import { describe, expect, test } from "vitest";
import type { MarketplaceStoreCard } from "../../convex/marketplace";
import { cardOpenStatus, filterStores, partitionStores } from "./marketplace";

/** Tue 16 Jan 2024 10:00 MYT (UTC+8). */
const TUE_10AM = Date.UTC(2024, 0, 16, 2, 0, 0);

function card(overrides: Partial<MarketplaceStoreCard>): MarketplaceStoreCard {
	return {
		slug: "kedai-x",
		storeName: "Kedai X",
		country: "MY",
		offersDelivery: true,
		sponsored: false,
		orderingPaused: false,
		createdAt: TUE_10AM - 90 * 24 * 60 * 60 * 1000,
		...overrides,
	};
}

/** Open 9:00–18:00 every day. */
const NINE_TO_SIX = Array.from({ length: 7 }, () => ({
	open: 9 * 60,
	close: 18 * 60,
}));

describe("cardOpenStatus", () => {
	test("a 24/7 store (no hours) is simply open", () => {
		expect(cardOpenStatus(card({}), TUE_10AM)).toEqual({
			open: true,
			label: "Open now",
		});
	});

	test("inside the window: Open now; before it: opens at the time, no day suffix", () => {
		expect(
			cardOpenStatus(card({ openingHours: NINE_TO_SIX }), TUE_10AM).open,
		).toBe(true);
		const at7am = TUE_10AM - 3 * 60 * 60 * 1000;
		const status = cardOpenStatus(card({ openingHours: NINE_TO_SIX }), at7am);
		expect(status.open).toBe(false);
		expect(status.label).toBe("Closed · opens 9:00 AM");
	});

	test("after close it names tomorrow", () => {
		const at8pm = TUE_10AM + 10 * 60 * 60 * 1000;
		expect(
			cardOpenStatus(card({ openingHours: NINE_TO_SIX }), at8pm).label,
		).toBe("Closed · opens 9:00 AM tomorrow");
	});

	test("a closed date today shuts even a 24/7 store", () => {
		const todayMidnightMyt = Date.UTC(2024, 0, 15, 16, 0, 0);
		const status = cardOpenStatus(
			card({
				closedDates: [
					{ startDate: todayMidnightMyt, endDate: todayMidnightMyt },
				],
			}),
			TUE_10AM,
		);
		expect(status.open).toBe(false);
		expect(status.label).toContain("Closed");
	});

	test("Off-Season Hold outranks the clock — browse only, never 'Open now'", () => {
		expect(cardOpenStatus(card({ orderingPaused: true }), TUE_10AM)).toEqual({
			open: false,
			label: "On a break — browse only",
		});
	});
});

describe("filterStores", () => {
	const my = card({ slug: "my-store", storeName: "Kek Sayang" });
	const sg = card({ slug: "sg-store", country: "SG" });
	const noDelivery = card({ slug: "pickup-only", offersDelivery: false });
	const fresh = card({
		slug: "fresh",
		createdAt: TUE_10AM - 24 * 60 * 60 * 1000,
	});
	const paused = card({ slug: "paused", orderingPaused: true });
	const all = [my, sg, noDelivery, fresh, paused];

	test("region always applies — MY and SG never blend", () => {
		const slugs = filterStores(all, {
			region: "MY",
			chip: "all",
			search: "",
			now: TUE_10AM,
		}).map((c) => c.slug);
		expect(slugs).not.toContain("sg-store");
		expect(
			filterStores(all, {
				region: "SG",
				chip: "all",
				search: "",
				now: TUE_10AM,
			}).map((c) => c.slug),
		).toEqual(["sg-store"]);
	});

	test("search matches name, description and area, case-insensitively", () => {
		const withDesc = card({ slug: "desc", storeDescription: "Frozen pau" });
		const withArea = card({ slug: "area", storeArea: "Ampang, KL" });
		const pool = [my, withDesc, withArea];
		const search = (q: string) =>
			filterStores(pool, {
				region: "MY",
				chip: "all",
				search: q,
				now: TUE_10AM,
			}).map((c) => c.slug);
		expect(search("kek say")).toEqual(["my-store"]);
		expect(search("FROZEN")).toEqual(["desc"]);
		expect(search("ampang")).toEqual(["area"]);
		expect(search("nothing-matches")).toEqual([]);
	});

	test("chips: open excludes paused, new keeps the window, delivers reads the flag", () => {
		const open = filterStores(all, {
			region: "MY",
			chip: "open",
			search: "",
			now: TUE_10AM,
		}).map((c) => c.slug);
		expect(open).not.toContain("paused");
		expect(
			filterStores(all, {
				region: "MY",
				chip: "new",
				search: "",
				now: TUE_10AM,
			}).map((c) => c.slug),
		).toEqual(["fresh"]);
		expect(
			filterStores(all, {
				region: "MY",
				chip: "delivers",
				search: "",
				now: TUE_10AM,
			}).map((c) => c.slug),
		).not.toContain("pickup-only");
	});
});

describe("partitionStores", () => {
	test("founding shelf reads in rank order; sponsored keeps list order", () => {
		const f3 = card({
			slug: "f3",
			isFoundingMember: true,
			foundingMemberRank: 3,
		});
		const f1 = card({
			slug: "f1",
			isFoundingMember: true,
			foundingMemberRank: 1,
		});
		const s = card({ slug: "s", sponsored: true });
		const { sponsored, founding } = partitionStores([f3, s, f1]);
		expect(sponsored.map((c) => c.slug)).toEqual(["s"]);
		expect(founding.map((c) => c.slug)).toEqual(["f1", "f3"]);
	});
});
