import { useCallback, useEffect, useState } from "react";
import {
	ALL_ORDER_COLUMN_KEYS,
	DEFAULT_ORDER_COLUMN_KEYS,
	type OrderColumn,
	ORDER_COLUMNS,
	type OrderColumnKey,
} from "../../convex/lib/orderCsv";

/**
 * Which columns the orders table shows, persisted per store (86eyrtz74).
 *
 * localStorage, not the URL and not Convex, deliberately:
 *   - the URL is the inbox's source of truth for the VIEW (bucket, filters,
 *     sort) because those are worth sharing; 36 column toggles in a query
 *     string are not, and would bury the shareable parts;
 *   - it is a personal display preference, not store truth, so it has no
 *     business costing a Convex write or syncing to a colleague's screen.
 * The cost is that it is per-device, which is the right trade for a preference
 * — and it means the "export visible columns" action exports what THIS device
 * is looking at, which is exactly what the seller means by it.
 *
 * Keyed per retailer so an admin acting across stores doesn't drag one store's
 * layout onto another.
 */
const STORAGE_PREFIX = "kp:orders:columns:";

function storageKey(retailerId: string): string {
	return `${STORAGE_PREFIX}${retailerId}`;
}

const VALID_KEYS = new Set<string>(ALL_ORDER_COLUMN_KEYS);

/**
 * Parse a stored key list. Unknown keys are dropped rather than rejected — a
 * column removed or renamed in a later build must not blow away the seller's
 * whole layout, it just isn't a column any more. A stored list that survives
 * with nothing in it falls back to the defaults so the table is never blank.
 */
export function parseStoredColumns(raw: string | null): OrderColumnKey[] | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const keys = parsed.filter(
			(k): k is OrderColumnKey => typeof k === "string" && VALID_KEYS.has(k),
		);
		return keys.length > 0 ? keys : null;
	} catch {
		return null;
	}
}

function readInitial(retailerId: string): OrderColumnKey[] {
	if (typeof window === "undefined") return [...DEFAULT_ORDER_COLUMN_KEYS];
	try {
		return (
			parseStoredColumns(window.localStorage.getItem(storageKey(retailerId))) ?? [
				...DEFAULT_ORDER_COLUMN_KEYS,
			]
		);
	} catch {
		return [...DEFAULT_ORDER_COLUMN_KEYS];
	}
}

export interface OrderColumnsState {
	/** Visible columns, resolved and always in registry order — so toggling a
	 * column back on returns it to its proper place rather than the end. */
	columns: OrderColumn[];
	/** Visible keys, for the export call. */
	visibleKeys: OrderColumnKey[];
	isVisible: (key: OrderColumnKey) => boolean;
	toggle: (key: OrderColumnKey) => void;
	reset: () => void;
	/** True when the seller has moved away from the default set — drives the
	 * picker's "Reset" affordance, which otherwise has nothing to undo. */
	isCustomised: boolean;
}

export function useOrderColumns(retailerId: string): OrderColumnsState {
	const [keys, setKeys] = useState<OrderColumnKey[]>(() => [
		...DEFAULT_ORDER_COLUMN_KEYS,
	]);

	// Hydrate after mount (never during render) so the server and the first
	// client paint agree, matching useSidebarCollapsed.
	useEffect(() => {
		setKeys(readInitial(retailerId));
	}, [retailerId]);

	const persist = useCallback(
		(next: OrderColumnKey[]) => {
			setKeys(next);
			try {
				window.localStorage.setItem(storageKey(retailerId), JSON.stringify(next));
			} catch {
				// localStorage unavailable (private mode, quota) — keep in-memory.
			}
		},
		[retailerId],
	);

	const visible = new Set(keys);
	const toggle = useCallback(
		(key: OrderColumnKey) => {
			setKeys((prev) => {
				const has = prev.includes(key);
				// Never let the last column be hidden — an empty table is a dead end
				// with no way back except the picker the seller just emptied.
				if (has && prev.length === 1) return prev;
				const next = has ? prev.filter((k) => k !== key) : [...prev, key];
				try {
					window.localStorage.setItem(
						storageKey(retailerId),
						JSON.stringify(next),
					);
				} catch {
					// see persist
				}
				return next;
			});
		},
		[retailerId],
	);

	const reset = useCallback(
		() => persist([...DEFAULT_ORDER_COLUMN_KEYS]),
		[persist],
	);

	const columns = ORDER_COLUMNS.filter((c) => visible.has(c.key));
	return {
		columns,
		visibleKeys: columns.map((c) => c.key),
		isVisible: (key) => visible.has(key),
		toggle,
		reset,
		isCustomised:
			keys.length !== DEFAULT_ORDER_COLUMN_KEYS.length ||
			!DEFAULT_ORDER_COLUMN_KEYS.every((k) => visible.has(k)),
	};
}
