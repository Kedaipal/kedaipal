// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ALL_ORDER_COLUMN_KEYS,
	DEFAULT_ORDER_COLUMN_KEYS,
	ORDER_COLUMN_MAX_WIDTH,
	ORDER_COLUMN_MIN_WIDTH,
} from "../../convex/lib/orderCsv";
import {
	parseStoredColumns,
	parseStoredWidths,
	useOrderColumns,
} from "./useOrderColumns";

const STORE = "rt_test";
const KEY = `kp:orders:columns:${STORE}`;
const WKEY = `kp:orders:colwidths:${STORE}`;

afterEach(() => {
	window.localStorage.clear();
});

describe("parseStoredColumns", () => {
	it("returns null for junk rather than throwing", () => {
		expect(parseStoredColumns(null)).toBeNull();
		expect(parseStoredColumns("{not json")).toBeNull();
		expect(parseStoredColumns('{"a":1}')).toBeNull();
	});

	it("drops keys that are no longer columns instead of discarding the layout", () => {
		// A column renamed in a later build must not wipe the seller's whole
		// arrangement — it just stops being a column.
		expect(
			parseStoredColumns(JSON.stringify(["shortId", "aColumnWeDeleted"])),
		).toEqual(["shortId"]);
	});

	it("treats an all-unknown list as no preference at all", () => {
		expect(parseStoredColumns(JSON.stringify(["gone", "alsoGone"]))).toBeNull();
	});
});

describe("useOrderColumns", () => {
	it("opens on the default set, in registry order", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		expect(result.current.visibleKeys).toEqual([...DEFAULT_ORDER_COLUMN_KEYS]);
		expect(result.current.isCustomised).toBe(false);
	});

	it("hydrates a stored layout IN ITS STORED ORDER", () => {
		window.localStorage.setItem(KEY, JSON.stringify(["total", "shortId"]));
		const { result } = renderHook(() => useOrderColumns(STORE));
		// The seller's dragged order is the point — it drives both the table's
		// left-to-right and the CSV export's column order, so it must survive a
		// reload exactly as arranged.
		expect(result.current.visibleKeys).toEqual(["total", "shortId"]);
		expect(result.current.isCustomised).toBe(true);
	});

	it("reorders, and rejects a list that isn't a permutation", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		const original = [...result.current.visibleKeys];
		const reversed = [...original].reverse();
		act(() => result.current.reorder(reversed));
		expect(result.current.visibleKeys).toEqual(reversed);
		// A stale id from a drag handler must reorder nothing rather than drop or
		// resurrect a column.
		act(() => result.current.reorder(["shortId"]));
		expect(result.current.visibleKeys).toEqual(reversed);
	});

	it("showing a column appends it — where the seller can see it", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.toggle("city"));
		expect(result.current.visibleKeys.at(-1)).toBe("city");
	});

	it("persists a toggle", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.toggle("city"));
		expect(result.current.isVisible("city")).toBe(true);
		expect(parseStoredColumns(window.localStorage.getItem(KEY))).toContain(
			"city",
		);
		act(() => result.current.toggle("city"));
		expect(result.current.isVisible("city")).toBe(false);
	});

	it("refuses to hide the last column — an empty table is a dead end", () => {
		window.localStorage.setItem(KEY, JSON.stringify(["shortId"]));
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.toggle("shortId"));
		expect(result.current.visibleKeys).toEqual(["shortId"]);
	});

	it("resets back to the defaults", () => {
		window.localStorage.setItem(KEY, JSON.stringify(["total"]));
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.reset());
		expect(result.current.visibleKeys).toEqual([...DEFAULT_ORDER_COLUMN_KEYS]);
		expect(result.current.isCustomised).toBe(false);
	});

	it("keeps stores apart — an admin switching stores keeps each layout", () => {
		window.localStorage.setItem(KEY, JSON.stringify(["total"]));
		const { result } = renderHook(() => useOrderColumns("rt_other"));
		expect(result.current.visibleKeys).toEqual([...DEFAULT_ORDER_COLUMN_KEYS]);
	});

	it("shows a whole group at once, in registry order (86eyrtz74)", () => {
		// Ticking 22 boxes by hand was the alternative. Additions arrive as a
		// block in canonical order, not scattered by tick order.
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() =>
			result.current.setManyVisible(["city", "state", "postcode"], true),
		);
		const keys = result.current.visibleKeys;
		expect(keys).toContain("city");
		expect(keys).toContain("state");
		expect(keys).toContain("postcode");
		const order = (["city", "state", "postcode"] as const).map((k) =>
			keys.indexOf(k),
		);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it("hides a whole group, leaving the rest in their existing order", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		const before = [...result.current.visibleKeys];
		const target = before.slice(0, 2);
		act(() => result.current.setManyVisible(target, false));
		expect(result.current.visibleKeys).toEqual(before.slice(2));
	});

	it("clearing everything keeps the FIRST column, never an empty table", () => {
		// An empty table is a dead end whose only way back is the panel the
		// seller just emptied — so the click does the thing they meant and keeps
		// one column, rather than silently refusing.
		const { result } = renderHook(() => useOrderColumns(STORE));
		const first = result.current.visibleKeys[0];
		act(() => result.current.setManyVisible([...ALL_ORDER_COLUMN_KEYS], false));
		expect(result.current.visibleKeys).toEqual([first]);
	});

	it("showing a set that is already fully shown changes nothing", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		const before = [...result.current.visibleKeys];
		act(() => result.current.setManyVisible(before, true));
		expect(result.current.visibleKeys).toEqual(before);
	});

	it("a bulk change persists like a single toggle", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.setManyVisible(["city"], true));
		expect(parseStoredColumns(window.localStorage.getItem(KEY))).toContain(
			"city",
		);
	});

	it("every column in the registry can be turned on", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		for (const key of ALL_ORDER_COLUMN_KEYS) {
			if (!result.current.isVisible(key)) act(() => result.current.toggle(key));
		}
		// Compared as a SET: the order is the seller's (defaults first, then the
		// order they added the rest), not the registry's.
		expect(new Set(result.current.visibleKeys)).toEqual(
			new Set(ALL_ORDER_COLUMN_KEYS),
		);
	});
});

