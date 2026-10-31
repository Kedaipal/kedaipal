import { describe, expect, test } from "vitest";
import { referralRefereeOffer } from "../../convex/lib/referral";
import { referralMeta } from "./referral-meta";

describe("referral link preview", () => {
	test("names the inviting store and the referee's offer", () => {
		const meta = referralMeta({
			slug: "siti-kitchen",
			storeName: "Siti's Kitchen",
			offer: referralRefereeOffer(),
		});
		expect(meta.title).toBe("Siti's Kitchen invited you to Kedaipal");
		expect(meta.description).toContain("60 free orders when you start Pro");
		expect(meta.description).toContain("30 on Starter");
	});

	test("never claims a discount — rewards are credits only", () => {
		const meta = referralMeta({
			slug: "x",
			storeName: "X",
			offer: referralRefereeOffer(),
		});
		expect(`${meta.title} ${meta.description}`).not.toMatch(/%|off|discount/i);
	});
});
