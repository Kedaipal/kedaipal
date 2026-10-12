import { describe, expect, test } from "vitest";
import {
	bestSellerHeadline,
	comparisonSentence,
	creditPaceLine,
	customersHeadline,
	DEFAULT_HOME_PERIOD,
	deltaPercent,
	doneStepsSummary,
	HOME_INSIGHT_MIN_ORDERS,
	hasEnoughForInsights,
	heroAmount,
	insightThresholdLine,
	lapsedRegularsLine,
	notPaidYetLine,
	parseHomePeriod,
	periodDays,
	planAheadHeadline,
	shouldCollapseDoneSteps,
	staleUnpaidRow,
	TILE_TINT_MAX,
	TILE_TINT_MIN,
	tileTintPct,
	topSourceHeadline,
	zeroEarnedLine,
} from "./home-copy";

const MYR = "MYR";

/** `formatPrice` separates "RM" from the amount with a NON-BREAKING space (see
 * `NBSP` in src/lib/format.ts). Normalising here keeps the expected sentences
 * below readable as text instead of hiding a U+00A0 inside every literal. */
const sp = (s: string | null | undefined) => s?.replace(/\u00A0/g, " ") ?? s;

describe("parseHomePeriod", () => {
	test("accepts the three real windows", () => {
		expect(parseHomePeriod("today")).toBe("today");
		expect(parseHomePeriod("7d")).toBe("7d");
		expect(parseHomePeriod("30d")).toBe("30d");
	});

	test("a stale or hand-edited URL still opens a working page", () => {
		for (const junk of ["90d", "", null, undefined, 7, {}])
			expect(parseHomePeriod(junk)).toBe(DEFAULT_HOME_PERIOD);
	});
});

describe("periodDays", () => {
	test("spans match the chips", () => {
		expect(periodDays("today")).toBe(1);
		expect(periodDays("7d")).toBe(7);
		expect(periodDays("30d")).toBe(30);
	});
});

describe("comparisonSentence", () => {
	test("7 days names the money difference, not a percentage", () => {
		expect(
			sp(
				comparisonSentence({
					period: "7d",
					currency: MYR,
					earned: 486_000,
					previousEarned: 412_000,
				}),
			),
		).toBe("RM 740.00 more than the 7 days before");
	});

	test("a worse week says so plainly", () => {
		expect(
			sp(
				comparisonSentence({
					period: "7d",
					currency: MYR,
					earned: 412_000,
					previousEarned: 486_000,
				}),
			),
		).toBe("RM 740.00 less than the 7 days before");
	});

	test("a flat week is not dressed up as a change", () => {
		expect(
			comparisonSentence({
				period: "30d",
				currency: MYR,
				earned: 100_000,
				previousEarned: 100_000,
			}),
		).toBe("The same as the 30 days before");
	});

	test("TODAY compares to the same weekday, never to a full window", () => {
		// A partial day against a complete one is a falling arrow every morning.
		expect(
			sp(
				comparisonSentence({
					period: "today",
					currency: MYR,
					earned: 36_000,
					previousEarned: 48_000,
					lastWeekdayName: "Monday",
					lastWeekdayEarned: 41_000,
				}),
			),
		).toBe("Last Monday you closed at RM 410.00");
	});

	test("no previous window → no sentence, never a fabricated one", () => {
		expect(
			comparisonSentence({
				period: "7d",
				currency: MYR,
				earned: 1,
				previousEarned: null,
			}),
		).toBeNull();
		expect(
			comparisonSentence({
				period: "today",
				currency: MYR,
				earned: 1,
				previousEarned: null,
				lastWeekdayName: "Monday",
				lastWeekdayEarned: null,
			}),
		).toBeNull();
	});
});

