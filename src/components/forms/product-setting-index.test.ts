/**
 * "Find a setting" — the index and its matching (z8r3fdwwy3). Pins:
 *
 * - every entry is findable by more than its label (keywords, BM included);
 * - matching is per WORD and by prefix, every word must hit, best first;
 * - a field that exists but can't be used says why and lands on its section;
 * - per-choice fields list only when the query names the choice;
 * - each kind of product is offered only the fields it has.
 *
 * That the targets are really on the page is pinned by
 * product-form-setting-search.test.tsx, against the rendered form.
 */
import { describe, expect, it } from "vitest";
import {
	foldText,
	PRODUCT_SETTING_INDEX,
	type SettingContext,
	searchSettings,
} from "./product-setting-index";

const PHYSICAL: SettingContext = {
	kind: "physical",
	hasOptions: false,
	madeToOrder: false,
	gridReady: true,
	tracksStock: true,
	weightRequired: false,
	isEvent: false,
	promoOn: false,
	promoLocked: false,
	groupedPromotion: false,
	eventsLocked: false,
	categoriesLocked: false,
	customLineOn: false,
	offerSelfCollect: true,
	isPackage: false,
	dayPackage: false,
	countsOpenDays: false,
	weekendRateSet: false,
	choices: [],
	buyerQuestions: [],
	categoryNames: [],
};
const SIZES: SettingContext = {
	...PHYSICAL,
	hasOptions: true,
	choices: ["Small", "Large"],
};
const STAY: SettingContext = { ...PHYSICAL, kind: "booking" };

const ids = (c: SettingContext, q: string) =>
	searchSettings(c, q).map((r) => r.key);
const first = (c: SettingContext, q: string) => searchSettings(c, q)[0];

describe("the index", () => {
	it("gives every entry a unique id and at least one keyword", () => {
		const seen = new Set<string>();
		for (const s of PRODUCT_SETTING_INDEX) {
			expect(seen.has(s.id), s.id).toBe(false);
			seen.add(s.id);
			expect(s.keywords.length, s.id).toBeGreaterThan(0);
		}
	});
});

describe("matching", () => {
	it("an empty query lists nothing, so the page is untouched until they type", () => {
		expect(searchSettings(PHYSICAL, "")).toEqual([]);
		expect(searchSettings(PHYSICAL, "   ")).toEqual([]);
	});

	it("finds a field by the start of its name", () => {
		expect(first(PHYSICAL, "prep")?.key).toBe("prep-time");
		expect(first(PHYSICAL, "Min order")?.key).toBe("min-quantity");
	});

	it("finds a field by what sellers actually type — aliases and BM", () => {
		expect(first(PHYSICAL, "berat")?.key).toBe("parcel-weight");
		expect(first(PHYSICAL, "delyva")?.key).toBe("parcel-weight");
		expect(first(PHYSICAL, "kod")?.key).toBe("sku");
		expect(first(PHYSICAL, "diskaun")?.key).toBe("promo");
		expect(first(PHYSICAL, "sembunyi")?.key).toBe("visibility");
		expect(first(PHYSICAL, "masa sedia")?.key).toBe("prep-time");
	});

	it("ignores case, accents and punctuation", () => {
		expect(foldText("Prép-Time!")).toBe("prep time");
		expect(first(PHYSICAL, "PREP-TIME")?.key).toBe("prep-time");
	});

	it("needs every word to hit", () => {
		expect(ids(PHYSICAL, "prep zebra")).toEqual([]);
	});

	it("a section's name lists what is inside it, ranked under any named field", () => {
		const advanced = ids(PHYSICAL, "advanced");
		expect(advanced).toEqual(expect.arrayContaining(["sku", "parcel-weight"]));
		expect(advanced).not.toContain("prep-time");
	});

	it("says where a result lives, so the seller learns the place", () => {
		expect(first(PHYSICAL, "sku")?.where).toEqual([
			"Pricing & choices",
			"Advanced",
		]);
		expect(first(SIZES, "sku")?.where).toEqual([
			"Pricing & choices",
			"Advanced",
			"Per-choice details",
		]);
	});
});

