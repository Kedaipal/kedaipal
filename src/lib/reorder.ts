/**
 * Reorder `items` to match `orderedIds` — the id sequence handed back by
 * `SortableList.onReorder`. Built as a `Map` lookup so it stays O(n) (the inline
 * `find` pattern it replaces was O(n²)). Ids not present in `items` are skipped,
 * and items whose id isn't listed are dropped, so the result reflects exactly
 * the live set in the requested order. Pure — safe inside an optimistic state
 * setter.
 */
export function reorderByIds<T>(
	items: ReadonlyArray<T>,
	orderedIds: ReadonlyArray<string>,
	getId: (item: T) => string,
): T[] {
	const byId = new Map(items.map((item) => [getId(item), item]));
	const result: T[] = [];
	for (const id of orderedIds) {
		const item = byId.get(id);
		if (item !== undefined) result.push(item);
	}
	return result;
}
