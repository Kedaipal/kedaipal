// "Find a setting" on the full product form (z8r3fdwwy3).
//
// The form collapses most of what a product can do into question rows, and
// some of it (SKU, a second choice, switching one choice off) sits a level
// deeper inside the price card's Advanced box. Sellers who know an option
// EXISTS lose time guessing which row holds it. This is the index the search
// box reads: one entry per FIELD, never per section, so "prep time", "SKU" or
// "berat" each land on the input itself.
//
// Why an index and not the page's text: Advanced is not rendered while it is
// closed (and keeping it mounted would mean rendering every choice twice on a
// 40-choice product), and the page's labels never carry the words sellers
// actually type ("berat", "diskaun", "kod"). So the search reads data, and
// the page is only touched when the seller picks a result — `revealSetting`
// in `reveal-setting.ts` opens whatever is in the way.
//
// Rules for an entry:
// - `target` is a selector INSIDE the form for the field itself; `section` is
//   the card or question row around it. A blocked entry lands on its section.
// - `blocked` is for a field that exists but can't be used right now (a
//   toggle is off, a plan feature, a store setting). It is still listed — the
//   reason is the answer to "is it even there?" — and never pretends to be
//   editable. An entry that doesn't exist for this KIND of product at all
//   returns false from `applies` and is not listed.
// - Every entry has keywords, BM included. `product-setting-index.test.ts`
//   pins that, and the form test pins that every target is really rendered.
//
// Matching is pure and synchronous: a few hundred short strings, folded once.

import type { ProductKind } from "../../../convex/lib/productKind";

/** What the index needs to know about the product being edited — derived
 * from the same drafts the fields edit, so results follow every keystroke. */
export type SettingContext = {
	kind: ProductKind;
	/** Choices mode ("Buyer picks"). */
	hasOptions: boolean;
	/** The product IS one bespoke line (no matrix). */
	madeToOrder: boolean;
	/** The choice grid exists (an axis mid-authoring has no rows yet). */
	gridReady: boolean;
	/** At least one choice counts stock (vs "made fresh"). */
	tracksStock: boolean;
	/** Parcel weight is promoted and required (`weightPricingOf`). */
	weightRequired: boolean;
	isEvent: boolean;
	promoOn: boolean;
	promoLocked: boolean;
	/** The product is inside a bulk promotion, which owns its terms. */
	groupedPromotion: boolean;
	eventsLocked: boolean;
	categoriesLocked: boolean;
	customLineOn: boolean;
	offerSelfCollect: boolean;
	/** Booking: a fixed-length package rather than free check-in/out. */
	isPackage: boolean;
	/** Booking: a package counted in days (asks "only days you're open"). */
	dayPackage: boolean;
	/** Booking: "Only days you're open" is on. */
	countsOpenDays: boolean;
	/** Booking: a weekend rate has been typed. */
	weekendRateSet: boolean;
	/** Each choice's label, in grid order (choices mode). */
	choices: readonly string[];
	/** The text of each buyer question. */
	buyerQuestions: readonly string[];
	/** The names of the categories this product is in. */
	categoryNames: readonly string[];
};

/** A container that is NOT rendered while closed, so a target inside it
 * can't be found until it is asked to open. Every other disclosure on the
 * form stays mounted (`hidden`) and is opened by walking up from the field. */
export type LazyContainer = "advanced";

type Resolve<T> = T | ((c: SettingContext) => T);

export type ProductSetting = {
	id: string;
	label: Resolve<string>;
	/** Breadcrumb from the top of the form: card or group, then row. */
	where: Resolve<readonly string[]>;
	keywords: readonly string[];
	applies: (c: SettingContext) => boolean;
	/** Exists but can't be used right now — why, in the seller's words. */
	blocked?: (c: SettingContext) => string | null;
	target: Resolve<string>;
	section: Resolve<string>;
	opens?: Resolve<readonly LazyContainer[]>;
	/** Repeated once per choice when this is true for the product. */
	perChoice?: Resolve<boolean>;
	/** The instance's label before " · <choice>" when `label` reads wrong
	 * with a choice after it ("Price · Large", not "Price for each choice"). */
	choiceLabel?: string;
};

