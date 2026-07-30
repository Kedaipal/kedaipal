// Buyer-eye DRAFT preview: turn the product form's live, as-typed draft into
// the field overlay the storefront ProductDetailSheet reads, mirroring the
// server's `productWithVariants` derivations (quote pricing, price range,
// in-stock) so what the seller previews is what a buyer would see AFTER
// saving. The route spreads this over the saved product row, so identity
// fields (_id, retailerId, currency…) stay real. Pure — unit-tested.
// See docs/product-setup-wizard.md.

import type { ProductFormDraft } from "../components/forms/product-form";
import { parsePriceInput } from "./format";

export type PreviewVariant = {
	_id: string;
	optionValues: string[];
	sku?: string;
	price: number;
	onHand: number;
	active: boolean;
	blockWhenOutOfStock: boolean;
	requiresProof: boolean;
	imageStorageIds: string[];
	imageUrls: string[];
	isCustom?: boolean;
	customLabel?: string;
	customPrompt?: string;
};

function sen(raw: string): number {
	const parsed = parsePriceInput(raw.trim());
	return parsed !== null ? Math.round(parsed * 100) : 0;
}

function int(raw: string): number {
	return /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : 0;
}

export function draftPreviewOverlay(draft: ProductFormDraft) {
	// Buyers only ever see active variants.
	const activeRows = draft.editor.rows.filter((r) => r.active);
	const variants: PreviewVariant[] = activeRows.map((row, i) => ({
		_id: `preview-${i}`,
		optionValues: row.optionValues,
		sku: row.sku.trim() || undefined,
		price: sen(row.price),
		onHand: int(row.stock),
		active: true,
		blockWhenOutOfStock: row.blockWhenOutOfStock,
		requiresProof: row.requiresProof,
		imageStorageIds: row.imageStorageIds,
		imageUrls: row.imageUrl ? [row.imageUrl] : [],
	}));
	const customLine = draft.editor.customLine;
	if (customLine) {
		variants.push({
			_id: "preview-custom",
			optionValues: [],
			price: sen(customLine.price),
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: true,
			imageStorageIds: customLine.imageStorageIds,
			imageUrls: customLine.imageUrl ? [customLine.imageUrl] : [],
			isCustom: true,
			customLabel: customLine.label.trim() || undefined,
			customPrompt: customLine.prompt.trim() || undefined,
		});
	}

	// Mirror productWithVariants: quote lines (proof-gated at price 0) are
	// excluded from the displayed range.
	const isQuote = (vr: PreviewVariant) =>
		vr.requiresProof && vr.price === 0;
	const prices = variants.filter((vr) => !isQuote(vr)).map((vr) => vr.price);
	const minQty = Number(draft.minQuantity.trim());

	return {
		name: draft.name.trim() || "Untitled product",
		description:
			draft.description.trim().length > 0 ? draft.description.trim() : undefined,
		imageStorageIds: draft.images.map((i) => i.id),
		imageUrls: draft.images.map((i) => i.url),
		options: draft.editor.options,
		variants,
		variantCount: variants.length,
		priceFrom: prices.length ? Math.min(...prices) : 0,
		priceTo: prices.length ? Math.max(...prices) : 0,
		hasQuotePricing: variants.some(isQuote),
		totalOnHand: variants.reduce((sum, vr) => sum + vr.onHand, 0),
		inStock: variants.some((vr) =>
			vr.blockWhenOutOfStock ? vr.onHand > 0 : true,
		),
		hidden: draft.hidden,
		minQuantity:
			Number.isInteger(minQty) && minQty >= 2 ? minQty : undefined,
	};
}
