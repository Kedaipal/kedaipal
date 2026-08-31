import { describe, expect, it } from "vitest";
import type { ProductFormDraft } from "../components/forms/product-form";
import { draftPreviewOverlay } from "./product-preview";

function draft(partial: Partial<ProductFormDraft> = {}): ProductFormDraft {
	return {
		name: "Brownies",
		description: "",
		hidden: false,
		kind: "physical" as const,
		capacityPerNight: "1",
		categoryIds: [],
		images: [{ id: "st1", url: "blob:hero" }],
		editor: {
			options: [{ name: "Size", values: ["S", "M"] }],
			rows: [
				{
					optionValues: ["S"],
					sku: "",
					price: "12",
					stock: "3",
					active: true,
					blockWhenOutOfStock: true,
					requiresProof: false,
					parcelWeightG: "",
					imageStorageIds: [],
				},
				{
					optionValues: ["M"],
					sku: "",
					price: "18",
					stock: "0",
					active: true,
					blockWhenOutOfStock: true,
					requiresProof: false,
					parcelWeightG: "",
					imageStorageIds: [],
				},
			],
			customLine: null,
		},
		minQuantity: "",
		minNoticeDays: "",
		...partial,
	};
}

describe("draftPreviewOverlay", () => {
	it("mirrors the server's price range and stock derivations", () => {
		const overlay = draftPreviewOverlay(draft());
		expect(overlay.priceFrom).toBe(1200);
		expect(overlay.priceTo).toBe(1800);
		expect(overlay.totalOnHand).toBe(3);
		expect(overlay.inStock).toBe(true);
		expect(overlay.variants).toHaveLength(2);
		expect(overlay.imageUrls).toEqual(["blob:hero"]);
	});

	it("filters deactivated rows — buyers never see them", () => {
		const d = draft();
		d.editor.rows[1].active = false;
		const overlay = draftPreviewOverlay(d);
		expect(overlay.variants).toHaveLength(1);
		expect(overlay.priceTo).toBe(1200);
	});

	it("treats a blank-priced custom line as quote pricing, excluded from the range", () => {
		const d = draft();
		d.editor.customLine = {
			label: "Bespoke",
			price: "",
			prompt: "Theme?",
			imageStorageIds: [],
		};
		const overlay = draftPreviewOverlay(d);
		expect(overlay.hasQuotePricing).toBe(true);
		const custom = overlay.variants.at(-1);
		expect(custom).toMatchObject({
			isCustom: true,
			customLabel: "Bespoke",
			price: 0,
			requiresProof: true,
			blockWhenOutOfStock: false,
		});
		expect(overlay.priceTo).toBe(1800); // quote line not in the range
	});

	it("reports sold-out when every tracked row is at zero", () => {
		const d = draft();
		d.editor.rows = d.editor.rows.map((r) => ({ ...r, stock: "0" }));
		expect(draftPreviewOverlay(d).inStock).toBe(false);
	});

	it("carries a valid minimum order quantity, ignoring blanks and invalids", () => {
		expect(draftPreviewOverlay(draft()).minQuantity).toBeUndefined();
		expect(draftPreviewOverlay(draft({ minQuantity: "20" })).minQuantity).toBe(
			20,
		);
		expect(
			draftPreviewOverlay(draft({ minQuantity: "1" })).minQuantity,
		).toBeUndefined();
	});
});
