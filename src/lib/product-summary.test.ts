import { describe, expect, it } from "vitest";
import {
	describeProduct,
	isSecurityDepositInRange,
	securityDepositRangeMessage,
	type SummaryInput,
	weekendRateConsequence,
} from "./product-summary";

function row(
	partial: Partial<SummaryInput["rows"][number]> = {},
): SummaryInput["rows"][number] {
	return {
		optionValues: [],
		price: "10",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		...partial,
	};
}

describe("describeProduct", () => {
	it("an event leads the summary — it changes what the product IS", () => {
		// 5 Jan 2099 MYT midnight (UTC+8).
		const date = Date.UTC(2099, 0, 4, 16, 0, 0);
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "18.00" })],
					customLine: null,
					event: { date, timeMinutes: 480, seats: 30 },
				},
				"MYR",
			).startsWith("Event · "),
		).toBe(true);
	});

	it("describes a single tracked item with one price", () => {
		expect(
			describeProduct(
				{ options: [], rows: [row({ price: "18.00" })], customLine: null },
				"MYR",
			),
		).toBe("One item · From stock · RM\u00a018");
	});

	it("describes the ICP case: choices by Size, made fresh, price range", () => {
		expect(
			describeProduct(
				{
					options: [{ name: "Size", values: ["S", "M", "L"] }],
					rows: [
						row({
							optionValues: ["S"],
							price: "12",
							blockWhenOutOfStock: false,
						}),
						row({
							optionValues: ["M"],
							price: "18",
							blockWhenOutOfStock: false,
						}),
						row({
							optionValues: ["L"],
							price: "28.50",
							blockWhenOutOfStock: false,
						}),
					],
					customLine: null,
				},
				"MYR",
			),
		).toBe("3 choices by Size · Made fresh · RM\u00a012–28.50");
	});

	it("joins two axes with × and flags mixed fulfilment", () => {
		expect(
			describeProduct(
				{
					options: [
						{ name: "Size", values: ["S", "M"] },
						{ name: "Flavour", values: ["Pandan"] },
					],
					rows: [
						row({ optionValues: ["S", "Pandan"] }),
						row({
							optionValues: ["M", "Pandan"],
							blockWhenOutOfStock: false,
						}),
					],
					customLine: null,
				},
				"MYR",
			),
		).toBe("2 choices by Size × Flavour · Mixed fulfilment · RM\u00a010");
	});

	it("ignores deactivated rows for fulfilment and price", () => {
		expect(
			describeProduct(
				{
					options: [{ name: "Size", values: ["S", "M"] }],
					rows: [
						row({ optionValues: ["S"], price: "12" }),
						row({
							optionValues: ["M"],
							price: "99",
							active: false,
							blockWhenOutOfStock: false,
						}),
					],
					customLine: null,
				},
				"MYR",
			),
		).toBe("2 choices by Size · From stock · RM\u00a012");
	});

	it("notes a missing price and a custom line", () => {
		expect(
			describeProduct(
				{ options: [], rows: [row({ price: "" })], customLine: { price: "" } },
				"MYR",
			),
		).toBe("One item · From stock · No price yet · + custom option");
	});
});

