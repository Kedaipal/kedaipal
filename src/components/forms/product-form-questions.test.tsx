// @vitest-environment jsdom
/**
 * The product form's question rows (z8r3fdv1z2). The core of the product —
 * name, photos, price — stays open; every optional capability is a collapsed
 * question whose line carries its answer. Pins:
 *
 * - which questions each KIND of product is asked, in which group and order;
 * - that every row opens collapsed, on every visit;
 * - that custom orders and mockup approval are questions of their own, not
 *   checkboxes in the price card's Advanced box;
 * - that mockup approval is tri-state, with the per-choice list beside it;
 * - that a refused save inside a collapsed row says so on its line and opens.
 */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
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

import { ProductForm, type ProductFormSubmitValues } from "./product-form";

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

type Initial = NonNullable<Parameters<typeof ProductForm>[0]["initialValues"]>;

function renderForm(
	initial: Partial<Initial> = {},
	onSubmit: (v: ProductFormSubmitValues) => Promise<void> = vi.fn(
		async () => {},
	),
) {
	return render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			submitLabel="Save"
			mode="edit"
			onSubmit={onSubmit}
			initialValues={{
				name: "Brownies",
				variants: [{ optionValues: [], price: 1200, onHand: 5, active: true }],
				...initial,
			}}
		/>,
	);
}

/** Every question row header, in DOM order, by group. */
function questionsIn(group: string): string[] {
	const region = screen.getByRole("region", { name: group });
	return within(region)
		.getAllByRole("button", { expanded: false })
		.map((b) => b.querySelector(".font-semibold")?.textContent ?? "");
}
const row = (q: RegExp) => screen.getByRole("button", { name: q });

const SIZES = {
	options: [{ name: "Size", values: ["Box of 6", "Box of 9"] }],
	variants: [
		{ optionValues: ["Box of 6"], price: 1200, onHand: 5, active: true },
		{
			optionValues: ["Box of 9"],
			price: 1800,
			onHand: 5,
			active: true,
			requiresProof: true,
		},
	],
};

describe("which questions each kind of product is asked", () => {
	it("a physical product: selling options, checkout, publishing — all collapsed", () => {
		renderForm();
		expect(questionsIn("Selling options")).toEqual([
			"Is it on sale right now?",
			"Is it a fixed-date event?",
			"Do you take custom requests on it?",
			"Does the buyer approve a mockup first?",
		]);
		expect(questionsIn("At checkout")).toEqual([
			"Do buyers answer any questions?",
			"Any rules on how it’s ordered?",
			"Anything to know when collecting?",
		]);
		expect(questionsIn("Publishing")).toEqual(["Where does it show?"]);
	});

	it("a stay listing: its own extras become questions; event, custom and pickup never appear", () => {
		renderForm({ kind: "booking", capacityPerNight: "5" });
		expect(questionsIn("Selling options")).toEqual([
			"Do weekend nights cost more?",
			"Is it on sale right now?",
			"Confirm bookings instantly?",
			"Take a refundable security deposit?",
		]);
		expect(questionsIn("At checkout")).toEqual([
			"How much notice do you need?",
		]);
		// What defines the stay stays open in its card.
		expect(
			document.getElementById("booking-capacity")?.closest("[hidden]"),
		).toBeNull();
	});

	it("a made-to-order product is not asked about custom orders or mockups — it IS both", () => {
		renderForm({
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
		});
		expect(questionsIn("Selling options")).toEqual([
			"Is it on sale right now?",
			"Is it a fixed-date event?",
		]);
	});
});

describe("custom orders and mockup approval are questions, not Advanced checkboxes", () => {
	it("the price card's Advanced box no longer carries either", () => {
		renderForm(SIZES);
		fireEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
		// The Advanced copy's own titles for the two capabilities.
		expect(screen.queryByText("Custom orders")).toBeNull();
		expect(screen.queryByText("Mockup approval")).toBeNull();
	});

	it("switching custom orders on adds the custom line to the save", async () => {
		const onSubmit = vi.fn<(v: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderForm({}, onSubmit);
		fireEvent.click(row(/Do you take custom requests on it/));
		fireEvent.click(
			screen.getByRole("switch", {
				name: "Offer custom orders on this product",
			}),
		);
		expect(row(/Do you take custom requests on it/).textContent).toContain(
			"Yes · “Custom” · price on quote",
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const [values] = onSubmit.mock.lastCall ?? [];
		expect(values?.variants.some((v) => v.isCustom)).toBe(true);
	});

	it("switching custom orders off and back on keeps the seller's line", () => {
		// Found in the hands-on test: off-then-on wiped "BTO", its price and
		// photo, where the event and promotion rows keep their drafts.
		renderForm({
			variants: [
				{ optionValues: [], price: 1200, onHand: 5, active: true },
				{
					optionValues: [],
					price: 4000,
					onHand: 0,
					active: true,
					isCustom: true,
					customLabel: "BTO",
				},
			],
		});
		const row0 = row(/Do you take custom requests on it/);
		expect(row0.textContent).toContain("“BTO” · from RM");
		fireEvent.click(row0);
		const toggle = screen.getByRole("switch", {
			name: "Offer custom orders on this product",
		});
		fireEvent.click(toggle);
		expect(row0.textContent).toContain("No");
		fireEvent.click(toggle);
		expect(row0.textContent).toContain("“BTO” · from RM");
	});

	it("mockup approval is tri-state, with the per-choice list it summarises", () => {
		renderForm(SIZES);
		expect(row(/Does the buyer approve a mockup first/).textContent).toContain(
			"For 1 of 2 choices",
		);
		fireEvent.click(row(/Does the buyer approve a mockup first/));
		const every = screen.getByRole("checkbox", { name: /Every choice/ });
		expect(every.getAttribute("aria-checked")).toBe("mixed");
		expect(
			(
				screen.getByRole("checkbox", {
					name: "Require mockup approval for Box of 9",
				}) as HTMLInputElement
			).checked,
		).toBe(true);

		fireEvent.click(every);
		expect(row(/Does the buyer approve a mockup first/).textContent).toContain(
			"Yes · every choice",
		);
		expect(
			(
				screen.getByRole("checkbox", {
					name: "Require mockup approval for Box of 6",
				}) as HTMLInputElement
			).checked,
		).toBe(true);
	});
});

describe("a refused save inside a collapsed row", () => {
	it("says so on the row's line and opens it", async () => {
		const onSubmit = vi.fn(async () => {});
		renderForm({ minQuantity: 20 }, onSubmit);
		const rules = row(/Any rules on how it.s ordered/);
		expect(rules.getAttribute("aria-expanded")).toBe("false");
		// Break the rule while the row is open, then close it again.
		fireEvent.click(rules);
		fireEvent.change(document.getElementById("min-order-qty") as HTMLElement, {
			target: { value: "2.5" },
		});
		fireEvent.click(rules);
		expect(rules.getAttribute("aria-expanded")).toBe("false");

		fireEvent.submit(document.querySelector("form") as HTMLFormElement);
		await vi.waitFor(() =>
			expect(rules.getAttribute("aria-expanded")).toBe("true"),
		);
		expect(rules.textContent).toContain("Needs a fix before you can save");
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