describe("parseStoredWidths", () => {
	it("returns null for junk rather than throwing", () => {
		expect(parseStoredWidths(null)).toBeNull();
		expect(parseStoredWidths("{not json")).toBeNull();
		expect(parseStoredWidths("[1,2]")).toBeNull();
	});

	it("clamps on READ, not only on write", () => {
		// A width stored before the bounds changed — or hand-edited — must not be
		// able to resurrect a 4px column, which has no handle left to drag back.
		expect(parseStoredWidths(JSON.stringify({ total: 4, city: 9999 }))).toEqual(
			{ total: ORDER_COLUMN_MIN_WIDTH, city: ORDER_COLUMN_MAX_WIDTH },
		);
	});

	it("drops keys that are no longer columns, and non-numbers", () => {
		expect(
			parseStoredWidths(
				JSON.stringify({ total: 200, gone: 200, city: "wide" }),
			),
		).toEqual({ total: 200 });
		expect(parseStoredWidths(JSON.stringify({ gone: 200 }))).toBeNull();
	});
});

describe("useOrderColumns — widths", () => {
	it("opens with no width overrides — every column at its registry default", () => {
		const { result } = renderHook(() => useOrderColumns(STORE));
		expect(result.current.widths).toEqual({});
		expect(result.current.isCustomised).toBe(false);
	});

	it("hydrates stored widths", () => {
		window.localStorage.setItem(WKEY, JSON.stringify({ total: 240 }));
		const { result } = renderHook(() => useOrderColumns(STORE));
		expect(result.current.widths).toEqual({ total: 240 });
		// A dragged width alone is something to undo, so Reset must be offered.
		expect(result.current.isCustomised).toBe(true);
	});

	it("persists a resize, on a debounce", async () => {
		vi.useFakeTimers();
		try {
			const { result } = renderHook(() => useOrderColumns(STORE));
			act(() => result.current.setWidths({ total: 300 }));
			// State is immediate — the column must follow the pointer.
			expect(result.current.widths).toEqual({ total: 300 });
			// The write is not: `onChange` resize fires this every frame.
			expect(window.localStorage.getItem(WKEY)).toBeNull();
			act(() => vi.runAllTimers());
			expect(parseStoredWidths(window.localStorage.getItem(WKEY))).toEqual({
				total: 300,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("flushes a pending width write on unmount (PR #233 review)", () => {
		// 300ms is easily short enough to lose a resize to a click on the nav.
		// The cleanup used to just clearTimeout, silently dropping the write the
		// comment claimed it was saving.
		vi.useFakeTimers();
		try {
			const { result, unmount } = renderHook(() => useOrderColumns(STORE));
			act(() => result.current.setWidths({ total: 321 }));
			expect(window.localStorage.getItem(WKEY)).toBeNull();
			unmount();
			expect(parseStoredWidths(window.localStorage.getItem(WKEY))).toEqual({
				total: 321,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("the flush writes under the store it was resized for, not the loading key", () => {
		// The cleanup effect has [] deps, so it only ever sees the FIRST
		// retailerId — which is "" while the retailer query is in flight.
		// Flushing from captured values would file the layout under the empty
		// key and lose it just as thoroughly as dropping it.
		vi.useFakeTimers();
		try {
			const { result, unmount, rerender } = renderHook(
				({ id }) => useOrderColumns(id),
				{ initialProps: { id: "" } },
			);
			rerender({ id: STORE });
			act(() => result.current.setWidths({ total: 275 }));
			unmount();
			expect(parseStoredWidths(window.localStorage.getItem(WKEY))).toEqual({
				total: 275,
			});
			expect(window.localStorage.getItem("kp:orders:colwidths:")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("unmounting with nothing pending writes nothing", () => {
		const { unmount } = renderHook(() => useOrderColumns(STORE));
		unmount();
		expect(window.localStorage.getItem(WKEY)).toBeNull();
	});

	it("reset clears widths as well as the column set — a half-undo is worse than none", () => {
		window.localStorage.setItem(KEY, JSON.stringify(["total"]));
		window.localStorage.setItem(WKEY, JSON.stringify({ total: 240 }));
		const { result } = renderHook(() => useOrderColumns(STORE));
		act(() => result.current.reset());
		expect(result.current.widths).toEqual({});
		expect(result.current.visibleKeys).toEqual([...DEFAULT_ORDER_COLUMN_KEYS]);
		expect(result.current.isCustomised).toBe(false);
	});

	it("keeps stores apart", () => {
		window.localStorage.setItem(WKEY, JSON.stringify({ total: 240 }));
		const { result } = renderHook(() => useOrderColumns("rt_other"));
		expect(result.current.widths).toEqual({});
	});
});
