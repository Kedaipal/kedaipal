import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { SHOWCASE_THEMES } from "../../convex/lib/showcase";
import type { MarketplaceStoreCard } from "../../convex/marketplace";
import type { PublicShowcase } from "../../convex/showcases";
import {
	dateRange,
	joinShowcaseMembers,
	matchShowcases,
	PILE_FAN_MAX,
	resolveShowcaseFocus,
	SHOWCASE_THEME_CLASS,
	STAGE_GRID_TICKETS,
	showcaseDaysLeft,
	showcaseLook,
	showcasePath,
	showcasesForRegion,
	showcaseThemeClass,
	showcaseTimeFacts,
	splitStage,
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

describe("a look's palette can't be overridden by the base", () => {
	test("no variable is set by both kp-showcase and a look", () => {
		// Tailwind orders utilities by declaration count, not name, so a
		// variable set in both is won by whichever sorts later. "No tint"
		// carries more declarations than the base, sorted first, and rendered
		// with Campfire's green under a black-and-white cover.
		const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
		const varsOf = (name: string) => {
			const block = new RegExp(`@utility ${name} \\{([^}]*)\\}`).exec(css);
			if (!block) throw new Error(`missing @utility ${name}`);
			return new Set(
				[...block[1].matchAll(/(--sc-[a-z-]+)\s*:/g)].map((m) => m[1]),
			);
		};
		const base = varsOf("kp-showcase");
		for (const theme of SHOWCASE_THEMES) {
			const look = varsOf(`kp-showcase-${theme}`);
			expect(
				[...look].filter((v) => base.has(v)),
				theme,
			).toEqual([]);
		}
	});
});

describe("small authors", () => {
	test("showcasePath is the booth-QR link", () => {
		expect(showcasePath("campfest-2026")).toBe(
			"/stores?showcase=campfest-2026",
		);
	});
});

describe("showcaseDaysLeft — the one count of how long is left", () => {
	test("calendar days in MYT, not 24-hour blocks", () => {
		// 03:00 MYT on Thu 15 Oct; ends 11:22 MYT on Fri 16 Oct — 32 hours
		// away, so 24-hour blocks rounded up said "2 days" while the buyer chip
		// said "Ends tomorrow".
		const thu3am = Date.UTC(2026, 9, 14, 19, 0);
		const fri1122 = Date.UTC(2026, 9, 16, 3, 22);
		expect(showcaseDaysLeft(fri1122, thu3am)).toBe(1);
		expect(showcaseTimeFacts({ endsAt: fri1122 }, thu3am).live).toBe(
			"Ends tomorrow",
		);
	});
	test("an end at midnight belongs to the day before", () => {
		expect(showcaseDaysLeft(myt(2026, 10, 18), NOW)).toBe(0);
		expect(showcaseDaysLeft(myt(2026, 10, 19), NOW)).toBe(1);
	});
});

describe("showcaseLook — every surface wears the same look", () => {
	test("a curated look is its class alone", () => {
		expect(showcaseLook({ theme: "ocean" })).toEqual({
			className: "kp-showcase kp-showcase-ocean",
			style: undefined,
		});
	});
	test("custom carries its palette inline; a colour on another look is ignored", () => {
		const custom = showcaseLook({ theme: "custom", customColor: "#ff00aa" });
		expect(custom.className).toBe("kp-showcase kp-showcase-custom");
		expect(custom.style).toMatchObject({
			"--sc-a": expect.stringMatching(/^oklch\(/),
			"--sc-accent": expect.stringMatching(/^oklch\(/),
		});
		expect(
			showcaseLook({ theme: "festive", customColor: "#ff00aa" }).style,
		).toBeUndefined();
	});
});

describe("resolveShowcaseFocus — a booth link opens its showcase whatever the visitor's region", () => {
	const campfestMy = showcase({ slug: "campfest-2026", country: "MY" });
	test("an SG visitor on a MY showcase link sees MY for this visit — not 'missing'", () => {
		// The PR review: a roaming SG phone scanned the Campfest QR and read
		// "That showcase isn't on right now" over the SG directory.
		expect(resolveShowcaseFocus([campfestMy], "campfest-2026", "SG")).toEqual({
			viewRegion: "MY",
			overridden: true,
			missing: false,
		});
	});
	test("same region: nothing overridden", () => {
		expect(resolveShowcaseFocus([campfestMy], "campfest-2026", "MY")).toEqual({
			viewRegion: "MY",
			overridden: false,
			missing: false,
		});
	});
	test("missing only when no live showcase has the slug", () => {
		expect(resolveShowcaseFocus([campfestMy], "raya-2025", "SG")).toEqual({
			viewRegion: "SG",
			overridden: false,
			missing: true,
		});
	});
	test("no link, or showcases still loading: the visitor's own region, never 'missing'", () => {
		expect(resolveShowcaseFocus([campfestMy], undefined, "SG").viewRegion).toBe(
			"SG",
		);
		expect(resolveShowcaseFocus(undefined, "campfest-2026", "SG")).toEqual({
			viewRegion: "SG",
			overridden: false,
			missing: false,
		});
	});
});

describe("matchShowcases — a refined /stores keeps each store inside its showcase", () => {
	const bearcamp = card("bearcamp", { storeName: "Bearcamp Tent Wash" });
	const kopi = card("kopi", { storeName: "Kopi Hutan", offersDelivery: false });
	const rimba = card("rimba", { storeName: "Rimba Gear" });
	const campfest = {
		showcase: showcase({ slug: "campfest-2026" }),
		tickets: [
			{ card: bearcamp, label: "Booth A12" },
			{ card: kopi, label: "Booth B4" },
			{ card: rimba },
		],
	};
	const bazaar = {
		showcase: showcase({ slug: "raya-bazaar", title: "Raya Bazaar" }),
		tickets: [{ card: kopi, label: "Lot 7" }, { card: rimba }],
	};
	const all = { chip: "all" as const, now: NOW };

	test("a name search keeps only the matching tickets, and counts the whole showcase", () => {
		const { matches, slugs } = matchShowcases([campfest], {
			...all,
			search: "bearcamp",
		});
		expect(matches).toHaveLength(1);
		expect(matches[0].tickets.map((t) => t.card.slug)).toEqual(["bearcamp"]);
		expect(matches[0].total).toBe(3);
		expect([...slugs]).toEqual(["bearcamp"]);
	});

	test("a showcase with no matching store is not shown at all", () => {
		const { matches } = matchShowcases([campfest, bazaar], {
			...all,
			search: "bearcamp",
		});
		expect(matches.map((m) => m.showcase.slug)).toEqual(["campfest-2026"]);
	});

	test("the booth label is searchable — only the ticket prints it", () => {
		const { matches, slugs } = matchShowcases([campfest, bazaar], {
			...all,
			search: "a12",
		});
		expect(matches.map((m) => m.showcase.slug)).toEqual(["campfest-2026"]);
		expect([...slugs]).toEqual(["bearcamp"]);
	});

	test("a store in two showcases matches in BOTH — each ticket carries its own booth", () => {
		const { matches, slugs } = matchShowcases([campfest, bazaar], {
			...all,
			search: "kopi",
		});
		expect(matches.map((m) => [m.showcase.slug, m.tickets[0].label])).toEqual([
			["campfest-2026", "Booth B4"],
			["raya-bazaar", "Lot 7"],
		]);
		expect([...slugs]).toEqual(["kopi"]);
	});

	test("a chip applies inside showcases exactly as it does to the plain list", () => {
		const { matches } = matchShowcases([campfest, bazaar], {
			chip: "delivers",
			search: "",
			now: NOW,
		});
		expect(matches.map((m) => m.tickets.map((t) => t.card.slug))).toEqual([
			["bearcamp", "rimba"],
			["rimba"],
		]);
	});

	test("the focused showcase leads; the rest keep admin order", () => {
		const { matches } = matchShowcases(
			[campfest, bazaar],
			{ ...all, search: "rimba" },
			"raya-bazaar",
		);
		expect(matches.map((m) => m.showcase.slug)).toEqual([
			"raya-bazaar",
			"campfest-2026",
		]);
	});

	test("nothing matches anywhere: no showcases, nothing for the plain list to leave out", () => {
		const { matches, slugs } = matchShowcases([campfest, bazaar], {
			...all,
			search: "durian",
		});
		expect(matches).toEqual([]);
		expect(slugs.size).toBe(0);
	});
});
