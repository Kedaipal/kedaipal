import { useCallback, useEffect, useRef, useState } from "react";
import {
	ALL_ORDER_COLUMN_KEYS,
	clampColumnWidth,
	DEFAULT_ORDER_COLUMN_KEYS,
	ORDER_COLUMNS_BY_KEY,
	type OrderColumn,
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
/**
 * Widths live under their OWN key rather than being folded into the key list.
 * The two change at very different rates — the order list is rewritten on a
 * drag or a toggle, widths on every frame of a resize — and a separate key
 * means a stored layout written by an older build still loads intact instead of
 * failing a shape check and dropping the seller's arrangement.
 */
const WIDTH_PREFIX = "kp:orders:colwidths:";

function storageKey(retailerId: string): string {
	return `${STORAGE_PREFIX}${retailerId}`;
}

function widthKey(retailerId: string): string {
	return `${WIDTH_PREFIX}${retailerId}`;
}

/** Widths keyed by column, exactly the shape TanStack Table's
 * `ColumnSizingState` uses, so it passes straight through. */
export type OrderColumnWidths = Record<string, number>;

const VALID_KEYS = new Set<string>(ALL_ORDER_COLUMN_KEYS);

/**
 * Parse a stored key list. Unknown keys are dropped rather than rejected — a
 * column removed or renamed in a later build must not blow away the seller's
 * whole layout, it just isn't a column any more. A stored list that survives
 * with nothing in it falls back to the defaults so the table is never blank.
 */
export function parseStoredColumns(
	raw: string | null,
): OrderColumnKey[] | null {
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

/**
 * Parse stored widths. Every value is CLAMPED on read, not just on write: a
 * layout stored before the bounds changed (or hand-edited in devtools) must not
 * be able to resurrect a 4px column that has no handle left to drag back.
 * Unknown keys are dropped, same rule as the key list.
 */
export function parseStoredWidths(
	raw: string | null,
): OrderColumnWidths | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return null;
		const out: OrderColumnWidths = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (!VALID_KEYS.has(key)) continue;
			if (typeof value !== "number" || !Number.isFinite(value)) continue;
			out[key] = clampColumnWidth(value);
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch {
		return null;
	}
}

function readInitialWidths(retailerId: string): OrderColumnWidths {
	if (typeof window === "undefined") return {};
	try {
		return (
			parseStoredWidths(window.localStorage.getItem(widthKey(retailerId))) ?? {}
		);
	} catch {
		return {};
	}
}

function readInitial(retailerId: string): OrderColumnKey[] {
	if (typeof window === "undefined") return [...DEFAULT_ORDER_COLUMN_KEYS];
	try {
		return (
			parseStoredColumns(
				window.localStorage.getItem(storageKey(retailerId)),
			) ?? [...DEFAULT_ORDER_COLUMN_KEYS]
		);
	} catch {
		return [...DEFAULT_ORDER_COLUMN_KEYS];
	}
}

export interface OrderColumnsState {
	/** Visible columns, in the seller's own left-to-right order. */
	columns: OrderColumn[];
	/** Visible keys IN ORDER — passed to the export so a CSV comes out arranged
	 * the way the table is. */
	visibleKeys: OrderColumnKey[];
	isVisible: (key: OrderColumnKey) => boolean;
	/** Show/hide. Showing appends to the end — a column you just added belongs
	 * where you can see it, not slotted invisibly into the middle. */
	toggle: (key: OrderColumnKey) => void;
	/** Rearrange the visible set. Takes the full new key order (the shape
	 * `SortableList` hands back on drop). */
	reorder: (keys: OrderColumnKey[]) => void;
	reset: () => void;
	/** Column widths the seller has dragged to, keyed by column. A column absent
	 * here is at its registry default. Shaped as TanStack's `ColumnSizingState`
	 * so it passes straight into the table. */
	widths: OrderColumnWidths;
	/** Replace the whole width map (what TanStack's sizing updater hands back).
	 * Persisted on a short debounce — `onChange` resize mode fires this on every
	 * frame of a drag, and a localStorage write per frame is waste. */
	setWidths: (next: OrderColumnWidths) => void;
	/** True when the seller has moved away from the default set, its order, or
	 * the default widths — drives the picker's "Reset" affordance, which
	 * otherwise has nothing to undo. */
	isCustomised: boolean;
}

/** Long enough to collapse a whole drag into one write, short enough that
 * navigating away immediately after letting go still saves. */
const WIDTH_PERSIST_MS = 300;

export function useOrderColumns(retailerId: string): OrderColumnsState {
	const [keys, setKeys] = useState<OrderColumnKey[]>(() => [
		...DEFAULT_ORDER_COLUMN_KEYS,
	]);
	const [widths, setWidthsState] = useState<OrderColumnWidths>({});
	const widthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * The debounced write, as a closure that already captured BOTH the widths and
	 * the retailer they belong to. Held so unmount can run it early.
	 *
	 * A closure rather than the values: the cleanup effect has `[]` deps, so it
	 * only ever sees the FIRST `retailerId` — which is `""` while the retailer
	 * query is in flight. Flushing from captured values would write the seller's
	 * layout under the empty-string key and lose it just as thoroughly.
	 */
	const pendingWidthWrite = useRef<(() => void) | null>(null);

	// Hydrate after mount (never during render) so the server and the first
	// client paint agree, matching useSidebarCollapsed.
	useEffect(() => {
		setKeys(readInitial(retailerId));
		setWidthsState(readInitialWidths(retailerId));
	}, [retailerId]);

	// A drag that ends with the seller navigating away inside the debounce window
	// must still be saved, so unmount FLUSHES the pending write rather than
	// dropping it — 300ms is easily short enough to lose a resize to a click on
	// the nav, and a width that silently doesn't stick is worse than one that
	// never persisted at all.
	useEffect(
		() => () => {
			if (widthTimer.current) clearTimeout(widthTimer.current);
			pendingWidthWrite.current?.();
		},
		[],
	);

	const setWidths = useCallback(
		(next: OrderColumnWidths) => {
			setWidthsState(next);
			if (widthTimer.current) clearTimeout(widthTimer.current);
			const write = () => {
				// Cleared first: the flush path and the timer path must not both run,
				// and whichever gets there first has written the latest value.
				pendingWidthWrite.current = null;
				widthTimer.current = null;
				try {
					window.localStorage.setItem(
						widthKey(retailerId),
						JSON.stringify(next),
					);
				} catch {
					// localStorage unavailable (private mode, quota) — keep in-memory.
				}
			};
			pendingWidthWrite.current = write;
			widthTimer.current = setTimeout(write, WIDTH_PERSIST_MS);
		},
		[retailerId],
	);

	const persist = useCallback(
		(next: OrderColumnKey[]) => {
			setKeys(next);
			try {
				window.localStorage.setItem(
					storageKey(retailerId),
					JSON.stringify(next),
				);
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

	const reorder = useCallback(
		(next: OrderColumnKey[]) => {
			// Trust only keys that are real columns and were already visible — the
			// list comes back from a drag handler, and a stale id must reorder
			// nothing rather than resurrect a hidden column.
			setKeys((prev) => {
				const allowed = new Set(prev);
				const cleaned = next.filter((k) => allowed.has(k));
				if (cleaned.length !== prev.length) return prev;
				try {
					window.localStorage.setItem(
						storageKey(retailerId),
						JSON.stringify(cleaned),
					);
				} catch {
					// see persist
				}
				return cleaned;
			});
		},
		[retailerId],
	);

	// Reset means the whole layout: which columns, in what order, at what width.
	// Leaving dragged widths behind after a reset would be a half-undo, and the
	// seller has no other way to clear them wholesale.
	const reset = useCallback(() => {
		persist([...DEFAULT_ORDER_COLUMN_KEYS]);
		setWidths({});
	}, [persist, setWidths]);

	// The seller's own order, NOT the registry's — dragging a column left has to
	// stick, in the table and in the export it feeds.
	const columns = keys.flatMap((k) => {
		const col = ORDER_COLUMNS_BY_KEY.get(k);
		return col ? [col] : [];
	});
	return {
		columns,
		visibleKeys: columns.map((c) => c.key),
		isVisible: (key) => visible.has(key),
		toggle,
		reorder,
		reset,
		widths,
		setWidths,
		// Order and width both count as customisation: a seller who only dragged
		// columns around, or only widened one, still has something to reset.
		isCustomised:
			Object.keys(widths).length > 0 ||
			keys.length !== DEFAULT_ORDER_COLUMN_KEYS.length ||
			!DEFAULT_ORDER_COLUMN_KEYS.every((k, i) => keys[i] === k),
	};
}
