import { describe, expect, test, vi } from "vitest";
import { ssrRead } from "./ssr-read";

describe("ssrRead", () => {
	test("wraps a successful read, preserving null results", async () => {
		expect(await ssrRead(async () => "value")).toEqual({
			ok: true,
			value: "value",
		});
		// A query that ANSWERS null (bad token/slug) must stay distinguishable
		// from a query that failed — callers 404 on the former, soft-render on
		// the latter. Collapsing them would 404 valid orders on a blip.
		expect(await ssrRead(async () => null)).toEqual({ ok: true, value: null });
	});

	test("maps a thrown error to ok:false instead of rethrowing", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await ssrRead(async () => {
					throw new Error("Too many requests");
				}),
			).toEqual({ ok: false });
			expect(spy).toHaveBeenCalledOnce();
		} finally {
			spy.mockRestore();
		}
	});

	test("catches synchronous throws from the thunk", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await ssrRead(() => {
					throw new Error("boom");
				}),
			).toEqual({ ok: false });
		} finally {
			spy.mockRestore();
		}
	});
});