describe("deltaPercent", () => {
	test("rounds the move against the previous window", () => {
		expect(
			deltaPercent({ period: "7d", earned: 118, previousEarned: 100 }),
		).toEqual({ pct: 18, up: true });
		expect(
			deltaPercent({ period: "30d", earned: 85, previousEarned: 100 }),
		).toEqual({ pct: 15, up: false });
	});

	test("TODAY never gets a pill", () => {
		expect(
			deltaPercent({ period: "today", earned: 500, previousEarned: 100 }),
		).toBeNull();
	});

	test("a zero base produces no percentage — +∞% is not a figure", () => {
		expect(
			deltaPercent({ period: "7d", earned: 500, previousEarned: 0 }),
		).toBeNull();
		expect(
			deltaPercent({ period: "7d", earned: 500, previousEarned: null }),
		).toBeNull();
	});

	test("a move that rounds to nothing shows nothing", () => {
		expect(
			deltaPercent({ period: "7d", earned: 1001, previousEarned: 1000 }),
		).toBeNull();
	});
});

describe("notPaidYetLine", () => {
	test("bounds itself to the window so it can't be read as To collect", () => {
		expect(
			sp(notPaidYetLine({ period: "7d", currency: MYR, uncollected: 92_000 })),
		).toBe("RM 920.00 of these sales is not paid yet");
		expect(
			sp(
				notPaidYetLine({ period: "today", currency: MYR, uncollected: 14_500 }),
			),
		).toBe("RM 145.00 of today's sales is not paid yet");
	});

	test("nothing outstanding says nothing", () => {
		expect(
			notPaidYetLine({ period: "7d", currency: MYR, uncollected: 0 }),
		).toBeNull();
	});
});

describe("bestSellerHeadline", () => {
	test("a finished window states the result", () => {
		expect(
			bestSellerHeadline({ period: "7d", name: "Kek Batik", sharePct: 31 }),
		).toBe("Kek Batik made 31% of your sales");
	});

	test("a live day says 'leading' — the day is not settled", () => {
		expect(
			bestSellerHeadline({
				period: "today",
				name: "Seri Muka",
				sharePct: 38.6,
			}),
		).toBe("Seri Muka is leading today with 39% of sales");
	});
});

describe("customersHeadline", () => {
	test("states the split as a sentence", () => {
		expect(customersHeadline({ period: "7d", returning: 27, total: 42 })).toBe(
			"27 of 42 customers had ordered before",
		);
		expect(customersHeadline({ period: "today", returning: 4, total: 5 })).toBe(
			"4 of 5 customers today have ordered before",
		);
	});

	test("an all-new window reads as a finding, not as '0 of 9'", () => {
		expect(customersHeadline({ period: "7d", returning: 0, total: 9 })).toBe(
			"All 9 customers are new",
		);
		expect(customersHeadline({ period: "today", returning: 0, total: 3 })).toBe(
			"All 3 of today's customers are new",
		);
	});

	test("no identified customers at all", () => {
		expect(customersHeadline({ period: "7d", returning: 0, total: 0 })).toBe(
			"No customers yet in this window",
		);
	});
});

describe("topSourceHeadline", () => {
	test("names the source with both figures", () => {
		expect(
			sp(
				topSourceHeadline({
					label: "Instagram",
					orders: 17,
					revenue: 142_000,
					currency: MYR,
				}),
			),
		).toBe("Instagram brought 17 orders (RM 1,420.00)");
	});

	test("one order is singular", () => {
		expect(
			sp(
				topSourceHeadline({
					label: "Poster QR",
					orders: 1,
					revenue: 8_500,
					currency: MYR,
				}),
			),
		).toBe("Poster QR brought 1 order (RM 85.00)");
	});
});

describe("planAheadHeadline", () => {
	const weekdayName = (start: number) =>
		({ 0: "Monday", 1: "Tuesday", 5: "Saturday" })[start] ?? `D${start}`;

	test("names the heaviest day", () => {
		expect(
			planAheadHeadline({
				days: [
					{ start: 0, count: 6 },
					{ start: 1, count: 4 },
					{ start: 5, count: 14 },
				],
				weekdayName,
			}),
		).toBe("Saturday is your heaviest day: 14 orders due");
	});

	test("a tie goes to the NEARER day — that deadline comes first", () => {
		expect(
			planAheadHeadline({
				days: [
					{ start: 1, count: 9 },
					{ start: 5, count: 9 },
				],
				weekdayName,
			}),
		).toBe("Tuesday is your heaviest day: 9 orders due");
	});

	test("today is named 'Today', not by its weekday", () => {
		expect(
			planAheadHeadline({
				days: [{ start: 0, count: 6 }],
				weekdayName,
				todayStart: 0,
			}),
		).toBe("Today is your heaviest day: 6 orders due");
	});

	test("an empty week has no heaviest day", () => {
		expect(
			planAheadHeadline({
				days: [
					{ start: 0, count: 0 },
					{ start: 1, count: 0 },
				],
				weekdayName,
			}),
		).toBeNull();
		expect(planAheadHeadline({ days: [], weekdayName })).toBeNull();
	});

	test("one order due is singular", () => {
		expect(
			planAheadHeadline({ days: [{ start: 1, count: 1 }], weekdayName }),
		).toBe("Tuesday is your heaviest day: 1 order due");
	});
});

