// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	ALL_ORDER_COLUMN_KEYS,
	DEFAULT_ORDER_COLUMN_KEYS,
} from "../../convex/lib/orderCsv";
import { parseStoredColumns, useOrderColumns } from "./useOrderColumns";

const STORE = "rt_test";
const KEY = `kp:orders:columns:${STORE}`;

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
