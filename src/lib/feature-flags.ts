// Lightweight build-time feature flags. Flip the const to toggle a feature.

/**
 * Bulk product import/export (CSV/XLSX). Hidden until reworked for the variant
 * schema — export currently flattens multi-variant products to their first
 * variant and import only creates single-variant products, both of which
 * predate `productVariants`. When false, the toolbar buttons are hidden AND the
 * `/app/products/import` route redirects to the product list.
 * See docs/bulk-product-upload-roadmap.md + docs/product-variants.md §9.
 */
export const BULK_IO_ENABLED = true;
