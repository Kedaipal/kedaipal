// The product's one-word status for the edit page header — the honest version
// of the old `active ? "Live" : "Archived"` chip, which kept saying "Live" for
// hidden and sold-out products. Priority: archived > hidden > sold out > live
// (an archived product's hidden/stock state is irrelevant; a hidden product's
// stock is a detail behind the bigger fact that buyers can't see it).
// See docs/product-setup-wizard.md.

export type ProductStatus = {
	label: "Live" | "Sold out" | "Hidden" | "Archived";
	/** Chip tone: live = accent dot, warn = amber, muted = grey. */
	tone: "live" | "warn" | "muted";
	/** One-line explanation surfaced as the chip's title/tooltip. */
	detail: string;
};

export function productStatus(product: {
	active: boolean;
	hidden?: boolean;
	/** Denormalized "every category this product is in is hidden" flag —
	 * suppresses the product from the storefront exactly like `hidden`. */
	hiddenByCategory?: boolean;
	/** Server-derived: ANY active variant is sellable right now. */
	inStock: boolean;
}): ProductStatus {
	if (!product.active) {
		return {
			label: "Archived",
			tone: "muted",
			detail: "Not for sale anywhere. Restore it to sell again.",
		};
	}
	if (product.hidden || product.hiddenByCategory) {
		return {
			label: "Hidden",
			tone: "muted",
			detail: product.hidden
				? "Not shown on your storefront — still sellable at the counter."
				: "Every category it's in is hidden, so it's off your storefront — still sellable at the counter.",
		};
	}
	if (!product.inStock) {
		return {
			label: "Sold out",
			tone: "warn",
			detail:
				"Every tracked choice is at zero stock — buyers see it but can't order until you restock.",
		};
	}
	return {
		label: "Live",
		tone: "live",
		detail: "On your storefront and orderable right now.",
	};
}