/** One line in the results list. */
export type SettingResult = {
	key: string;
	label: string;
	where: readonly string[];
	blocked: string | null;
	/** Where the jump lands: the field, or its section when blocked. */
	target: string;
	section: string;
	opens: readonly LazyContainer[];
};

const resolve = <T>(v: Resolve<T>, c: SettingContext): T =>
	typeof v === "function" ? (v as (c: SettingContext) => T)(c) : v;

/** The attribute every searchable field (or its wrapper) carries. */
export const SETTING_ATTR = "data-setting";
/** Marks which choice a per-choice field belongs to (grid row index). */
export const SETTING_CHOICE_ATTR = "data-setting-choice";

/** Spread onto a field's wrapper: `{...settingAnchor("sku", i)}`. */
export function settingAnchor(
	id: string,
	choice?: number,
): Record<string, string> {
	return choice === undefined
		? { [SETTING_ATTR]: id }
		: { [SETTING_ATTR]: id, [SETTING_CHOICE_ATTR]: String(choice) };
}

const field = (id: string) => `[${SETTING_ATTR}="${id}"]`;
const forChoice = (selector: string, choice: number) =>
	`${selector}[${SETTING_CHOICE_ATTR}="${choice}"]`;

// Section anchors: the cards (ProductStepCard ids) and the question rows.
const BASICS = "#product-basics";
const PHOTOS = "#product-photos";
const PRICING = "#product-pricing";
const ROW = {
	weekend: "#product-weekend-rate",
	promo: "#product-promo",
	event: "#product-event",
	custom: "#product-custom-orders",
	mockup: "#product-mockup",
	instant: "#product-instant-book",
	deposit: "#product-deposit",
	questions: "#product-buyer-questions",
	rules: "#product-order-rules",
	pickup: "#product-pickup-note",
	where: "#product-where",
} as const;

const PRICING_TITLE = (c: SettingContext) =>
	c.kind === "booking" ? "Pricing & capacity" : "Pricing & choices";

const notBooking = (c: SettingContext) => c.kind !== "booking";
const booking = (c: SettingContext) => c.kind === "booking";
/** Fields of the variant editor that a made-to-order product doesn't have. */
const hasMatrix = (c: SettingContext) => notBooking(c) && !c.madeToOrder;

/** Advanced's breadcrumb — one level deeper for a per-choice field. */
const advanced = (c: SettingContext, perChoice: boolean) =>
	perChoice && c.hasOptions
		? [PRICING_TITLE(c), "Advanced", "Per-choice details"]
		: [PRICING_TITLE(c), "Advanced"];

const SALE_ROW = ["Selling options", "Is it on sale right now?"] as const;
const EVENT_ROW = ["Selling options", "Is it a fixed-date event?"] as const;
const RULES_ROW = ["At checkout", "Any rules on how it’s ordered?"] as const;

const promoOffReason = (c: SettingContext) =>
	c.promoLocked && !c.groupedPromotion
		? "Promotions are on the Pro plan"
		: !c.promoOn && !c.groupedPromotion
			? "Turn on “Run a promotion” first"
			: null;
const flashReason = (c: SettingContext) =>
	c.isEvent
		? "Flash-sale extras don’t apply to an event — seats already cap it"
		: promoOffReason(c);
const eventOffReason = (c: SettingContext) =>
	c.eventsLocked
		? "Events are on the Pro plan"
		: !c.isEvent
			? "Turn on “This is an event” first"
			: null;
const eventTimingReason = (c: SettingContext) =>
	c.isEvent && notBooking(c)
		? "Doesn’t apply to an event — guests RSVP to its fixed date"
		: null;
const packageWeekendReason = (c: SettingContext) =>
	c.isPackage
		? "A package has one flat price — clear the package length to charge weekends differently"
		: null;

/**
 * Every searchable field, in page order. Ties in ranking keep this order, so
 * results read top-to-bottom like the form.
 */
