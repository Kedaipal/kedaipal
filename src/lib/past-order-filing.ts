import type { PastOrderFiling } from "../../convex/categories";

/**
 * The line under "Product saved." when adding a category also filed the
 * product's earlier uncategorized orders (`categories.setProductCategories`).
 * `undefined` when nothing was filed and nothing is still being filed, so a
 * plain save stays a plain "Product saved." — the line only appears when the
 * inbox filter has actually changed under the seller.
 */
export function pastOrderFilingMessage(
	filing: PastOrderFiling,
): string | undefined {
	const under = new Intl.ListFormat("en", { type: "conjunction" }).format(
		filing.categoryNames,
	);
	if (filing.filedOrders > 0) {
		const n = filing.filedOrders;
		const head = `${n} earlier order${n === 1 ? " is" : "s are"} now filed under ${under}.`;
		return filing.filingContinues
			? `${head} Older orders are being filed now.`
			: head;
	}
	if (filing.filingContinues)
		return `Earlier orders for this product are being filed under ${under} now.`;
	return undefined;
}
