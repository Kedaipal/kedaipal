// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both halves of the answer are hooks — stub them at their own seams so the
// test is about the PRECEDENCE, not about wiring a retailer payload.
const store = { readOnly: false, reason: "" };
const viewer = {
	role: "member" as "owner" | "member" | "admin" | undefined,
	canWrite: false,
};
vi.mock("./usePermission", () => ({
	useStoreRole: () => viewer.role,
	useIsStoreOwner: () => viewer.role !== "member",
	usePermission: () => ({
		canRead: true,
		canWrite: viewer.canWrite,
		role: viewer.role,
	}),
}));
vi.mock("./useDashboardRetailer", () => ({
	useDashboardRetailer: () => ({ subscription: { status: "active" } }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: false }) }));
vi.mock("../lib/subscription", () => ({
	isStoreReadOnly: () => store.readOnly,
	storeReadOnlyReason: () => store.reason,
}));

import { useAreaLock } from "./useStoreLock";

afterEach(() => {
	store.readOnly = false;
	store.reason = "";
	viewer.role = "member";
	viewer.canWrite = false;
});

describe("useAreaLock", () => {
	it("locks a member who holds view but not edit, and names the area", () => {
		const { result } = renderHook(() => useAreaLock("orders"));
		expect(result.current.readOnly).toBe(true);
		expect(result.current.reason).toMatch(/edit access to change orders/i);
	});

	it("leaves a member with edit alone", () => {
		viewer.canWrite = true;
		expect(
			renderHook(() => useAreaLock("orders")).result.current.readOnly,
		).toBe(false);
	});

	it("never locks an owner on grants", () => {
		viewer.role = "owner";
		viewer.canWrite = true;
		expect(
			renderHook(() => useAreaLock("customers")).result.current.readOnly,
		).toBe(false);
	});

	// The subscription is the store-wide fact and it blocks the owner too;
	// "ask the owner for edit access" would send a teammate chasing a grant
	// that still wouldn't let them save.
	it("a lapsed subscription outranks the grant reason", () => {
		store.readOnly = true;
		store.reason = "This store's subscription is past due.";
		const { result } = renderHook(() => useAreaLock("orders"));
		expect(result.current.readOnly).toBe(true);
		expect(result.current.reason).toBe(
			"This store's subscription is past due.",
		);
		expect(result.current.reason).not.toMatch(/edit access/i);
	});

	// Until the payload lands `role` is undefined — nothing must flash
	// disabled for an owner on first paint.
	it("does not lock while the viewer is still unknown", () => {
		viewer.role = undefined;
		expect(
			renderHook(() => useAreaLock("orders")).result.current.readOnly,
		).toBe(false);
	});
});