describe("describeProduct — made-to-order products (86eyfq04j)", () => {
	// One never-out-of-stock, approval-gated row and no axes: the product IS the
	// custom order, so "One item · Made fresh · No price yet" would frame all
	// three as unfinished setup rather than the deliberate shape it is.
	const madeToOrder = {
		options: [],
		rows: [row({ price: "", blockWhenOutOfStock: false, requiresProof: true })],
		customLine: null,
	};

	it("reads as a quote, not as a missing price", () => {
		expect(describeProduct(madeToOrder, "MYR")).toBe(
			"Made to order · Price on quote",
		);
	});

	it("shows a typed price as the price, not a floor", () => {
		expect(
			describeProduct(
				{ ...madeToOrder, rows: [{ ...madeToOrder.rows[0], price: "120" }] },
				"MYR",
			),
		).toBe("Made to order · RM\u00a0120");
	});

	// The shape the editor's "Made to order" mode actually writes: no matrix at
	// all, the product IS its bespoke line (86eyhn4mr).
	it("prices the bespoke line as a floor, matching the storefront's From", () => {
		expect(
			describeProduct(
				{ options: [], rows: [], customLine: { price: "40" } },
				"MYR",
			),
		).toBe("Made to order · From RM\u00a040");
	});

	it("still reads as a quote when the bespoke line has no price", () => {
		expect(
			describeProduct(
				{ options: [], rows: [], customLine: { price: "" } },
				"MYR",
			),
		).toBe("Made to order · Price on quote");
	});

	it("leaves an ordinary made-fresh item alone", () => {
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "12", blockWhenOutOfStock: false })],
					customLine: null,
				},
				"MYR",
			),
		).toBe("One item · Made fresh · RM\u00a012");
	});

	it("speaks booking vocabulary for a booking listing", () => {
		// Booking bundle S1 (86eyn4kap): capacity + per-night price, never stock
		// words or choice counts — those concepts don't exist on this kind.
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "80", blockWhenOutOfStock: false })],
					customLine: null,
					booking: { capacityPerNight: "5" },
				},
				"MYR",
			),
		).toBe("Booking · 5 spots/night · RM\u00a080/night");
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "", blockWhenOutOfStock: false })],
					customLine: null,
					booking: { capacityPerNight: "1" },
				},
				"MYR",
			),
		).toBe("Booking · 1 spot/night · No price yet");
	});
});

describe("describeProduct — weekend rate (S13)", () => {
	it("names the second rate by its nights, after the base price", () => {
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "80", blockWhenOutOfStock: false })],
					customLine: null,
					booking: {
						capacityPerNight: "5",
						weekendPrice: "120",
						weekendDays: [5, 6],
					},
				},
				"MYR",
			),
		).toBe("Booking · 5 spots/night · RM\u00a080/night · RM\u00a0120 Fri & Sat");
	});

	it("a package never shows it — one flat price", () => {
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "150", blockWhenOutOfStock: false })],
					customLine: null,
					booking: {
						capacityPerNight: "",
						packageLength: "30",
						weekendPrice: "120",
						weekendDays: [5, 6],
					},
				},
				"MYR",
			),
		).toBe("Booking · 30-day package · Unlimited spots · RM\u00a0150/30 days");
	});

	it("blank rate or no nights adds nothing", () => {
		const base = {
			options: [],
			rows: [row({ price: "80", blockWhenOutOfStock: false })],
			customLine: null,
		};
		expect(
			describeProduct(
				{ ...base, booking: { capacityPerNight: "1", weekendPrice: "" } },
				"MYR",
			),
		).toBe("Booking · 1 spot/night · RM\u00a080/night");
		expect(
			describeProduct(
				{
					...base,
					booking: { capacityPerNight: "1", weekendPrice: "120", weekendDays: [] },
				},
				"MYR",
			),
		).toBe("Booking · 1 spot/night · RM\u00a080/night");
	});
});

describe("weekendRateConsequence", () => {
	it("states which nights charge what, in the store's currency", () => {
		expect(
			weekendRateConsequence(
				{ basePrice: "80", weekendPrice: "120", weekendDays: [5, 6] },
				"MYR",
			),
		).toBe("Fri and Sat nights charge RM\u00a0120, other nights RM\u00a080.");
		expect(
			weekendRateConsequence(
				{ basePrice: "", weekendPrice: "45.50", weekendDays: [0] },
				"SGD",
			),
		).toBe("Sun nights charge S$\u00a045.50.");
	});

	it("is silent when blank, and explains an empty or full night set", () => {
		expect(
			weekendRateConsequence(
				{ basePrice: "80", weekendPrice: "", weekendDays: [5, 6] },
				"MYR",
			),
		).toBeNull();
		expect(
			weekendRateConsequence(
				{ basePrice: "80", weekendPrice: "120", weekendDays: [] },
				"MYR",
			),
		).toMatch(/at least one night/);
		expect(
			weekendRateConsequence(
				{
					basePrice: "80",
					weekendPrice: "120",
					weekendDays: [0, 1, 2, 3, 4, 5, 6],
				},
				"MYR",
			),
		).toMatch(/every night/);
	});
});