describe("the insight threshold", () => {
	test("below the bar the cards stay away", () => {
		expect(hasEnoughForInsights(HOME_INSIGHT_MIN_ORDERS - 1)).toBe(false);
		expect(hasEnoughForInsights(HOME_INSIGHT_MIN_ORDERS)).toBe(true);
	});

	test("the line says where the store is and what is coming", () => {
		expect(insightThresholdLine(1)).toBe(
			"1 of 5 orders. Best sellers, returning customers and order sources appear after your first 5 orders.",
		);
	});
});

describe("staleUnpaidRow", () => {
	test("two parts, the second carrying the money and the oldest date", () => {
		const row = staleUnpaidRow({
			count: 3,
			amount: 38_500,
			currency: MYR,
			staleDays: 3,
			oldestLabel: "Wed 30 Sep",
		});
		expect(row?.title).toBe("3 unpaid orders are over 3 days old");
		expect(sp(row?.detail)).toBe("RM 385.00 · oldest is from Wed 30 Sep");
	});

	test("one order is singular", () => {
		expect(
			staleUnpaidRow({
				count: 1,
				amount: 5_000,
				currency: MYR,
				staleDays: 3,
				oldestLabel: null,
			})?.title,
		).toBe("1 unpaid order is over 3 days old");
	});

	test("nothing stale → no row at all", () => {
		expect(
			staleUnpaidRow({
				count: 0,
				amount: 0,
				currency: MYR,
				staleDays: 3,
				oldestLabel: null,
			}),
		).toBeNull();
	});
});

describe("lapsedRegularsLine", () => {
	test("states the count and the quiet window", () => {
		expect(lapsedRegularsLine({ count: 8, capped: false, quietDays: 30 })).toBe(
			"8 regulars have gone quiet for 30 days",
		);
	});

	test("a capped store reads 20+", () => {
		expect(lapsedRegularsLine({ count: 20, capped: true, quietDays: 30 })).toBe(
			"20+ regulars have gone quiet for 30 days",
		);
	});

	test("one regular is singular — but 1+ is not", () => {
		expect(lapsedRegularsLine({ count: 1, capped: false, quietDays: 30 })).toBe(
			"1 regular has gone quiet for 30 days",
		);
	});

	test("nobody lapsed → no line", () => {
		expect(
			lapsedRegularsLine({ count: 0, capped: false, quietDays: 30 }),
		).toBeNull();
	});
});

describe("creditPaceLine", () => {
	test("turns a balance into days of trading", () => {
		expect(creditPaceLine({ balance: 31, perDay: 10 })).toBe(
			"About 3 days of orders at this week's pace",
		);
	});

	test("rounds to at least a day rather than saying zero", () => {
		expect(creditPaceLine({ balance: 2, perDay: 10 })).toBe(
			"About 1 day of orders at this week's pace",
		);
	});

	test("below one order a day there is no pace to forecast from", () => {
		// "About 97 days" is arithmetic, not a forecast — and it would reassure
		// a quiet store right up until the week it gets busy.
		expect(creditPaceLine({ balance: 97, perDay: 0.9 })).toBeNull();
	});

	test("an empty balance has nothing to forecast", () => {
		expect(creditPaceLine({ balance: 0, perDay: 5 })).toBeNull();
	});
});

describe("zeroEarnedLine", () => {
	test("names the window so RM 0 never looks like a failed load", () => {
		expect(zeroEarnedLine("today")).toBe("No sales yet today");
		expect(zeroEarnedLine("7d")).toBe("No sales in the last 7 days");
		expect(zeroEarnedLine("30d")).toBe("No sales in the last 30 days");
	});
});

