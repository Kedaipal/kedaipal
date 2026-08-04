// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { StorefrontProduct } from "./product-card";
import {
	CustomOrderCard,
	GoToCheckoutBar,
	type OnAddVariant,
	OptionPills,
	PurchaseActions,
	useProductPurchase,
} from "./product-purchase";

// The buy box uses useMutation for the buyer's reference-image upload; stub it
// so the pieces render without a ConvexProvider.
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

afterEach(cleanup);

/**
 * The direct-to-checkout CTA (86eybhqye) — tested on the shared piece rather
 * than through a shell, since it's now rendered by the product PAGE (buyers)
 * and no longer by the seller-preview sheet.
 */
describe("GoToCheckoutBar", () => {
	it("hides when the cart is empty", () => {
		render(
			<GoToCheckoutBar
				cartItemCount={0}
				cartTotal={0}
				currency="MYR"
				onCheckout={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});

	it("shows count + total once the cart has items, and fires onCheckout", () => {
		const onCheckout = vi.fn();
		render(
			<GoToCheckoutBar
				cartItemCount={3}
				cartTotal={2500}
				currency="MYR"
				onCheckout={onCheckout}
			/>,
		);
		const cta = screen.getByRole("button", { name: /go to checkout/i });
		// Count badge + money total both live on the CTA (regex tolerates the NBSP
		// Intl inserts after the currency symbol).
		expect(cta.textContent).toMatch(/3/);
		expect(cta.textContent).toMatch(/RM\s*25\.00/);
		fireEvent.click(cta);
		expect(onCheckout).toHaveBeenCalledTimes(1);
	});

	it("omits the money amount for a quote-only cart (total 0) but keeps the CTA", () => {
		render(
			<GoToCheckoutBar
				cartItemCount={1}
				cartTotal={0}
				currency="MYR"
				onCheckout={vi.fn()}
			/>,
		);
		const cta = screen.getByRole("button", { name: /go to checkout/i });
		expect(cta).toBeTruthy();
		expect(cta.textContent).not.toMatch(/RM/);
	});

	it("hides when no onCheckout handler is wired", () => {
		render(
			<GoToCheckoutBar cartItemCount={3} cartTotal={3000} currency="MYR" />,
		);
		expect(
			screen.queryByRole("button", { name: /go to checkout/i }),
		).toBeNull();
	});
});

const RID = "r1" as unknown as Id<"retailers">;

/** Two sizes + a custom line, hard-block stock — the shape a live stock change
 * can move under a buyer who's mid-decision. */
function cake(onHandM: number): StorefrontProduct {
	return {
		_id: "p1",
		name: "Cake",
		slug: "cake",
		currency: "MYR",
		imageUrls: [],
		options: [{ name: "Size", values: ["S", "M"] }],
		priceFrom: 1000,
		priceTo: 1500,
		hasQuotePricing: true,
		inStock: true,
		totalOnHand: 3 + onHandM,
		variants: [
			{
				_id: "vS",
				optionValues: ["S"],
				onHand: 3,
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				price: 1000,
				imageUrls: [],
			},
			{
				_id: "vM",
				optionValues: ["M"],
				onHand: onHandM,
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				price: 1500,
				imageUrls: [],
			},
			{
				_id: "vC",
				optionValues: [],
				onHand: 0,
				active: true,
				blockWhenOutOfStock: false,
				requiresProof: true,
				price: 0,
				isCustom: true,
				customLabel: "Bespoke",
				customPrompt: "Tell us your theme",
				imageUrls: [],
			},
		],
	} as unknown as StorefrontProduct;
}

/** Minimal harness: the buy-box pieces a buyer actually fills in. */
function BuyBox({ product }: { product: StorefrontProduct }) {
	const pp = useProductPurchase({ product, retailerId: RID, cartQuantity: 0 });
	return (
		<>
			<OptionPills pp={pp} />
			<PurchaseActions pp={pp} onAdd={vi.fn()} />
			<CustomOrderCard pp={pp} onAdd={vi.fn()} />
		</>
	);
}

/**
 * The product PAGE feeds `useProductPurchase` a LIVE `getPublicBySlug` result,
 * so any write to the row or its variants — another buyer's order decrementing
 * stock, a seller price edit — hands the hook a brand-new object for the SAME
 * product. The reset must key on identity (`_id`), never the object, or an
 * in-flight buyer silently loses what they've entered. (The detail sheet was
 * immune by accident: it holds a snapshot in the caller's state.)
 */
describe("useProductPurchase — a live product update is not a new product", () => {
	it("keeps the buyer's option, quantity and custom note when stock moves under them", () => {
		const { rerender } = render(<BuyBox product={cake(2)} />);

		// Buyer picks M, steps to 2, and types their custom spec.
		fireEvent.click(screen.getByRole("button", { name: "M" }));
		fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
		const note = screen.getByPlaceholderText("Tell us your theme");
		fireEvent.change(note, { target: { value: "Two tiers, mint icing" } });
		expect(screen.getByText("2")).toBeTruthy();

		// Someone else's order lands: same product, one less M in stock.
		rerender(<BuyBox product={cake(1)} />);

		// Selection survives (the pill is still the selected one)…
		expect(screen.getByRole("button", { name: "M" }).className).toContain(
			"bg-accent",
		);
		// …the typed spec survives…
		expect((note as HTMLTextAreaElement).value).toBe("Two tiers, mint icing");
		// …and the quantity clamps to the new ceiling instead of resetting to 1.
		expect(screen.getByText("1")).toBeTruthy();
	});

	it("still resets everything when a DIFFERENT product opens", () => {
		const { rerender } = render(<BuyBox product={cake(2)} />);
		fireEvent.click(screen.getByRole("button", { name: "M" }));
		fireEvent.change(screen.getByPlaceholderText("Tell us your theme"), {
			target: { value: "Two tiers" },
		});

		const other = {
			...cake(2),
			_id: "p2",
			name: "Kuih box",
		} as StorefrontProduct;
		rerender(<BuyBox product={other} />);

		expect(screen.getByRole("button", { name: "M" }).className).not.toContain(
			"bg-accent",
		);
		expect(
			(screen.getByPlaceholderText("Tell us your theme") as HTMLTextAreaElement)
				.value,
		).toBe("");
	});
});

/** A made-to-order PRODUCT (86eyfq04j): no axes, no matrix — its ONE variant
 * IS the custom line, which is what gives it the request box for free. */
function bespokeService(): StorefrontProduct {
	return {
		_id: "p2",
		name: "Tent wash",
		slug: "tent-wash",
		currency: "MYR",
		imageUrls: [],
		options: [],
		priceFrom: 0,
		priceTo: 0,
		hasQuotePricing: true,
		inStock: true,
		totalOnHand: 0,
		variants: [
			{
				_id: "vMTO",
				optionValues: [],
				onHand: 0,
				active: true,
				blockWhenOutOfStock: false,
				requiresProof: true,
				price: 0,
				isCustom: true,
				customLabel: "Tent wash",
				customPrompt: "Tent size, model & how dirty",
				imageUrls: [],
			},
		],
	} as unknown as StorefrontProduct;
}

/**
 * Modelling the type as `isCustom` means it INHERITS the bespoke flow rather
 * than needing a parallel one: the request box, the qty-1 cart line, and the
 * "Choose" routing that stops a one-tap quick-add bypassing the brief.
 */
describe("made-to-order product — one bespoke line, existing flow", () => {
	function MtoBox({
		product,
		onAdd,
	}: {
		product: StorefrontProduct;
		onAdd: OnAddVariant;
	}) {
		const pp = useProductPurchase({
			product,
			retailerId: RID,
			cartQuantity: 0,
		});
		return (
			<>
				<CustomOrderCard pp={pp} onAdd={onAdd} />
				{/* The purchase bar's contents, exactly as both views render them. */}
				<PurchaseActions pp={pp} onAdd={onAdd} />
			</>
		);
	}

	it("asks for the brief once, through the custom card", () => {
		render(<MtoBox product={bespokeService()} onAdd={vi.fn()} />);
		expect(screen.getAllByText("Your request")).toHaveLength(1);
		// The seller's prompt is the placeholder — set in the type's own setup.
		expect(
			screen.getByPlaceholderText("Tent size, model & how dirty"),
		).toBeTruthy();
	});

	it("hides the standard buy box — there is no standard line to sell", () => {
		render(<MtoBox product={bespokeService()} onAdd={vi.fn()} />);
		// Would otherwise render permanently disabled as "Unavailable".
		expect(screen.queryByRole("button", { name: /add to cart/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /increase/i })).toBeNull();
	});

	/**
	 * The purchase bar is FIXED at the bottom on mobile. If `PurchaseActions`
	 * rendered nothing for this type, the buyer got a strip of empty chrome
	 * while the only CTA sat up the page, out of thumb reach — so the bar owns
	 * the CTA for every product type, and the card above never duplicates it.
	 */
	it("puts its CTA in the purchase bar, exactly once", () => {
		// MtoBox renders the card AND the bar; the card contributes no button for
		// this type, so a single match proves the bar is where the CTA lives.
		render(<MtoBox product={bespokeService()} onAdd={vi.fn()} />);
		expect(
			screen.getAllByRole("button", { name: /request custom order/i }),
		).toHaveLength(1);
	});

	/** A bespoke line beside a real catalog keeps its own in-card button, and
	 * the bar stays the standard buy box — one CTA each, no crossover. */
	it("keeps the in-card button when the line is only an extra", () => {
		render(<MtoBox product={cake(2)} onAdd={vi.fn()} />);
		expect(
			screen.getAllByRole("button", { name: /request custom order/i }),
		).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: /select options/i }),
		).toBeTruthy();
	});

	/** The page's h1 already carries the name, gallery and price — the card
	 * must not restate them as a second "Custom · Price on quote" item. */
	it("does not restate the product's own identity", () => {
		render(<MtoBox product={bespokeService()} onAdd={vi.fn()} />);
		expect(screen.queryByText("Price on quote")).toBeNull();
		// What the buyer doesn't know yet — the mockup gate — is stated instead.
		expect(screen.getByText(/approve a mockup/i)).toBeTruthy();
	});

	it("carries the brief and the reference photo on that add", () => {
		const onAdd = vi.fn();
		render(<MtoBox product={bespokeService()} onAdd={onAdd} />);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "  4-person dome, muddy  " },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /request custom order/i }),
		);
		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({ _id: "p2" }),
			expect.objectContaining({ _id: "vMTO", isCustom: true }),
			1,
			{ note: "4-person dome, muddy", imageStorageId: undefined },
		);
	});

	it("leaves a standard catalog's custom line exactly as it was", () => {
		render(<MtoBox product={cake(2)} onAdd={vi.fn()} />);
		expect(screen.getAllByText("Your request")).toHaveLength(1);
		// …and that product DOES keep its standard buy box (the CTA reads
		// "Select options" until a size is picked, but it's mounted).
		expect(screen.getByRole("button", { name: /increase/i })).toBeTruthy();
	});
});
