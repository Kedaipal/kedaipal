/**
 * `/app/settings` search contract for the credit-pack picker (Credits T2,
 * z8r3fdf8ht): `topup=1` opens it, `topup=return` is HitPay sending the buyer
 * back, anything else is dropped — and neither disturbs the params beside it.
 */
import { describe, expect, it } from "vitest";
import { Route } from "./app.settings";

const validate = Route.options.validateSearch as (
	search: Record<string, unknown>,
) => Record<string, unknown>;

describe("/app/settings — validateSearch ?topup=", () => {
	it("keeps topup=1 (decoded as a number) and topup=return", () => {
		expect(validate({ tab: "billing", topup: 1 })).toEqual({
			tab: "billing",
			topup: 1,
		});
		expect(validate({ tab: "billing", topup: "return" })).toEqual({
			tab: "billing",
			topup: "return",
		});
	});

	it("drops anything else", () => {
		for (const topup of ["open", 2, "", true])
			expect(validate({ tab: "billing", topup })).toEqual({ tab: "billing" });
	});

	it("rides beside the other billing return flags without touching them", () => {
		expect(validate({ tab: "billing", paid: "return", topup: 1 })).toEqual({
			tab: "billing",
			paid: "return",
			topup: 1,
		});
	});
});
