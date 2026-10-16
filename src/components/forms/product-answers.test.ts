import { describe, expect, it } from "vitest";
import { EMPTY_EVENT_DRAFT } from "./event-fields";
import {
	bookingNoticeAnswer,
	buyerQuestionsAnswer,
	customOrdersAnswer,
	depositAnswer,
	eventAnswer,
	instantBookAnswer,
	invalidSalePrices,
	mockupAnswer,
	orderRulesAnswer,
	pickupNoteAnswer,
	prepPhrase,
	promoAnswer,
	weekendRateAnswer,
	whereAnswer,
} from "./product-answers";
import { EMPTY_PROMO_DRAFT, type PromoDraft } from "./promo-fields";

// formatDraftPrice joins symbol and amount with a no-break space.
const RM = (n: string) => `RM ${n}`;
const NOW = new Date("2026-10-16T10:00:00+08:00").getTime();

const rows = (...pairs: [string, string?][]) =>
	pairs.map(([price, promoPrice]) => ({ price, promoPrice }));

describe("promoAnswer", () => {
	const base = {
		currency: "MYR",
		locked: false,
		grouped: null,
		flashAllowed: true,
		now: NOW,
	};
	const on: PromoDraft = {
		...EMPTY_PROMO_DRAFT,
		on: true,
		endMode: "open",
	};

	it("reads No when off, and says why on a plan without promotions", () => {
		expect(
			promoAnswer({ ...base, draft: EMPTY_PROMO_DRAFT, rows: rows(["12"]) }),
		).toEqual({ text: "No", tone: "off" });
		expect(
			promoAnswer({
				...base,
				locked: true,
				draft: EMPTY_PROMO_DRAFT,
				rows: rows(["12"]),
			}).text,
		).toBe("Not on your plan");
	});

	it("names one shared percentage when every discounted line agrees", () => {
		const a = promoAnswer({
			...base,
			draft: on,
			rows: rows(["12", "9.60"], ["18", "14.40"]),
		});
		expect(a).toEqual({ text: "Yes · 20% off · no end date", tone: "set" });
	});

	it("counts the lines when the discounts differ", () => {
		expect(
			promoAnswer({
				...base,
				draft: on,
				rows: rows(["12", "10"], ["18", "9"], ["28"]),
			}).text,
		).toBe("Yes · sale price on 2 of 3 · no end date");
	});

	it("never counts a sale price at or above the normal price as a discount", () => {
		// Found in the hands-on test: RM 99 on an RM 20 line read "sale price
		// on 6 of 6" in mint while the save refused it.
		const a = promoAnswer({
			...base,
			draft: on,
			rows: rows(["20", "99"], ["20", "16"]),
		});
		expect(a).toEqual({ text: "1 sale price needs fixing", tone: "warn" });
		expect(
			invalidSalePrices(rows(["20", "99"], ["20", "abc"], ["20", "16"])),
		).toBe(2);
		expect(invalidSalePrices(rows(["20", ""], ["20", "16"]))).toBe(0);
	});

	it("is amber when it is on but nothing is discounted", () => {
		expect(
			promoAnswer({ ...base, draft: on, rows: rows(["12"], ["18"]) }),
		).toEqual({ text: "On, but nothing is on sale yet", tone: "warn" });
	});

	it("is amber, not mint, when a saved sale has already ended", () => {
		const ended: PromoDraft = {
			...on,
			startMode: "started",
			startDate: "2026-10-10",
			startTime: "09:00",
			endMode: "until",
			endDate: "2026-10-12",
			endTime: "18:00",
		};
		const a = promoAnswer({ ...base, draft: ended, rows: rows(["12", "6"]) });
		expect(a.tone).toBe("warn");
		expect(a.text).toMatch(/^Yes · 50% off · ended /);
	});

	it("describes a fresh timed sale relative to the save, not a clock time", () => {
		const timed: PromoDraft = {
			...on,
			endMode: "minutes",
			durationMinutes: 120,
		};
		expect(
			promoAnswer({ ...base, draft: timed, rows: rows(["12", "9"]) }).text,
		).toBe("Yes · 25% off · runs 2 hours from save");
	});

	it("adds the flash limits, and drops them where flash is not allowed", () => {
		const flash: PromoDraft = { ...on, unitCap: "50", maxPerOrder: "2" };
		expect(
			promoAnswer({ ...base, draft: flash, rows: rows(["10", "8"]) }).text,
		).toBe("Yes · 20% off · no end date · 50 units · 2 per order");
		expect(
			promoAnswer({
				...base,
				flashAllowed: false,
				draft: flash,
				rows: rows(["10", "8"]),
			}).text,
		).toBe("Yes · 20% off · no end date");
	});

	it("says a paused promotion is paused on a locked store", () => {
		expect(
			promoAnswer({
				...base,
				locked: true,
				draft: on,
				rows: rows(["10", "8"]),
			}),
		).toEqual({ text: "Paused · promotions are part of Pro", tone: "warn" });
	});

	it("names the bulk promotion a product belongs to", () => {
		expect(
			promoAnswer({
				...base,
				draft: EMPTY_PROMO_DRAFT,
				rows: rows(["10"]),
				grouped: { label: "Raya Promo", percentOff: 20 },
			}).text,
		).toBe("Part of Raya Promo · 20% off · no end date");
	});
});