describe("describeProduct — a package names its UNIT (hotfix to #280)", () => {
	// The strip was written when every package was days. After units shipped
	// it kept saying "1-day package … per package" on a 1-month membership —
	// on the edit page, that reads exactly like the unit silently reverting.
	const base = {
		options: [],
		rows: [row({ price: "100", blockWhenOutOfStock: false })],
		customLine: null,
	};

	it("a monthly membership says month, at a time, per month", () => {
		expect(
			describeProduct(
				{
					...base,
					booking: {
						capacityPerNight: "1",
						packageLength: "1",
						packageUnit: "month",
					},
				},
				"MYR",
			),
		// The strip wears the store's symbol — this case once pinned the raw
		// ISO code ("MYR 100/month") as correct.
		).toBe("Booking · 1-month package · 1 at a time · RM 100/month");
	});

	it("a multi-month package pluralises the price span, not the adjective", () => {
		expect(
			describeProduct(
				{
					...base,
					booking: {
						capacityPerNight: "20",
						packageLength: "3",
						packageUnit: "month",
					},
				},
				"MYR",
			),
		).toBe("Booking · 3-month package · 20 at a time · RM\u00a0100/3 months");
	});

	it("a night package says nights", () => {
		expect(
			describeProduct(
				{
					...base,
					booking: {
						capacityPerNight: "2",
						packageLength: "2",
						packageUnit: "night",
					},
				},
				"MYR",
			),
		).toBe("Booking · 2-night package · 2 at a time · RM\u00a0100/2 nights");
	});

	it("no stored unit reads as days — the pre-units default isMonthlyUnit uses", () => {
		expect(
			describeProduct(
				{
					...base,
					booking: { capacityPerNight: "5", packageLength: "7" },
				},
				"MYR",
			),
		).toBe("Booking · 7-day package · 5 at a time · RM\u00a0100/7 days");
	});

	it("a free-range stay is untouched — still per night", () => {
		expect(
			describeProduct(
				{
					...base,
					booking: { capacityPerNight: "5", packageUnit: "month" },
				},
				"MYR",
			),
		).toBe("Booking · 5 spots/night · RM\u00a0100/night");
	});

	it("never says 'per package' again", () => {
		for (const packageUnit of ["day", "night", "month"] as const) {
			const out = describeProduct(
				{
					...base,
					booking: { capacityPerNight: "", packageLength: "1", packageUnit },
				},
				"MYR",
			);
			expect(out).not.toMatch(/per package|-day package.*month/);
		}
	});
});

describe("security deposit ceiling — shared by the wizard and the edit form", () => {
	const NB = "\u00a0";

	it("the bounds are the server's own (0 … 10,000 in major units)", () => {
		expect(isSecurityDepositInRange(0)).toBe(true);
		expect(isSecurityDepositInRange(10_000)).toBe(true);
		expect(isSecurityDepositInRange(10_000.01)).toBe(false);
		expect(isSecurityDepositInRange(-1)).toBe(false);
		// Unparseable input is out, never silently "no deposit".
		expect(isSecurityDepositInRange(null)).toBe(false);
	});

	it("the message names the store's own symbol — both forms hardcoded RM", () => {
		expect(securityDepositRangeMessage("SGD")).toBe(
			`Enter an amount between S$${NB}0 and S$${NB}10,000, or leave blank.`,
		);
		expect(securityDepositRangeMessage("MYR")).toBe(
			`Enter an amount between RM${NB}0 and RM${NB}10,000, or leave blank.`,
		);
	});

	it("without a currency it names the numbers alone rather than guess a symbol", () => {
		expect(securityDepositRangeMessage()).toBe(
			"Enter an amount between 0 and 10,000, or leave blank.",
		);
	});
});

describe("describeProduct — an SG store reads S$, never SGD", () => {
	it("a price range", () => {
		const summary = describeProduct(
			{
				options: [{ name: "Size", values: ["S", "L"] }],
				rows: [
					{ optionValues: ["S"], price: "12", active: true, blockWhenOutOfStock: true, requiresProof: false },
					{ optionValues: ["L"], price: "28.50", active: true, blockWhenOutOfStock: true, requiresProof: false },
				],
				customLine: null,
			},
			"SGD",
		);
		expect(summary).toContain("S$\u00a012–28.50");
		expect(summary).not.toMatch(/SGD/);
	});
});
