// @vitest-environment jsdom
/**
 * The product forms speak the store's money, never its ISO code.
 *
 * All three forms take `currency` as the retailer's ISO code ("MYR", "SGD")
 * and used to print it raw: sellers read "MYR 12" and "Price (MYR)" where
 * every other dashboard surface says "RM 12", and an SG store read "SGD" for
 * "S$". Every render test in this folder passed a fake `currency="RM"`, which
 * `currencySymbol` echoes back unchanged — so the bug was invisible to the
 * suite. These render with REAL codes and assert, page-wide, that neither
 * code ever reaches the seller.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
	Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

import { ProductForm } from "./product-form";
import { emptyWizardState, ProductWizard, type WizardState } from "./product-wizard";
import { emptyRow, VariantEditor, type VariantEditorState } from "./variant-editor";

afterEach(cleanup);

const NB = " ";

/**
 * Testing Library normalizes the PAGE's whitespace (a non-breaking space
 * reads as a plain one) but compares a string matcher as written — so
 * `getByText` takes plain spaces, and the non-breaking space `formatPrice`
 * uses (it keeps "RM" and the amount on one line) is asserted on the raw
 * text instead.
 */
function expectRawText(fragment: string) {
	expect(document.body.textContent ?? "").toContain(fragment);
}

/** The seller must never read the raw code — anywhere on the page. */
function expectNoIsoCode() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(/\bMYR\b/);
	expect(text).not.toMatch(/\bSGD\b/);
}

function renderWizard(currency: string, initialState: WizardState) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			currency={currency}
			initialState={initialState}
			onSubmit={vi.fn() as never}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
		/>,
	);
}

/** A stay with a name and a deposit too big to save — opens on its pricing
 * step (the first one still owing an answer). */
function stayDraft(overrides: Partial<WizardState> = {}): WizardState {
	return {
		...emptyWizardState("booking"),
		name: "Riverside plot",
		securityDeposit: "20000",
		...overrides,
	};
}

/** A one-price, from-stock item with every question answered — opens on
 * review. */
function answeredItem(price: string): WizardState {
	return {
		...emptyWizardState("physical"),
		name: "Kuih lapis",
		shape: "single",
		fulfilmentAnswered: true,
		editor: {
			options: [],
			customLine: null,
			rows: [{ ...emptyRow([]), price, stock: "5" }],
		},
	};
}

describe("wizard — money in the store's symbol", () => {
	it("an SG stay's pricing step wears S$ on every plate, and the deposit ceiling says S$", () => {
		renderWizard("SGD", stayDraft());
		expect(screen.getByText(/^Price per night$/)).toBeTruthy();
		expect(screen.getAllByText("S$").length).toBeGreaterThanOrEqual(2);
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));
		expect(
			screen.getByText(
				"Enter an amount between S$ 0 and S$ 10,000, or leave blank.",
			),
		).toBeTruthy();
		expectRawText(`S$${NB}0 and S$${NB}10,000`);
		expectNoIsoCode();
	});

	it("an MY stay's plates say RM", () => {
		renderWizard("MYR", stayDraft({ securityDeposit: "" }));
		expect(screen.getAllByText("RM").length).toBeGreaterThanOrEqual(2);
		expectNoIsoCode();
	});

	it("review spells the price like the summary strip — card preview and Price row alike", () => {
		renderWizard("MYR", answeredItem("1250"));
		// Grouped, symbol + non-breaking space, no ".00" — on the preview card
		// AND the summary row.
		expect(screen.getAllByText("RM 1,250").length).toBe(2);
		expectRawText(`RM${NB}1,250`);
		expectNoIsoCode();
		cleanup();
		renderWizard("SGD", answeredItem("12.5"));
		expect(screen.getAllByText("S$ 12.50").length).toBe(2);
		expectRawText(`S$${NB}12.50`);
		expectNoIsoCode();
	});
});

describe("edit form — money labels in the store's symbol", () => {
	function renderStay(currency: string, securityDeposit = "20000") {
		return render(
			<ProductForm
				retailerId={"r1" as never}
				categoriesLocked={false}
				eventsLocked={false}
				currency={currency}
				submitLabel="Save"
				onSubmit={vi.fn()}
				mode="edit"
				initialValues={{
					name: "Riverside plot",
					kind: "booking",
					capacityPerNight: "5",
					securityDeposit,
				}}
			/>,
		);
	}

	it("an SG stay's labels and deposit message say S$", () => {
		renderStay("SGD");
		expect(screen.getByText(/Price per night \(\s*S\$\)/)).toBeTruthy();
		expect(screen.getByText(/Weekend rate \(S\$\)/)).toBeTruthy();
		expect(screen.getByText(/Security deposit \(S\$\)/)).toBeTruthy();
		expect(
			screen.getByText(
				"Enter an amount between S$ 0 and S$ 10,000, or leave blank.",
			),
		).toBeTruthy();
		expectRawText(`S$${NB}0 and S$${NB}10,000`);
		expectNoIsoCode();
	});

	it("a deposit exactly at the server's ceiling is accepted, a sen over is not", () => {
		renderStay("MYR", "10000");
		expect(screen.queryByText(/Enter an amount between/)).toBeNull();
		cleanup();
		renderStay("MYR", "10000.01");
		expect(screen.getByText(/Enter an amount between RM/)).toBeTruthy();
		expectNoIsoCode();
	});
});

describe("variant editor — price labels in the store's symbol", () => {
	const choices: VariantEditorState = {
		options: [{ name: "Size", values: ["S", "L"] }],
		rows: [
			{ ...emptyRow(["S"]), price: "12" },
			{ ...emptyRow(["L"]), price: "18" },
		],
		customLine: null,
	};

	it("an SG store's choice grid says Price (S$)", () => {
		render(<VariantEditor value={choices} onChange={vi.fn()} currency="SGD" />);
		expect(screen.getAllByText(/Price \(S\$\)/).length).toBeGreaterThan(0);
		expectNoIsoCode();
	});

	it("an MY store's made-to-order line says Starting price (RM) and From RM", () => {
		render(
			<VariantEditor
				value={{
					options: [],
					rows: [],
					customLine: {
						label: "",
						price: "",
						prompt: "",
						imageStorageIds: [],
					},
				}}
				onChange={vi.fn()}
				currency="MYR"
			/>,
		);
		expect(screen.getAllByText(/Starting price \(RM\)/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/From RM …/).length).toBeGreaterThan(0);
		expectNoIsoCode();
	});
});
