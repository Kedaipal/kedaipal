// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useMutation } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARCEL_WEIGHTS_BATCH_MAX } from "../../../convex/lib/weightPricing";
import { ParcelWeightsFill, weightDraftState } from "./parcel-weights-fill";

/**
 * Products → Parcel weights (23 Oct 2026): the bulk fill. Every state is
 * designed — loading, empty, one row, many rows with fill-all and per-product
 * fill, a save that batches, a save that fails, and read-only.
 */
vi.mock("convex/react");
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params: _params,
		...props
	}: Record<string, unknown> & { to?: string; params?: unknown }) => (
		<a href={to} {...props} />
	),
}));

type Product = {
	productId: string;
	name: string;
	choices: Array<{ variantId: string; label: string }>;
};

let products: Product[] | undefined;
let setParcelWeights: ReturnType<typeof vi.fn>;

beforeEach(() => {
	products = undefined;
	setParcelWeights = vi.fn(async ({ weights }: { weights: unknown[] }) => ({
		updated: weights.length,
	}));
	vi.mocked(useQuery).mockImplementation((() => ({
		data: products,
		isPending: products === undefined,
	})) as never);
	vi.mocked(useMutation).mockImplementation((() => setParcelWeights) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function fill(props: Partial<Parameters<typeof ParcelWeightsFill>[0]> = {}) {
	return render(
		<ParcelWeightsFill
			retailerId={"rt_1" as never}
			reason="courier"
			readOnly={false}
			readOnlyReason=""
			{...props}
		/>,
	);
}

const tees: Product = {
	productId: "p_tee",
	name: "Oversized Tee",
	choices: [
		{ variantId: "v_s", label: "S" },
		{ variantId: "v_m", label: "M" },
		{ variantId: "v_l", label: "L" },
	],
};
const mug: Product = {
	productId: "p_mug",
	name: "Mug",
	choices: [{ variantId: "v_mug", label: "Mug" }],
};

const box = (name: RegExp) =>
	screen.getByRole("textbox", { name }) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /^save/i });

describe("weightDraftState", () => {
	it("blank, ok, and the three ways to be wrong", () => {
		expect(weightDraftState(undefined)).toEqual({ kind: "blank" });
		expect(weightDraftState("  ")).toEqual({ kind: "blank" });
		expect(weightDraftState("250")).toEqual({ kind: "ok", grams: 250 });
		expect(weightDraftState("0").kind).toBe("bad");
		expect(weightDraftState("1000001").kind).toBe("bad");
	});
});

describe("states", () => {
	it("loads with a skeleton, never a flash of 'every product is weighed'", () => {
		const { container } = fill();
		expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
		expect(container.textContent).not.toContain("Every product is weighed");
	});

	it("empty: says every product is weighed and offers the way back", () => {
		products = [];
		const { container } = fill();
		expect(container.textContent).toContain("Every product is weighed");
		expect(
			screen
				.getByRole("link", { name: /back to products/i })
				.getAttribute("href"),
		).toBe("/app/products");
	});

	it("one row: no fill-all, no per-product fill — just the box and the save", () => {
		products = [mug];
		fill();
		expect(screen.queryByLabelText(/fill every empty box/i)).toBeNull();
		expect(screen.queryByRole("button", { name: /^fill all/i })).toBeNull();
		expect(box(/mug/i)).toBeTruthy();
		expect(saveButton().textContent).toContain("1 across 1 product");
	});

	it("says WHY in the reason's words — the courier store hears about the floor", () => {
		products = [mug];
		const courier = fill({ reason: "courier" });
		expect(courier.container.textContent).toContain(
			"Your couriers price by weight.",
		);
		expect(courier.container.textContent).toContain("1 kg parcel");
		cleanup();
		products = [mug];
		const none = fill({ reason: null });
		expect(none.container.textContent).toContain("these are optional");
	});

	it("read-only: every box and the save are greyed with the reason", () => {
		products = [mug];
		const { container } = fill({
			readOnly: true,
			readOnlyReason: "Ask the store owner for edit access to change products.",
		});
		expect(box(/mug/i).disabled).toBe(true);
		expect(saveButton().hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain(
			"Ask the store owner for edit access",
		);
	});
});

describe("many rows — the bulk affordances", () => {
	beforeEach(() => {
		products = [tees, mug];
	});

	it("the save says what it will do, and stays off until a weight is typed", () => {
		fill();
		const save = saveButton();
		expect(save.hasAttribute("disabled")).toBe(true);
		expect(save.textContent).toContain("4 across 2 products");
		fireEvent.change(box(/oversized tee — s/i), { target: { value: "220" } });
		expect(saveButton().hasAttribute("disabled")).toBe(false);
		expect(saveButton().textContent).toContain("Save 1 of 4 weights");
	});

	it("fill-all fills only the EMPTY boxes — a typed weight is never overwritten", () => {
		fill();
		fireEvent.change(box(/oversized tee — l/i), { target: { value: "300" } });
		fireEvent.change(screen.getByLabelText(/fill every empty box/i), {
			target: { value: "250" },
		});
		fireEvent.click(screen.getByRole("button", { name: /fill 3 empty/i }));
		expect(box(/oversized tee — s/i).value).toBe("250");
		expect(box(/oversized tee — m/i).value).toBe("250");
		expect(box(/oversized tee — l/i).value).toBe("300");
		expect(box(/^parcel weight in grams for mug/i).value).toBe("250");
		expect(saveButton().textContent).toContain("Save 4 of 4 weights");
	});

	it("per-product fill touches that product's empty boxes and no one else's", () => {
		fill();
		fireEvent.change(
			screen.getByRole("textbox", {
				name: /fill every empty weight for oversized tee/i,
			}),
			{ target: { value: "240" } },
		);
		fireEvent.click(screen.getByRole("button", { name: /fill all 3/i }));
		expect(box(/oversized tee — s/i).value).toBe("240");
		expect(box(/^parcel weight in grams for mug/i).value).toBe("");
	});

	it("a bad box is marked, explained, and blocks the save until fixed", () => {
		const { container } = fill();
		fireEvent.change(box(/oversized tee — s/i), { target: { value: "0" } });
		expect(box(/oversized tee — s/i).getAttribute("aria-invalid")).toBe("true");
		expect(container.textContent).toContain("Has to be above 0 g.");
		expect(saveButton().hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain("Fix the box marked in red");
	});

	it("saves the typed rows in one call and says how many", async () => {
		const { toast } = await import("sonner");
		fill();
		fireEvent.change(box(/oversized tee — s/i), { target: { value: "220" } });
		fireEvent.change(box(/^parcel weight in grams for mug/i), {
			target: { value: "400" },
		});
		fireEvent.click(saveButton());
		await waitFor(() => expect(setParcelWeights).toHaveBeenCalledTimes(1));
		expect(setParcelWeights).toHaveBeenCalledWith({
			retailerId: "rt_1",
			weights: [
				{ variantId: "v_s", parcelWeightG: 220 },
				{ variantId: "v_mug", parcelWeightG: 400 },
			],
		});
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("2 parcel weights saved"),
		);
	});

	it("a catalogue past the batch bound saves in bounded batches", async () => {
		products = [
			{
				productId: "p_big",
				name: "Big",
				choices: Array.from(
					{ length: PARCEL_WEIGHTS_BATCH_MAX + 1 },
					(_, i) => ({
						variantId: `v_${i}`,
						label: `Choice ${i}`,
					}),
				),
			},
		];
		fill();
		fireEvent.change(screen.getByLabelText(/fill every empty box/i), {
			target: { value: "100" },
		});
		fireEvent.click(screen.getByRole("button", { name: /fill .* empty/i }));
		fireEvent.click(saveButton());
		await waitFor(() => expect(setParcelWeights).toHaveBeenCalledTimes(2));
		expect(setParcelWeights.mock.calls[0][0].weights).toHaveLength(
			PARCEL_WEIGHTS_BATCH_MAX,
		);
		expect(setParcelWeights.mock.calls[1][0].weights).toHaveLength(1);
	});

	it("a failed save keeps the typed rows and says so, as a sentence", async () => {
		setParcelWeights.mockRejectedValueOnce(
			new Error(
				"[CONVEX M(products:setParcelWeights)] [Request ID: x] Server Error\nUncaught ConvexError: One of these choices isn't in your store any more — reload and try again.",
			),
		);
		fill();
		fireEvent.change(box(/oversized tee — s/i), { target: { value: "220" } });
		fireEvent.click(saveButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("isn't in your store any more");
		expect(alert.textContent).not.toContain("Request ID");
		expect(box(/oversized tee — s/i).value).toBe("220");
	});
});
