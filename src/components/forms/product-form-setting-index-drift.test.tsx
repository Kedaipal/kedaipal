// @vitest-environment jsdom
/**
 * "Find a setting" can't drift from the form it searches (z8r3fdwwy3).
 *
 * The index is data, so nothing ties it to the page except this test. For
 * each kind of product it renders the REAL form, takes the context the form
 * itself hands the search, opens every collapsed section, and pins both
 * directions:
 *
 * - every place a result can land is on the page (a renamed id or a moved
 *   field fails here, not in a seller's hands);
 * - every searchable anchor and every question row on the page is in the
 *   index (a new field or row can't ship unsearchable).
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE_PANEL_ATTR, REVEAL_EVENT } from "../ui/question-row";
import {
	everySettingLanding,
	PRODUCT_SETTING_INDEX,
	SETTING_ATTR,
	type SettingContext,
} from "./product-setting-index";
import { LAZY_DISCLOSURE_ATTR } from "./reveal-setting";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
// Every read under the form is a list (pickup points, categories); empty
// lists render each section's own empty state, anchors included.
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: [], isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		...rest
	}: {
		to: string;
		children: React.ReactNode;
	}) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));
// The context the form builds for the search, captured as rendered.
let captured: SettingContext | undefined;
vi.mock("./setting-search", () => ({
	SettingSearch: ({ context }: { context: SettingContext }) => {
		captured = context;
		return null;
	},
}));

import { ProductForm } from "./product-form";

beforeEach(() => {
	captured = undefined;
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

type Props = Parameters<typeof ProductForm>[0];
type Initial = NonNullable<Props["initialValues"]>;

const WEEK = 7 * 24 * 60 * 60 * 1000;
const SIZES = {
	options: [{ name: "Size", values: ["Small", "Large"] }],
	variants: [
		{
			optionValues: ["Small"],
			price: 1200,
			promoPrice: 1000,
			onHand: 5,
			active: true,
			blockWhenOutOfStock: true,
		},
		{
			optionValues: ["Large"],
			price: 1800,
			onHand: 5,
			active: true,
			blockWhenOutOfStock: true,
		},
	],
};

const FIXTURES: Array<{
	name: string;
	initial: Partial<Initial>;
	props?: Partial<Props>;
}> = [
	{ name: "one item, nothing switched on", initial: {} },
	{
		name: "choices, on sale, custom orders and questions on",
		initial: {
			...SIZES,
			variants: [
				...SIZES.variants,
				{
					optionValues: [],
					price: 5000,
					onHand: 0,
					isCustom: true,
					customLabel: "Custom size",
				},
			],
			promo: { label: "Raya", endsAt: Date.now() + WEEK },
			buyerQuestions: [
				{ id: "q1", label: "Which candle colour?", type: "text" },
			],
		},
	},
	{
		name: "an event",
		initial: { event: { date: Date.now() + WEEK } },
	},
	{
		name: "weights required by a courier, with choices",
		initial: SIZES,
		props: { weightPricing: "courier" },
	},
	{
		name: "made to order",
		initial: {
			variants: [
				{
					optionValues: [],
					price: 0,
					onHand: 0,
					active: true,
					isCustom: true,
					requiresProof: true,
				},
			],
		},
	},
	{
		name: "a stay with a weekend rate",
		initial: { kind: "booking", capacityPerNight: "5", weekendPrice: "80" },
	},
	{
		name: "a day package counting only open days",
		initial: {
			kind: "booking",
			packageLength: "10",
			packageUnit: "day",
			skipsClosedDays: true,
		},
	},
	{
		name: "self-collect off, every plan feature locked",
		initial: {},
		props: {
			offerSelfCollect: false,
			promoLocked: true,
			eventsLocked: true,
			categoriesLocked: true,
		},
	},
];

function renderForm(initial: Partial<Initial>, props: Partial<Props> = {}) {
	return render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			submitLabel="Save"
			mode="edit"
			onSubmit={vi.fn(async () => {})}
			{...props}
			initialValues={{
				name: "Brownies",
				variants: [
					{
						optionValues: [],
						price: 1200,
						onHand: 5,
						active: true,
						blockWhenOutOfStock: true,
					},
				],
				...initial,
			}}
		/>,
	);
}

/** Open the Advanced box, then every hidden panel, until nothing is closed. */
function openEverything(root: HTMLElement) {
	for (let round = 0; round < 6; round++) {
		act(() => {
			for (const el of root.querySelectorAll(`[${LAZY_DISCLOSURE_ATTR}]`))
				el.dispatchEvent(new CustomEvent(REVEAL_EVENT));
			for (const el of root.querySelectorAll(
				`[${DISCLOSURE_PANEL_ATTR}][hidden]`,
			))
				el.dispatchEvent(new CustomEvent(REVEAL_EVENT));
		});
	}
	expect(
		root.querySelectorAll(`[${DISCLOSURE_PANEL_ATTR}][hidden]`),
	).toHaveLength(0);
}

const INDEX_IDS = new Set(PRODUCT_SETTING_INDEX.map((s) => s.id));

describe.each(FIXTURES)("$name", ({ initial, props }) => {
	it("every place a result can land is on the page", () => {
		const { container } = renderForm(initial, props);
		openEverything(container);
		const ctx = captured;
		expect(ctx).toBeDefined();
		if (!ctx) return;
		const missing = everySettingLanding(ctx)
			.filter(
				(r) =>
					container.querySelector(r.target) === null ||
					container.querySelector(r.section) === null,
			)
			.map((r) => `${r.key} → ${r.target}`);
		expect(missing).toEqual([]);
	});

	it("every searchable anchor and question row on the page is in the index", () => {
		const { container } = renderForm(initial, props);
		openEverything(container);
		const ctx = captured;
		if (!ctx) throw new Error("the form never rendered the search");
		const unknownAnchors = [...container.querySelectorAll(`[${SETTING_ATTR}]`)]
			.map((el) => el.getAttribute(SETTING_ATTR) ?? "")
			.filter((id) => !INDEX_IDS.has(id));
		expect(unknownAnchors).toEqual([]);

		const landed = new Set(
			everySettingLanding(ctx).flatMap((r) => [r.target, r.section]),
		);
		const rowsWithoutEntry = [...container.querySelectorAll("li[id]")]
			.map((li) => `#${li.id}`)
			.filter((id) => id.startsWith("#product-") && !landed.has(id));
		expect(rowsWithoutEntry).toEqual([]);
	});
});
