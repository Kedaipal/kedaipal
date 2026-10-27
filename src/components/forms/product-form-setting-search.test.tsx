// @vitest-environment jsdom
/**
 * "Find a setting" on the real product form (z8r3fdwwy3), driven the way a
 * seller drives it. Pins:
 *
 * - a field inside the price card's Advanced box (closed, NOT rendered) and
 *   its folded per-choice list is reached in one pick, cursor in the field;
 * - a field inside a collapsed question row opens the row;
 * - a field that can't be used yet says why, and the pick lands on the
 *   switch that fixes it;
 * - zero results points to Settings; Esc clears; Enter never saves the
 *   product; "/" and the save bar's button bring the box back.
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
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

import { ProductForm } from "./product-form";

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

type Initial = NonNullable<Parameters<typeof ProductForm>[0]["initialValues"]>;

const SIZES: Partial<Initial> = {
	options: [{ name: "Size", values: ["Small", "Large"] }],
	variants: [
		{ optionValues: ["Small"], price: 1200, onHand: 5, active: true },
		{ optionValues: ["Large"], price: 1800, onHand: 5, active: true },
	],
};

function renderForm(
	initial: Partial<Initial> = {},
	onSubmit = vi.fn(async () => {}),
) {
	render(
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
	return onSubmit;
}

const box = () => screen.getByRole("combobox", { name: /find a setting/i });
function type(text: string) {
	fireEvent.focus(box());
	fireEvent.change(box(), { target: { value: text } });
}
const options = () =>
	within(screen.getByRole("listbox")).getAllByRole("option");

describe("finding a field", () => {
	it("lists the field with where it lives, best match first", () => {
		renderForm(SIZES);
		type("sku");
		const [top] = options();
		expect(top.textContent).toContain("SKU");
		expect(top.textContent).toContain(
			"Pricing & choices → Advanced → Per-choice details",
		);
	});

	it("reaches a choice's SKU inside the closed Advanced box in one pick", async () => {
		renderForm(SIZES);
		// Advanced starts closed on edit and renders nothing.
		expect(screen.queryByLabelText("SKU for Large")).toBeNull();
		type("large sku");
		fireEvent.keyDown(box(), { key: "Enter" });
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByLabelText("SKU for Large"),
			),
		);
		expect(
			screen.getByLabelText("SKU for Large").closest("[hidden]"),
		).toBeNull();
	});

	it("opens a collapsed question row to reach the field inside it", async () => {
		renderForm();
		const rules = screen.getByRole("button", {
			name: /any rules on how it’s ordered/i,
		});
		expect(rules.getAttribute("aria-expanded")).toBe("false");
		type("prep");
		fireEvent.click(options()[0]);
		await waitFor(() =>
			expect(document.activeElement?.id).toBe("prep-minutes"),
		);
		expect(rules.getAttribute("aria-expanded")).toBe("true");
	});

	it("finds a field by a Malay word", async () => {
		renderForm();
		type("berat");
		expect(options()[0].textContent).toContain("Parcel weight");
		fireEvent.keyDown(box(), { key: "Enter" });
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByLabelText("Parcel weight in grams for this product"),
			),
		);
	});
});

describe("a field that can't be used yet", () => {
	it("says why, and the pick lands on the switch that turns it on", async () => {
		renderForm();
		type("max per order");
		const [top] = options();
		expect(top.textContent).toContain("Turn on “Run a promotion” first");
		fireEvent.click(top);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("switch", { name: /run a promotion/i }),
			),
		);
	});
});

describe("the box itself", () => {
	it("zero results points to Settings, where store-wide rules live", () => {
		renderForm();
		type("zebra");
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(
			screen.getByText(/nothing called “zebra” on a product/i),
		).not.toBeNull();
		expect(
			screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
		).toBe("/app/settings");
	});

	it("Esc clears the search and closes the list", () => {
		renderForm();
		type("prep");
		expect(screen.getByRole("listbox")).not.toBeNull();
		fireEvent.keyDown(box(), { key: "Escape" });
		expect((box() as HTMLInputElement).value).toBe("");
		expect(screen.queryByRole("listbox")).toBeNull();
	});

	it("arrow keys move the highlighted result", () => {
		renderForm();
		type("minimum");
		expect(options()[0].getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(box(), { key: "ArrowDown" });
		expect(options()[1].getAttribute("aria-selected")).toBe("true");
		expect(box().getAttribute("aria-activedescendant")).toBe(options()[1].id);
		fireEvent.keyDown(box(), { key: "ArrowUp" });
		expect(options()[0].getAttribute("aria-selected")).toBe("true");
	});

	it("Enter in the search box never saves the product", async () => {
		const onSubmit = renderForm();
		type("zebra");
		fireEvent.keyDown(box(), { key: "Enter" });
		await act(async () => {});
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("“/” jumps to the box, but not while typing into a field", () => {
		renderForm();
		const name = screen.getByLabelText(/name/i, { selector: "input" });
		name.focus();
		fireEvent.keyDown(name, { key: "/" });
		expect(document.activeElement).toBe(name);
		name.blur();
		fireEvent.keyDown(document.body, { key: "/" });
		expect(document.activeElement).toBe(box());
	});

	it("the save bar's search button brings the box back from anywhere", () => {
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: "Find a setting" }));
		expect(document.activeElement).toBe(box());
	});

	it("coming back selects the last search, so typing starts a new one", () => {
		renderForm();
		type("prep");
		const input = box() as HTMLInputElement;
		input.blur();
		fireEvent.keyDown(document.body, { key: "/" });
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
		input.setSelectionRange(4, 4);
		input.blur();
		fireEvent.click(screen.getByRole("button", { name: "Find a setting" }));
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
	});
});