describe("fields that exist but can't be used right now", () => {
	it("are listed with the reason and land on their section", () => {
		const cap = searchSettings(PHYSICAL, "units").find(
			(r) => r.key === "flash-cap",
		);
		expect(cap?.blocked).toBe("Turn on “Run a promotion” first");
		expect(cap?.target).toBe("#product-promo");
	});

	it("land on the field itself once the thing they wait for is on", () => {
		const cap = searchSettings({ ...PHYSICAL, promoOn: true }, "units").find(
			(r) => r.key === "flash-cap",
		);
		expect(cap?.blocked).toBeNull();
		expect(cap?.target).toBe("#promo-cap");
	});

	it("name the real reason — an event, a plan, a store setting", () => {
		const onSaleEvent = { ...PHYSICAL, promoOn: true, isEvent: true };
		expect(first(onSaleEvent, "max per order")?.blocked).toMatch(/event/);
		expect(first({ ...PHYSICAL, promoLocked: true }, "sale")?.blocked).toBe(
			"Promotions are on the Pro plan",
		);
		expect(
			first({ ...PHYSICAL, offerSelfCollect: false }, "pickup note")?.blocked,
		).toMatch(/self-collect/);
		expect(first(PHYSICAL, "currency")?.blocked).toMatch(/Settings → Store/);
	});
});

describe("per-choice fields", () => {
	it("list once while the query doesn't name a choice", () => {
		expect(ids(SIZES, "sku")).toEqual(["sku"]);
	});

	it("list for the choice the query names, pointed at that choice", () => {
		const r = first(SIZES, "large sku");
		expect(r?.label).toBe("SKU · Large");
		expect(r?.target).toBe('[data-setting="sku"][data-setting-choice="1"]');
	});

	it("a choice's own name lists what it carries, its price first", () => {
		const keys = ids(SIZES, "large");
		expect(keys[0]).toBe("choice-price:1");
		expect(first(SIZES, "large")?.label).toBe("Price · Large");
		expect(keys).toEqual(expect.arrayContaining(["sku:1", "stock:1"]));
		expect(keys.some((k) => k.endsWith(":0"))).toBe(false);
	});
});

describe("what the seller wrote finds where it lives", () => {
	it("a buyer question and a category", () => {
		const c = {
			...PHYSICAL,
			buyerQuestions: ["Which candle colour?"],
			categoryNames: ["Birthday cakes"],
		};
		expect(first(c, "candle")?.target).toBe("#product-buyer-questions");
		expect(first(c, "birthday")?.where).toEqual([
			"Publishing",
			"Where does it show?",
			"Categories",
		]);
	});
});

describe("each kind of product is offered only what it has", () => {
	it("a stay has capacity and a deposit, no SKU, prep time or event", () => {
		expect(ids(STAY, "capacity")).toContain("capacity");
		expect(ids(STAY, "deposit")).toContain("deposit");
		expect(ids(STAY, "sku")).toEqual([]);
		expect(ids(STAY, "prep")).toEqual([]);
		expect(ids(STAY, "rsvp")).toEqual([]);
	});

	it("a physical product has no booking capacity", () => {
		expect(ids(PHYSICAL, "spots available")).toEqual([]);
	});

	it("a made-to-order product has its starting price, not a stock or SKU", () => {
		const mto = { ...PHYSICAL, madeToOrder: true };
		expect(ids(mto, "starting price")).toContain("starting-price");
		expect(ids(mto, "stock")).toEqual([]);
		expect(ids(mto, "sku")).toEqual([]);
	});

	it("a package says why it has no weekend rate", () => {
		const pkg = { ...STAY, isPackage: true };
		expect(first(pkg, "weekend")?.blocked).toMatch(/one flat price/);
	});
});

describe("parcel weight follows where it lives", () => {
	it("tucked inside Advanced, which has to be opened first", () => {
		const r = first(PHYSICAL, "weight");
		expect(r?.opens).toEqual(["advanced"]);
		expect(r?.where).toEqual(["Pricing & choices", "Advanced"]);
	});

	it("promoted out of Advanced where pricing depends on it", () => {
		const r = first({ ...PHYSICAL, weightRequired: true }, "weight");
		expect(r?.opens).toEqual([]);
		expect(r?.where).toEqual(["Pricing & choices", "Parcel weight"]);
	});
});