export const PRODUCT_SETTING_INDEX: readonly ProductSetting[] = [
	// --- Product basics ---------------------------------------------------
	{
		id: "name",
		label: "Name",
		where: ["Product basics"],
		keywords: ["title", "product name", "nama", "tajuk", "rename"],
		applies: () => true,
		target: "#name",
		section: BASICS,
	},
	{
		id: "description",
		label: "Description",
		where: ["Product basics"],
		keywords: [
			"details",
			"about",
			"keterangan",
			"penerangan",
			"info",
			"specs",
			"formatting",
			"bullet",
			"markdown",
		],
		applies: () => true,
		target: "#description",
		section: BASICS,
	},
	{
		id: "photos",
		label: "Photos",
		where: ["Photos"],
		keywords: ["image", "picture", "gambar", "foto", "cover", "upload"],
		applies: () => true,
		target: PHOTOS,
		section: PHOTOS,
	},

	// --- Pricing & choices (everything but a booking) -----------------------
	{
		id: "product-type",
		label: "Does the buyer choose anything?",
		where: ["Pricing & choices"],
		keywords: [
			"product type",
			"what kind",
			"type",
			"jenis",
			"single",
			"one item",
			"buyer picks",
			"options",
			"variants",
			"choices",
			"made to order",
			"bespoke",
		],
		applies: notBooking,
		target: field("product-type"),
		section: PRICING,
	},
	{
		id: "price",
		label: "Price",
		where: ["Pricing & choices"],
		keywords: ["harga", "cost", "amount", "rm"],
		applies: (c) => notBooking(c) && !c.hasOptions && !c.madeToOrder,
		target: field("price"),
		section: PRICING,
	},
	{
		id: "choice-axis",
		label: "Choices buyers pick from",
		where: ["Pricing & choices", "They choose by"],
		keywords: [
			"size",
			"flavour",
			"flavor",
			"colour",
			"color",
			"saiz",
			"perisa",
			"warna",
			"variant",
			"option",
			"add a choice",
			"value",
		],
		applies: (c) => notBooking(c) && c.hasOptions,
		target: field("choice-axis"),
		section: PRICING,
	},
	{
		id: "choice-price",
		label: "Price for each choice",
		choiceLabel: "Price",
		where: ["Pricing & choices", "The choices & prices"],
		keywords: ["harga", "choice price", "fill all prices", "bulk price"],
		applies: (c) => notBooking(c) && c.hasOptions && c.gridReady,
		target: field("choice-price"),
		section: PRICING,
		perChoice: true,
	},
	{
		id: "stock",
		label: "Stock",
		where: (c) =>
			c.hasOptions
				? ["Pricing & choices", "The choices & prices"]
				: ["Pricing & choices"],
		keywords: [
			"stok",
			"inventory",
			"quantity",
			"qty",
			"in stock",
			"on hand",
			"restock",
			"adjust",
			"baki",
		],
		applies: (c) => hasMatrix(c) && c.gridReady,
		blocked: (c) =>
			c.tracksStock
				? null
				: "Made fresh — switch “How do you prepare orders?” to from stock to count it",
		target: field("stock"),
		section: PRICING,
		perChoice: (c) => c.hasOptions,
	},
	{
		id: "starting-price",
		label: "Starting price",
		where: ["Pricing & choices"],
		keywords: ["harga", "from price", "quote", "price on quote"],
		applies: (c) => notBooking(c) && c.madeToOrder,
		target: field("starting-price"),
		section: PRICING,
	},
	{
		id: "mto-prompt",
		label: "What should the buyer tell you?",
		where: ["Pricing & choices"],
		keywords: ["request", "brief", "instructions", "prompt", "placeholder"],
		applies: (c) => notBooking(c) && c.madeToOrder,
		target: field("mto-prompt"),
		section: PRICING,
	},
	{
		id: "prepare",
		label: "How do you prepare orders?",
		where: ["Pricing & choices"],
		keywords: [
			"made fresh",
			"from stock",
			"pre order",
			"preorder",
			"track stock",
			"sold out",
			"out of stock",
			"tempahan",
		],
		applies: (c) => hasMatrix(c) && c.gridReady,
		target: field("prepare"),
		section: PRICING,
	},
	{
		id: "parcel-weight",
		label: "Parcel weight",
		where: (c) =>
			c.weightRequired
				? ["Pricing & choices", "Parcel weight"]
				: advanced(c, true),
		keywords: [
			"weight",
			"berat",
			"gram",
			"grams",
			"kg",
			"kilo",
			"shipping",
			"postage",
			"courier",
			"delivery",
			"delyva",
			"lalamove",
			"easyparcel",
			"pos",
		],
		applies: (c) => hasMatrix(c) && c.gridReady,
		target: field("parcel-weight"),
		section: PRICING,
		opens: (c) => (c.weightRequired ? [] : ["advanced"]),
		perChoice: (c) => c.hasOptions,
	},
	{
		id: "second-choice",
		label: "Second choice (e.g. Size × Flavour)",
		where: (c) => advanced(c, false),
		keywords: [
			"second option",
			"two options",
			"another choice",
			"combination",
			"matrix",
		],
		applies: (c) => notBooking(c) && c.hasOptions,
		target: field("second-choice"),
		section: PRICING,
		opens: ["advanced"],
	},
	{
		id: "sku",
		label: "SKU",
		where: (c) => advanced(c, true),
		keywords: [
			"kod",
			"code",
			"item code",
			"product code",
			"barcode",
			"reference",
		],
		applies: (c) => hasMatrix(c) && c.gridReady,
		target: field("sku"),
		section: PRICING,
		opens: ["advanced"],
		perChoice: (c) => c.hasOptions,
	},
	{
		id: "choice-on-off",
		label: "Turn a choice on or off",
		choiceLabel: "On sale or off",
		where: (c) => advanced(c, true),
		keywords: [
			"hide a choice",
			"disable",
			"deactivate",
			"unavailable",
			"sold out",
			"sembunyi",
			"tutup",
		],
		applies: (c) => notBooking(c) && c.hasOptions && c.gridReady,
		target: field("choice-on-off"),
		section: PRICING,
		opens: ["advanced"],
		perChoice: true,
	},
	{
		id: "choice-photo",
		label: "Photo for each choice",
		choiceLabel: "Photo",
		where: (c) => advanced(c, true),
		keywords: ["image", "picture", "gambar", "foto", "variant photo"],
		applies: (c) => notBooking(c) && c.hasOptions && c.gridReady,
		target: field("choice-photo"),
		section: PRICING,
		opens: ["advanced"],
		perChoice: true,
	},
	{
		id: "currency",
		label: "Currency",
		where: ["Pricing & choices"],
		keywords: ["ringgit", "myr", "sgd", "dollar", "matawang", "rm"],
		applies: notBooking,
		blocked: () => "Set for the whole store in Settings → Store",
		target: field("currency"),
		section: field("currency"),
	},

	// --- Pricing & capacity (a booking) ---------------------------------------
	{
		id: "package-length",
		label: "Package length",
		where: ["Pricing & capacity"],
		keywords: [
			"package",
			"pakej",
			"membership",
			"monthly",
			"bulanan",
			"duration",
			"month",
			"pass",
			"term",
		],
		applies: booking,
		target: "#booking-package",
		section: PRICING,
	},
	{
		id: "day-counting",
		label: "How are the days counted? (only days you’re open)",
		where: ["Pricing & capacity"],
		keywords: [
			"open days",
			"closed days",
			"days off",
			"cuti",
			"holiday",
			"counting",
		],
		applies: booking,
		blocked: (c) =>
			c.dayPackage
				? null
				: "Asked for a package counted in days — set the package length in days first",
		target: field("day-counting"),
		section: PRICING,
	},
	{
		id: "max-skips",
		label: "Skips per package",
		where: ["Pricing & capacity"],
		keywords: ["skip", "miss a day", "pause", "freeze", "ponteng"],
		applies: booking,
		blocked: (c) =>
			c.countsOpenDays ? null : "Turn on “Only days you’re open” first",
		target: "#booking-max-skips",
		section: PRICING,
	},
	{
		id: "booking-price",
		label: (c) => (c.isPackage ? "Price per package" : "Price per night"),
		where: ["Pricing & capacity"],
		keywords: ["harga", "rate", "nightly", "price"],
		applies: booking,
		target: "#booking-price",
		section: PRICING,
	},
	{
		id: "capacity",
		label: "Spots available",
		where: ["Pricing & capacity"],
		keywords: [
			"capacity",
			"spots",
			"slots",
			"kuota",
			"quota",
			"limit",
			"how many",
			"units",
			"plots",
			"rooms",
			"unlimited",
		],
		applies: booking,
		target: "#booking-capacity",
		section: PRICING,
	},

	// --- Selling options ------------------------------------------------------
	{
		id: "weekend-rate",
		label: "Weekend rate",
		where: ["Selling options", "Do weekend nights cost more?"],
		keywords: [
			"weekend",
			"hujung minggu",
			"friday",
			"saturday",
			"peak",
			"surcharge",
		],
		applies: booking,
		blocked: packageWeekendReason,
		target: "#booking-weekend",
		section: ROW.weekend,
	},
	{
		id: "weekend-nights",
		label: "Which nights charge the weekend rate",
		where: ["Selling options", "Do weekend nights cost more?"],
		keywords: ["weekend nights", "fri", "sat", "which days"],
		applies: booking,
		blocked: (c) =>
			packageWeekendReason(c) ??
			(c.weekendRateSet ? null : "Enter a weekend rate first"),
		target: field("weekend-nights"),
		section: ROW.weekend,
	},
	{
		id: "promo",
		label: "Put it on sale",
		where: SALE_ROW,
		keywords: [
			"sale",
			"promo",
			"promotion",
			"discount",
			"diskaun",
			"potongan",
			"offer",
			"jualan murah",
			"cheaper",
		],
		applies: () => true,
		blocked: (c) =>
			c.promoLocked && !c.groupedPromotion
				? "Promotions are on the Pro plan"
				: null,
		target: ROW.promo,
		section: ROW.promo,
	},
	{
		id: "sale-prices",
		label: "Sale price",
		where: SALE_ROW,
		keywords: [
			"discount price",
			"harga promosi",
			"percent off",
			"quick fill",
			"diskaun",
		],
		applies: () => true,
		blocked: promoOffReason,
		target: field("sale-prices"),
		section: ROW.promo,
	},
	{
		id: "sale-label",
		label: "Promotion label (the badge)",
		where: SALE_ROW,
		keywords: ["badge", "tag", "wording", "sale text"],
		applies: (c) => !c.groupedPromotion,
		blocked: promoOffReason,
		target: "#promo-label",
		section: ROW.promo,
	},
	{
		id: "sale-window",
		label: "When the sale starts and ends",
		where: SALE_ROW,
		keywords: [
			"schedule",
			"start",
			"end",
			"until",
			"how long",
			"countdown",
			"timer",
			"tarikh",
			"no end date",
		],
		applies: (c) => !c.groupedPromotion,
		blocked: promoOffReason,
		target: field("sale-window"),
		section: ROW.promo,
	},
	{
		id: "flash-cap",
		label: "Only the first N units at this price",
		where: [...SALE_ROW, "Flash sale extras"],
		keywords: ["flash sale", "flash", "limited", "units", "quota", "first"],
		applies: (c) => notBooking(c) && !c.groupedPromotion,
		blocked: flashReason,
		target: "#promo-cap",
		section: ROW.promo,
	},
	{
		id: "flash-max",
		label: "Max per order (flash sale)",
		where: [...SALE_ROW, "Flash sale extras"],
		keywords: [
			"limit per buyer",
			"per customer",
			"per order",
			"maximum",
			"limit",
		],
		applies: (c) => notBooking(c) && !c.groupedPromotion,
		blocked: flashReason,
		target: "#promo-max",
		section: ROW.promo,
	},
	{
		id: "flash-pay-within",
		label: "Buyers must pay within (flash sale)",
		where: [...SALE_ROW, "Flash sale extras"],
		keywords: ["unpaid", "cancel", "pay within", "payment time", "release"],
		applies: (c) => notBooking(c) && !c.groupedPromotion,
		blocked: flashReason,
		target: field("flash-pay-within"),
		section: ROW.promo,
	},
	{
		id: "event",
		label: "Make it a fixed-date event",
		where: EVENT_ROW,
		keywords: [
			"event",
			"rsvp",
			"acara",
			"majlis",
			"workshop",
			"class",
			"kelas",
			"ticket",
			"tiket",
			"festival",
		],
		applies: notBooking,
		blocked: (c) => (c.eventsLocked ? "Events are on the Pro plan" : null),
		target: ROW.event,
		section: ROW.event,
	},
	{
		id: "event-date",
		label: "Event date",
		where: EVENT_ROW,
		keywords: ["tarikh", "day", "last day", "multi day", "end date"],
		applies: notBooking,
		blocked: eventOffReason,
		target: "#event-date",
		section: ROW.event,
	},
	{
		id: "event-time",
		label: "Event start time",
		where: EVENT_ROW,
		keywords: ["masa", "time", "start time"],
		applies: notBooking,
		blocked: eventOffReason,
		target: "#event-time",
		section: ROW.event,
	},
	{
		id: "event-seats",
		label: "Event seats",
		where: EVENT_ROW,
		keywords: ["capacity", "tickets", "kuota", "slots", "spots", "guests"],
		applies: notBooking,
		blocked: eventOffReason,
		target: "#event-seats",
		section: ROW.event,
	},
	{
		id: "event-venue",
		label: "Event venue",
		where: EVENT_ROW,
		keywords: ["location", "tempat", "place", "pickup point", "address"],
		applies: notBooking,
		blocked: eventOffReason,
		target: field("event-venue"),
		section: ROW.event,
	},
	{
		id: "event-approve",
		label: "Approve each RSVP before the guest pays",
		where: EVENT_ROW,
		keywords: ["approval", "manual", "accept", "confirm rsvp"],
		applies: notBooking,
		blocked: eventOffReason,
		target: field("event-approve"),
		section: ROW.event,
	},
	{
		id: "custom-orders",
		label: "Take custom requests",
		where: ["Selling options", "Do you take custom requests on it?"],
		keywords: [
			"custom",
			"custom order",
			"bespoke",
			"personalised",
			"personalized",
			"tempahan khas",
			"special order",
		],
		applies: hasMatrix,
		target: ROW.custom,
		section: ROW.custom,
	},
	{
		id: "custom-details",
		label: "Custom request name, price & what to ask",
		where: ["Selling options", "Do you take custom requests on it?"],
		keywords: ["custom price", "quote", "request box", "custom photo"],
		applies: hasMatrix,
		blocked: (c) =>
			c.customLineOn ? null : "Turn on “Offer custom orders” first",
		target: field("custom-details"),
		section: ROW.custom,
	},
	{
		id: "mockup",
		label: "Mockup approval",
		where: ["Selling options", "Does the buyer approve a mockup first?"],
		keywords: [
			"proof",
			"design",
			"approve design",
			"artwork",
			"preview",
			"lukisan",
			"reka bentuk",
			"sample",
		],
		applies: hasMatrix,
		target: ROW.mockup,
		section: ROW.mockup,
	},
	{
		id: "instant-book",
		label: "Instant book",
		where: ["Selling options", "Confirm bookings instantly?"],
		keywords: [
			"auto accept",
			"confirm automatically",
			"approve requests",
			"instant",
		],
		applies: booking,
		target: ROW.instant,
		section: ROW.instant,
	},
	{
		id: "deposit",
		label: "Security deposit",
		where: ["Selling options", "Take a refundable security deposit?"],
		keywords: ["deposit", "cagaran", "refundable", "hold", "damage"],
		applies: booking,
		target: "#booking-deposit",
		section: ROW.deposit,
	},

	// --- At checkout ----------------------------------------------------------
	{
		id: "buyer-questions",
		label: "Questions buyers answer",
		where: ["At checkout", "Do buyers answer any questions?"],
		keywords: [
			"question",
			"ask",
			"form",
			"soalan",
			"custom field",
			"personalisation",
			"engraving",
			"message",
		],
		applies: notBooking,
		target: ROW.questions,
		section: ROW.questions,
	},
	{
		id: "min-quantity",
		label: "Minimum order quantity",
		where: RULES_ROW,
		keywords: [
			"moq",
			"minimum",
			"min order",
			"at least",
			"kuantiti minimum",
			"bulk",
		],
		applies: notBooking,
		target: "#min-order-qty",
		section: ROW.rules,
	},
	{
		id: "min-notice",
		label: "Minimum notice (days)",
		where: (c) =>
			c.kind === "booking"
				? ["At checkout", "How much notice do you need?"]
				: RULES_ROW,
		keywords: [
			"notice",
			"lead time",
			"advance",
			"notis",
			"days ahead",
			"pre order",
			"book ahead",
			"earliest date",
		],
		applies: () => true,
		blocked: eventTimingReason,
		target: "#min-notice-days",
		section: ROW.rules,
	},
	{
		id: "prep-time",
		label: "Prep time",
		where: RULES_ROW,
		keywords: [
			"preparation",
			"masa sedia",
			"ready in",
			"minutes",
			"hours",
			"lead time",
			"bake",
			"cook",
		],
		applies: notBooking,
		blocked: eventTimingReason,
		target: "#prep-minutes",
		section: ROW.rules,
	},
	{
		id: "pickup-note",
		label: "Pickup note",
		where: ["At checkout", "Anything to know when collecting?"],
		keywords: [
			"collect",
			"self collect",
			"ambil",
			"pickup",
			"collection",
			"instructions",
		],
		applies: notBooking,
		blocked: (c) =>
			c.offerSelfCollect
				? null
				: "Needs self-collect on — Settings → Fulfilment",
		target: "#pickup-note",
		section: ROW.pickup,
	},

	// --- Publishing -----------------------------------------------------------
	{
		id: "visibility",
		label: "Show or hide on your storefront",
		where: ["Publishing", "Where does it show?"],
		keywords: [
			"hide",
			"hidden",
			"sembunyi",
			"private",
			"visible",
			"publish",
			"unpublish",
			"unlist",
			"counter only",
		],
		applies: () => true,
		target: field("visibility"),
		section: ROW.where,
	},
	{
		id: "categories",
		label: "Categories",
		where: ["Publishing", "Where does it show?"],
		keywords: ["category", "kategori", "collection", "group", "menu"],
		applies: () => true,
		blocked: (c) =>
			c.categoriesLocked ? "Adding to categories is on the Pro plan" : null,
		target: field("categories"),
		section: ROW.where,
	},
];

