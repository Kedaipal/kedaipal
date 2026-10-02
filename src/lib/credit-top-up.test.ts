import { describe, expect, it } from "vitest";
import { parseTopUpParam, TOP_UP_HREF, TOP_UP_SEARCH } from "./credit-top-up";

describe("the ?topup= contract (Credits T2)", () => {
	it("1 opens the picker — the number a typed URL decodes to, or the quoted string", () => {
		expect(parseTopUpParam(1)).toBe(1);
		expect(parseTopUpParam("1")).toBe(1);
	});

	it("return is the way back from HitPay", () => {
		expect(parseTopUpParam("return")).toBe("return");
	});

	it("anything else is dropped — a hand-typed value can't trigger a reconcile", () => {
		for (const raw of [
			undefined,
			null,
			0,
			2,
			"open",
			"RETURN",
			true,
			{},
			"yes",
		])
			expect(parseTopUpParam(raw)).toBeUndefined();
	});

	it("the link helpers say the same thing the parser accepts", () => {
		expect(parseTopUpParam(TOP_UP_SEARCH.topup)).toBe(1);
		expect(TOP_UP_SEARCH.tab).toBe("billing");
		const url = new URL(TOP_UP_HREF, "https://kedaipal.com");
		expect(url.pathname).toBe("/app/settings");
		expect(url.searchParams.get("tab")).toBe("billing");
		expect(parseTopUpParam(url.searchParams.get("topup"))).toBe(1);
	});
});
