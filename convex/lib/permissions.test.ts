import { describe, expect, test } from "vitest";
import {
	hasPermission,
	MAX_GRANTABLE,
	memberPermissionsValidator,
	PERMISSION_AREAS,
	sanitizePermissions,
} from "./permissions";

describe("permission registry", () => {
	test("validator keys and PERMISSION_AREAS can never drift", () => {
		// The validator is written out explicitly (static schema analysis); this
		// pin is what makes that hand-written list safe.
		const validatorKeys = Object.keys(memberPermissionsValidator.fields).sort();
		expect(validatorKeys).toEqual([...PERMISSION_AREAS].sort());
	});

	test("MAX_GRANTABLE covers every area", () => {
		expect(Object.keys(MAX_GRANTABLE).sort()).toEqual(
			[...PERMISSION_AREAS].sort(),
		);
	});

	test("billing write is not grantable in v1 (owner's money)", () => {
		expect(MAX_GRANTABLE.billing).toBe("read");
	});
});

describe("hasPermission", () => {
	test("absent key = none (deny-by-default)", () => {
		expect(hasPermission({}, "orders", "read")).toBe(false);
		expect(hasPermission({}, "orders", "write")).toBe(false);
	});

	test("write implies read; read never implies write", () => {
		expect(hasPermission({ orders: "write" }, "orders", "read")).toBe(true);
		expect(hasPermission({ orders: "write" }, "orders", "write")).toBe(true);
		expect(hasPermission({ orders: "read" }, "orders", "read")).toBe(true);
		expect(hasPermission({ orders: "read" }, "orders", "write")).toBe(false);
	});

	test("a grant on one area says nothing about another", () => {
		expect(hasPermission({ orders: "write" }, "products", "read")).toBe(false);
	});
});

describe("sanitizePermissions", () => {
	test("unknown keys are dropped (a tampered client can't mint areas)", () => {
		const dirty = {
			orders: "write",
			superuser: "write",
		} as unknown as Parameters<typeof sanitizePermissions>[0];
		expect(sanitizePermissions(dirty)).toEqual({ orders: "write" });
	});

	test("levels clamp to MAX_GRANTABLE", () => {
		expect(
			sanitizePermissions({
				billing: "write", // owner-only write in v1 → clamps to read
				insights: "write", // read-only by nature → clamps
				exports: "write", // read-only by nature → clamps
				products: "write", // grantable → kept
			}),
		).toEqual({
			billing: "read",
			insights: "read",
			exports: "read",
			products: "write",
		});
	});

	test("absent stays absent — sanitizing never grants", () => {
		expect(sanitizePermissions({})).toEqual({});
	});
});
