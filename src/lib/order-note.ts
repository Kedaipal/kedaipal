// Pure helper for composing the order's customerNote from per-line buyer notes
// (e.g. a custom line's spec) plus the general checkout note. Kept dependency-free
// so the storefront bundle + tests can use it in isolation. See docs/custom-option.md.

export type NotableCartItem = {
	name: string;
	optionLabel?: string;
	note?: string;
};

/**
 * Fold any per-line custom requests (labelled by item) into the single order
 * note, ahead of any general note. This reaches the seller through the existing
 * `customerNote` channel (WhatsApp "Note for seller" + dashboard + email), so a
 * custom line's spec never needs a per-item field on the order.
 *
 * Returns `undefined` when there's nothing to send (so the field stays unset).
 */
export function composeCustomerNote(
	items: readonly NotableCartItem[],
	generalNote: string | undefined,
): string | undefined {
	const lines: string[] = [];
	for (const item of items) {
		const note = item.note?.trim();
		if (!note) continue;
		const label = item.optionLabel
			? `${item.name} (${item.optionLabel})`
			: item.name;
		lines.push(`${label}: ${note}`);
	}
	const general = generalNote?.trim();
	if (general) lines.push(general);
	const joined = lines.join("\n").trim();
	return joined.length > 0 ? joined : undefined;
}
