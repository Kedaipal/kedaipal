/**
 * `/app/products/new` search contract (`z8r3fdhkr7`). `?card=` is how a
 * What's-new note pre-selects step 0's card; this pins that a hand-typed value
 * can never select something step 0 doesn't render, and that the full form —
 * which has no step 0 — drops the param instead of carrying one that does
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { Route } from "./app.products.new";

const validate = Route.options.validateSearch as (
	search: Record<string, unknown>,
) => { form?: "full"; card?: string };

describe("/app/products/new — validateSearch", () => {
	it("keeps a real step-0 card", () => {
		expect(validate({ card: "event" })).toEqual({ card: "event" });
		expect(validate({ card: "booking" })).toEqual({ card: "booking" });
	});

	it("drops anything else", () => {
		for (const card of ["Event", "rsvp", "", "toString", 3]) {
			expect(validate({ card })).toEqual({});
		}
		expect(validate({})).toEqual({});
	});

	it("the full form drops `card` — it has no step 0 to pre-answer", () => {
		expect(validate({ form: "full", card: "event" })).toEqual({ form: "full" });
		expect(validate({ form: "full" })).toEqual({ form: "full" });
	});
});