describe("the checklist collapse", () => {
	test("collapses once three steps are behind the seller", () => {
		expect(shouldCollapseDoneSteps(2)).toBe(false);
		expect(shouldCollapseDoneSteps(3)).toBe(true);
		expect(shouldCollapseDoneSteps(4)).toBe(true);
	});

	test("reads as a sentence, not a list of past-tense instructions", () => {
		expect(
			doneStepsSummary([
				"WhatsApp number",
				"products",
				"payment details",
				"store link",
			]),
		).toBe(
			"WhatsApp number, products, payment details and store link are done.",
		);
	});

	test("two steps join with 'and', not a comma", () => {
		expect(doneStepsSummary(["WhatsApp number", "products"])).toBe(
			"WhatsApp number and products are done.",
		);
	});

	test("one step is singular", () => {
		expect(doneStepsSummary(["WhatsApp number"])).toBe(
			"WhatsApp number is done.",
		);
	});

	test("nothing done → no sentence", () => {
		expect(doneStepsSummary([])).toBeNull();
	});
});

describe("heroAmount", () => {
	test("a whole-ringgit total drops the noise decimals", () => {
		expect(sp(heroAmount(486_000, MYR))).toBe("RM 4,860");
		expect(sp(heroAmount(0, MYR))).toBe("RM 0");
	});

	test("real sen are kept — rounding them away would be wrong", () => {
		expect(sp(heroAmount(486_050, MYR))).toBe("RM 4,860.50");
		expect(sp(heroAmount(7_839, MYR))).toBe("RM 78.39");
	});

	test("large amounts still compact", () => {
		// formatPriceCompact takes over above 10,000 major units.
		expect(sp(heroAmount(1_929_000, MYR))).not.toContain(".00");
	});
});

describe("a zero baseline is not a comparison", () => {
	test("a weekday the store earned nothing on is not a benchmark", () => {
		// "Last Monday you closed at RM 0.00" reads as a fault, and it is the
		// normal state for a new store — found by driving the real page.
		expect(
			comparisonSentence({
				period: "today",
				currency: MYR,
				earned: 11_700,
				previousEarned: null,
				lastWeekdayName: "Monday",
				lastWeekdayEarned: 0,
			}),
		).toBeNull();
	});

	test("a previous window of nothing says what THIS window is instead", () => {
		// "RM 117.00 more than the 7 days before" claims a week of trading that
		// never happened.
		expect(
			comparisonSentence({
				period: "7d",
				currency: MYR,
				earned: 11_700,
				previousEarned: 0,
			}),
		).toBe("Your first sales in this window");
	});

	test("…and says nothing at all when this window is empty too", () => {
		expect(
			comparisonSentence({
				period: "7d",
				currency: MYR,
				earned: 0,
				previousEarned: 0,
			}),
		).toBeNull();
	});

	test("a real previous window still gets the money difference", () => {
		expect(
			sp(
				comparisonSentence({
					period: "7d",
					currency: MYR,
					earned: 486_000,
					previousEarned: 412_000,
				}),
			),
		).toBe("RM 740.00 more than the 7 days before");
	});
});

describe("tileTintPct — the Plan ahead ramp", () => {
	test("reproduces the design board's own tiles", () => {
		expect(tileTintPct(3)).toBe(20);
		expect(tileTintPct(4)).toBe(23);
		expect(tileTintPct(5)).toBe(26);
		expect(tileTintPct(6)).toBe(29);
		expect(tileTintPct(7)).toBe(32);
	});

	test("a day with nothing due is not tinted at all", () => {
		// Not "very light green" — an empty day is a different kind of day.
		expect(tileTintPct(0)).toBeNull();
	});

	test("heavy days stop at the ceiling rather than running to solid", () => {
		expect(tileTintPct(50)).toBe(TILE_TINT_MAX);
		expect(tileTintPct(500)).toBe(TILE_TINT_MAX);
	});

	test("one order still reads as a tinted day", () => {
		expect(tileTintPct(1)).toBe(TILE_TINT_MIN);
	});

	test("the ramp only ever rises", () => {
		let prev = 0;
		for (let n = 1; n <= 30; n++) {
			const v = tileTintPct(n) ?? 0;
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
	});
});