describe("eventAnswer", () => {
	const base = { locked: false, noVenue: false, now: NOW };
	it("reads No when off, and Not on your plan when locked", () => {
		expect(eventAnswer({ ...base, draft: EMPTY_EVENT_DRAFT }).text).toBe("No");
		expect(
			eventAnswer({ ...base, locked: true, draft: EMPTY_EVENT_DRAFT }).text,
		).toBe("Not on your plan");
	});

	it("asks for the date when switched on without one", () => {
		expect(
			eventAnswer({ ...base, draft: { ...EMPTY_EVENT_DRAFT, on: true } }),
		).toEqual({ text: "Yes · pick the date", tone: "warn" });
	});

	it("states the date, seats and RSVPs of a live event", () => {
		const a = eventAnswer({
			...base,
			rsvpCount: 18,
			draft: {
				...EMPTY_EVENT_DRAFT,
				on: true,
				date: "2026-10-24",
				time: "08:00",
				seats: "30",
			},
		});
		expect(a.tone).toBe("set");
		expect(a.text).toBe("Yes · Sat 24 Oct · 8:00 AM · 30 seats · 18 RSVPs");
	});

	it("is amber once the date has passed, and when there is no venue", () => {
		const past = { ...EMPTY_EVENT_DRAFT, on: true, date: "2026-09-12" };
		expect(eventAnswer({ ...base, draft: past }).text).toMatch(
			/it has passed$/,
		);
		expect(
			eventAnswer({
				...base,
				noVenue: true,
				draft: { ...past, date: "2026-11-01" },
			}),
		).toEqual({ text: "Yes · needs a venue first", tone: "warn" });
	});
});

describe("customOrdersAnswer", () => {
	const line = { label: "", price: "", prompt: "", imageStorageIds: [] };
	it("names the line and its starting price, or that it is quoted", () => {
		expect(customOrdersAnswer(null, "MYR").text).toBe("No");
		expect(customOrdersAnswer(line, "MYR").text).toBe(
			"Yes · “Custom” · price on quote",
		);
		expect(
			customOrdersAnswer({ ...line, label: "Custom box", price: "40" }, "MYR")
				.text,
		).toBe(`Yes · “Custom box” · from ${RM("40")}`);
		expect(customOrdersAnswer({ ...line, price: "40" }, "SGD").text).toBe(
			"Yes · “Custom” · from S$ 40",
		);
	});
});

describe("mockupAnswer — tri-state", () => {
	const r = (...flags: boolean[]) =>
		flags.map((requiresProof) => ({ requiresProof }));
	it("all, none and some each read differently", () => {
		expect(mockupAnswer(r(false, false)).text).toBe("No");
		expect(mockupAnswer(r(true)).text).toBe("Yes");
		expect(mockupAnswer(r(true, true, true)).text).toBe("Yes · every choice");
		// A mixed product must never read as "No".
		expect(mockupAnswer(r(true, true, false))).toEqual({
			text: "For 2 of 3 choices",
			tone: "set",
		});
	});
});

describe("buyerQuestionsAnswer", () => {
	const q = (required: boolean) => ({
		id: String(Math.random()),
		label: "Q",
		type: "text" as const,
		options: [],
		required,
		showWhenId: "",
		showWhenOption: "",
	});
	it("counts the questions and the required ones", () => {
		expect(buyerQuestionsAnswer([]).text).toBe("Not asked");
		expect(buyerQuestionsAnswer([q(false)]).text).toBe("1 question");
		expect(buyerQuestionsAnswer([q(true), q(false)]).text).toBe(
			"2 questions · 1 required",
		);
	});
});