// --- Matching ---------------------------------------------------------------

/** Lower-case, accents off, punctuation to spaces — "Prep-time" ≡ "prep time". */
export function foldText(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

const words = (text: string) => {
	const folded = foldText(text);
	return folded.length === 0 ? [] : folded.split(" ");
};

// How much a token is worth by where it matched. A label hit outranks an
// alias, an alias outranks a choice or question the seller wrote, and the
// breadcrumb ("advanced", "checkout") barely counts — it finds everything in
// a section, which is useful but should never beat a named field.
const WEIGHT = { label: 4, keyword: 3, text: 3, where: 1 } as const;
type Source = keyof typeof WEIGHT;

type Candidate = {
	key: string;
	order: number;
	label: string;
	fields: Array<{ source: Source; words: string[] }>;
	/** Per-choice instances only list when the query names the choice. */
	needsText: boolean;
	result: SettingResult;
};

function tokenScore(token: string, fields: Candidate["fields"]) {
	let best = 0;
	let hitText = false;
	for (const f of fields) {
		for (const w of f.words) {
			const score =
				w === token
					? WEIGHT[f.source] + 1
					: w.startsWith(token)
						? WEIGHT[f.source]
						: token.length >= 4 && w.includes(token)
							? 0.5
							: 0;
			if (score > best) best = score;
			if (score > 0 && f.source === "text") hitText = true;
		}
	}
	return { best, hitText };
}

function candidates(c: SettingContext): Candidate[] {
	const out: Candidate[] = [];
	let order = 0;
	const push = (
		key: string,
		label: string,
		where: readonly string[],
		keywords: readonly string[],
		text: readonly string[],
		needsText: boolean,
		result: Omit<SettingResult, "key" | "label" | "where">,
	) => {
		out.push({
			key,
			order: order++,
			label,
			needsText,
			fields: [
				{ source: "label", words: words(label) },
				{ source: "keyword", words: keywords.flatMap(words) },
				{ source: "text", words: text.flatMap(words) },
				{ source: "where", words: where.flatMap(words) },
			],
			result: { key, label, where, ...result },
		});
	};

	for (const s of PRODUCT_SETTING_INDEX) {
		if (!s.applies(c)) continue;
		const label = resolve(s.label, c);
		const where = resolve(s.where, c);
		const blocked = s.blocked?.(c) ?? null;
		const target = resolve(s.target, c);
		const section = resolve(s.section, c);
		const opens = resolve(s.opens ?? [], c);
		const landing = { blocked, section, opens };
		push(s.id, label, where, s.keywords, [], false, {
			...landing,
			target: blocked ? section : target,
		});
		if (s.perChoice && resolve(s.perChoice, c)) {
			c.choices.forEach((choice, i) => {
				if (choice.trim().length === 0) return;
				push(
					`${s.id}:${i}`,
					`${s.choiceLabel ?? label} · ${choice}`,
					where,
					s.keywords,
					[choice],
					true,
					{ ...landing, target: blocked ? section : forChoice(target, i) },
				);
			});
		}
	}

	// What the seller wrote — a question, a category — finds the place it
	// lives, so "candle" works as well as a field name. A choice's own name
	// needs no entry of its own: the per-choice instances above already list
	// under it, its price first.
	if (notBooking(c)) {
		c.buyerQuestions.forEach((q, i) => {
			if (q.trim().length === 0) return;
			push(
				`question:${i}`,
				`“${q.trim()}”`,
				["At checkout", "Do buyers answer any questions?"],
				[],
				[q],
				true,
				{
					blocked: null,
					target: ROW.questions,
					section: ROW.questions,
					opens: [],
				},
			);
		});
	}
	c.categoryNames.forEach((name, i) => {
		push(
			`category:${i}`,
			name,
			["Publishing", "Where does it show?", "Categories"],
			[],
			[name],
			true,
			{
				blocked: null,
				target: field("categories"),
				section: ROW.where,
				opens: [],
			},
		);
	});
	return out;
}

/**
 * Every place a result could land for this product — each entry, each
 * per-choice instance, each thing the seller wrote. What the form test walks
 * to prove every target is really rendered.
 */
export function everySettingLanding(c: SettingContext): SettingResult[] {
	return candidates(c).map((cand) => cand.result);
}

/**
 * The results for a query, best first. Every word of the query has to match
 * something (prefix of a word, so "prep" finds "Prep time"); an empty query
 * returns nothing, so the page is untouched until the seller types.
 */
export function searchSettings(
	c: SettingContext,
	query: string,
): SettingResult[] {
	const tokens = words(query);
	if (tokens.length === 0) return [];
	const folded = tokens.join(" ");
	const scored: Array<{ score: number; order: number; r: SettingResult }> = [];
	for (const cand of candidates(c)) {
		let score = 0;
		let namedText = false;
		let all = true;
		for (const t of tokens) {
			const { best, hitText } = tokenScore(t, cand.fields);
			if (best === 0) {
				all = false;
				break;
			}
			score += best;
			namedText ||= hitText;
		}
		if (!all || (cand.needsText && !namedText)) continue;
		if (foldText(cand.label).startsWith(folded)) score += 2;
		scored.push({ score, order: cand.order, r: cand.result });
	}
	return scored
		.sort((a, b) => b.score - a.score || a.order - b.order)
		.map((s) => s.r);
}
