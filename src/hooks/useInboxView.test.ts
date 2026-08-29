// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseStoredView,
	resolveInboxView,
	useInboxView,
} from "./useInboxView";

const STORE = "rt_test";
const KEY = `kp:orders:view:${STORE}`;

afterEach(() => {
	window.localStorage.clear();
});

describe("parseStoredView", () => {
	it("accepts only the two real views", () => {
		expect(parseStoredView("table")).toBe("table");
		expect(parseStoredView("cards")).toBe("cards");
		expect(parseStoredView(null)).toBeNull();
		expect(parseStoredView("grid")).toBeNull();
	});
});

describe("useInboxView", () => {
	it("reports no preference until one is set — the route falls back to cards", () => {
		const { result } = renderHook(() => useInboxView(STORE));
		expect(result.current.stored).toBeNull();
	});

	it("hydrates the remembered view", () => {
		window.localStorage.setItem(KEY, "table");
		const { result } = renderHook(() => useInboxView(STORE));
		expect(result.current.stored).toBe("table");
	});

	it("remembers a chosen view across a remount — the whole point", () => {
		const first = renderHook(() => useInboxView(STORE));
		act(() => first.result.current.remember("table"));
		expect(first.result.current.stored).toBe("table");
		first.unmount();
		// Leaving Orders and coming back must land in the table, not cards.
		const second = renderHook(() => useInboxView(STORE));
		expect(second.result.current.stored).toBe("table");
	});

	it("remembers cards too, so a seller can switch back and have it stick", () => {
		window.localStorage.setItem(KEY, "table");
		const { result } = renderHook(() => useInboxView(STORE));
		act(() => result.current.remember("cards"));
		expect(window.localStorage.getItem(KEY)).toBe("cards");
		expect(renderHook(() => useInboxView(STORE)).result.current.stored).toBe(
			"cards",
		);
	});

	it("keeps stores apart — an admin switching stores keeps each layout", () => {
		window.localStorage.setItem(KEY, "table");
		const { result } = renderHook(() => useInboxView("rt_other"));
		expect(result.current.stored).toBeNull();
	});
});

describe("resolveInboxView", () => {
	it("falls back to cards for a seller who has never chosen", () => {
		expect(resolveInboxView(undefined, null)).toBe("cards");
	});

	it("resumes the remembered view when the URL doesn't name one", () => {
		// The bug this fixes: opening Orders from the nav dropped a table user
		// back into cards every time.
		expect(resolveInboxView(undefined, "table")).toBe("table");
	});

	it("lets a shared link win over the recipient's preference — both ways", () => {
		expect(resolveInboxView("cards", "table")).toBe("cards");
		expect(resolveInboxView("table", "cards")).toBe("table");
	});

	it("a seller without the inbox feature always gets cards (PR #233 review)", () => {
		// The dead end this closes: a Pro seller whose plan lapses kept their
		// remembered `view=table`, landed in a table whose header funnels wrote
		// filters `searchOrders` refuses to honour for a Starter — and the
		// cards/table toggle lives inside the gated header actions, so there was
		// no way back to cards through the UI at all.
		expect(resolveInboxView("table", "table", false)).toBe("cards");
		expect(resolveInboxView(undefined, "table", false)).toBe("cards");
		// Even an explicit, hand-typed URL loses to the gate.
		expect(resolveInboxView("table", null, false)).toBe("cards");
	});

	it("gating hides the table without forgetting the choice", () => {
		// Storage is untouched by the gate, so upgrading puts the seller straight
		// back where they were rather than silently demoting them to cards.
		expect(resolveInboxView(undefined, "table", false)).toBe("cards");
		expect(resolveInboxView(undefined, "table", true)).toBe("table");
	});
});
