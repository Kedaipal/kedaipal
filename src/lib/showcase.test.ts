import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { SHOWCASE_THEMES } from "../../convex/lib/showcase";
import type { MarketplaceStoreCard } from "../../convex/marketplace";
import type { PublicShowcase } from "../../convex/showcases";
import {
	dateRange,
	joinShowcaseMembers,
	PILE_FAN_MAX,
	SHOWCASE_THEME_CLASS,
	STAGE_GRID_TICKETS,
	showcasePath,
	showcasesForRegion,
	showcaseThemeClass,
	showcaseTimeFacts,
	splitStage,
	ticketPlace,
} from "./showcase";

/** Sat 17 Oct 2026 12:00 MYT. */
const NOW = Date.UTC(2026, 9, 17, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
/** MYT midnight of a date. */
const myt = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, -8);

function card(slug: string, extra: Partial<MarketplaceStoreCard> = {}) {
	return {
		slug,
		storeName: `Store ${slug}`,
		country: "MY",
		offersDelivery: true,
		sponsored: false,
		orderingPaused: false,
		createdAt: NOW - 90 * DAY,
		...extra,
	} satisfies MarketplaceStoreCard;
}

function showcase(extra: Partial<PublicShowcase> = {}): PublicShowcase {
	return {
		slug: "campfest-2026",
		title: "Malaysia Campfest 2026",
		country: "MY",
		theme: "campfire",
		members: [],
		...extra,
	};
}

describe("joinShowcaseMembers — admin order, directory truth", () => {
	test("keeps the showcase's order and drops a slug the directory doesn't carry", () => {
		const s = showcase({
			members: [
				{ slug: "b", label: "Booth 2" },
				{ slug: "gone" },
				{ slug: "a", coverImageUrl: "https://img/a.jpg" },
			],
		});
		const joined = joinShowcaseMembers(s, [card("a"), card("b")]);
		expect(joined.map((t) => t.card.slug)).toEqual(["b", "a"]);
		expect(joined[0].label).toBe("Booth 2");
		expect(joined[1].coverImageUrl).toBe("https://img/a.jpg");
	});
	test("regions never blend", () => {
		const list = [
			showcase({ country: "MY" }),
			showcase({ slug: "sg", country: "SG" }),
		];
		expect(showcasesForRegion(list, "SG").map((s) => s.slug)).toEqual(["sg"]);
	});
});

describe("splitStage — five on the grid, the rest in the pile, never a pile of one", () => {
	const tickets = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ card: card(`s${i}`) }));
	test("up to six tickets all stand on the grid", () => {
		expect(splitStage(tickets(STAGE_GRID_TICKETS + 1)).pile).toEqual([]);
	});
	test("seven: five stand, two pile", () => {
		const { shown, pile } = splitStage(tickets(7));
		expect(shown).toHaveLength(STAGE_GRID_TICKETS);
		expect(pile.map((t) => t.card.slug)).toEqual(["s5", "s6"]);
	});
	test("the fan cap is smaller than any sane pile would need", () => {
		expect(PILE_FAN_MAX).toBeLessThanOrEqual(STAGE_GRID_TICKETS);
	});
});

describe("showcaseTimeFacts — what the chip says", () => {
	test("no end date: happening now, with the start as the range", () => {
		expect(showcaseTimeFacts({ startsAt: myt(2026, 10, 16) }, NOW)).toEqual({
			live: "Happening now",
			range: "From 16 Oct",
		});
		expect(showcaseTimeFacts({}, NOW)).toEqual({ live: "Happening now" });
	});
	test("an end with no start prints no range — the chip already carries it", () => {
		expect(showcaseTimeFacts({ endsAt: myt(2026, 10, 22) }, NOW)).toEqual({
			live: "Until Wed",
		});
	});
	test("ends later today / tomorrow / this week / later", () => {
		// Ends at MYT midnight after today → "Ends today".
		expect(showcaseTimeFacts({ endsAt: myt(2026, 10, 18) }, NOW).live).toBe(
			"Ends today",
		);
		expect(showcaseTimeFacts({ endsAt: myt(2026, 10, 19) }, NOW).live).toBe(
			"Ends tomorrow",
		);
		// Ends Wed 21 Oct 23:59:59.999 → last day Wed.
		expect(showcaseTimeFacts({ endsAt: myt(2026, 10, 22) }, NOW).live).toBe(
			"Until Wed",
		);
		expect(showcaseTimeFacts({ endsAt: myt(2026, 11, 4) }, NOW).live).toBe(
			"Until 3 Nov",
		);
	});
	test("the end is exclusive: a midnight end names the day before", () => {
		expect(dateRange(myt(2026, 10, 16), myt(2026, 10, 19))).toBe("16–18 Oct");
	});
	test("ranges across a month, single day, and end-only", () => {
		expect(dateRange(myt(2026, 10, 30), myt(2026, 11, 4))).toBe(
			"30 Oct – 3 Nov",
		);
		expect(dateRange(myt(2026, 10, 18), myt(2026, 10, 19))).toBe("18 Oct");
		expect(dateRange(undefined, myt(2026, 10, 19))).toBe("Until 18 Oct");
		expect(dateRange(undefined, undefined)).toBeUndefined();
	});
});

describe("theme classes — Tailwind only emits what it can READ", () => {
	const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
	const source = readFileSync(resolve(__dirname, "showcase.ts"), "utf8");
	test.each(
		SHOWCASE_THEMES,
	)("%s: a utility in styles.css, spelled out in full in the source", (theme) => {
		expect(css).toContain(`@utility kp-showcase-${theme} {`);
		// The literal must appear in a scanned file; a runtime-assembled
		// `kp-showcase-${theme}` is never generated — every showcase rendered
		// as Campfire until the hands-on test caught it.
		expect(source).toContain(`"kp-showcase kp-showcase-${theme}"`);
		expect(showcaseThemeClass(theme)).toBe(SHOWCASE_THEME_CLASS[theme]);
	});
});

describe("small authors", () => {
	test("ticketPlace prefers the booth label over the store's area", () => {
		expect(ticketPlace({ card: card("a", { storeArea: "Ampang" }) })).toBe(
			"Ampang",
		);
		expect(
			ticketPlace({ card: card("a", { storeArea: "Ampang" }), label: "B4" }),
		).toBe("B4");
	});
	test("showcasePath is the booth-QR link", () => {
		expect(showcasePath("campfest-2026")).toBe(
			"/stores?showcase=campfest-2026",
		);
	});
});