describe("orderRulesAnswer", () => {
	const base = {
		minQuantity: 0,
		noticeDays: 0,
		prepMinutes: 0,
		isEvent: false,
		heedsWarning: null,
	};
	it("reads None with no rules", () => {
		expect(orderRulesAnswer(base)).toEqual({ text: "None", tone: "off" });
	});
	it("names each rule that is set", () => {
		expect(
			orderRulesAnswer({
				...base,
				minQuantity: 20,
				noticeDays: 1,
				prepMinutes: 120,
			}).text,
		).toBe("Min 20 · 1 day’s notice · 2 h prep");
	});
	it("leaves out notice and prep on an event, which ignores both", () => {
		expect(
			orderRulesAnswer({
				...base,
				minQuantity: 10,
				noticeDays: 3,
				prepMinutes: 60,
				isEvent: true,
			}).text,
		).toBe("Min 10");
	});
	it("names the heads-up on the collapsed line, in amber", () => {
		// Found in the hands-on test: "check the note inside" sent the seller
		// hunting two fields down for a note it could simply have said.
		expect(
			orderRulesAnswer({
				...base,
				noticeDays: 2,
				prepMinutes: 60,
				heedsWarning: "prep_inert",
			}),
		).toEqual({
			text: "2 days’ notice · 1 h prep · prep has no effect while notice is on",
			tone: "warn",
		});
		expect(
			orderRulesAnswer({
				...base,
				minQuantity: 20,
				heedsWarning: "stock_short",
			}).text,
		).toBe("Min 20 · stock is below the minimum");
	});
	it("spells prep the way a seller says it", () => {
		expect(prepPhrase(45)).toBe("45 min");
		expect(prepPhrase(60)).toBe("1 h");
		expect(prepPhrase(90)).toBe("1 h 30 min");
	});
});

describe("pickupNoteAnswer", () => {
	it("says what switches it on when the store has no self-collect", () => {
		expect(pickupNoteAnswer("Side counter", false).text).toBe(
			"Needs self-collect on · Settings → Fulfilment",
		);
	});
	it("quotes the note, collapsed to one line", () => {
		expect(pickupNoteAnswer("  ", true).text).toBe("Nothing yet");
		expect(pickupNoteAnswer("Side\n counter", true).text).toBe(
			"“Side counter”",
		);
	});
});

describe("whereAnswer", () => {
	it("says visible or hidden, and names categories only on a store that has them", () => {
		expect(
			whereAnswer({
				hidden: false,
				categoryNames: [],
				storeHasCategories: false,
			}).text,
		).toBe("On your storefront");
		expect(
			whereAnswer({
				hidden: false,
				categoryNames: ["Cakes", "Pastries"],
				storeHasCategories: true,
			}).text,
		).toBe("On your storefront · Cakes, Pastries");
		expect(
			whereAnswer({ hidden: true, categoryNames: [], storeHasCategories: true })
				.text,
		).toBe("Hidden from your store · counter only · no category");
	});
});

describe("whereAnswer — what the storefront actually does", () => {
	it("a past event is off the storefront whatever the switch says", () => {
		// Found in the hands-on test: an ended event read "On your storefront".
		expect(
			whereAnswer({
				hidden: false,
				categoryNames: [],
				storeHasCategories: false,
				eventPassed: true,
			}),
		).toEqual({
			text: "Off your storefront · the event has passed",
			tone: "warn",
		});
	});
	it("a product whose every category is hidden is off the storefront", () => {
		expect(
			whereAnswer({
				hidden: false,
				categoryNames: ["Raya"],
				storeHasCategories: true,
				allCategoriesHidden: true,
			}).text,
		).toBe("Off your storefront · its categories are hidden · Raya");
	});
	it("the seller's own Hidden switch still reads as their choice", () => {
		expect(
			whereAnswer({
				hidden: true,
				categoryNames: [],
				storeHasCategories: false,
				eventPassed: true,
			}).text,
		).toBe("Hidden from your store · counter only");
	});
});

describe("booking answers", () => {
	it("weekend rate: not for a package, off, or the two rates", () => {
		const b = {
			weekendDays: [5, 6],
			basePrice: "80",
			currency: "MYR",
		};
		expect(
			weekendRateAnswer({ ...b, isPackage: true, weekendPrice: "120" }).text,
		).toBe("Not for a package · it has one flat price");
		expect(
			weekendRateAnswer({ ...b, isPackage: false, weekendPrice: "" }).text,
		).toBe("No · one rate every night");
		expect(
			weekendRateAnswer({ ...b, isPackage: false, weekendPrice: "120" }).text,
		).toBe(`Fri & Sat nights ${RM("120")} · other nights ${RM("80")}`);
		expect(
			weekendRateAnswer({
				...b,
				isPackage: false,
				weekendPrice: "120",
				weekendDays: [],
			}).tone,
		).toBe("warn");
	});

	it("instant book, deposit and notice", () => {
		expect(instantBookAnswer(true).tone).toBe("set");
		expect(instantBookAnswer(false).text).toBe(
			"No · you approve each request first",
		);
		expect(depositAnswer("", "MYR").text).toBe("No");
		expect(depositAnswer("100", "MYR").text).toBe(
			`${RM("100")} · returned after check-out`,
		);
		expect(bookingNoticeAnswer(0).text).toBe(
			"None · same-day requests allowed",
		);
		expect(bookingNoticeAnswer(2).text).toBe("2 days");
	});
});
