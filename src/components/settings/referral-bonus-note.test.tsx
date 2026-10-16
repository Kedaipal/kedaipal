// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { referralRefereeOffer } from "../../../convex/lib/referral";
import type { MyReferral } from "../../../convex/referrals";
import { ReferralBonusNote } from "./referral-bonus-note";

afterEach(cleanup);

const referral: MyReferral = {
	referrerName: "Siti's Kitchen",
	offer: referralRefereeOffer(),
	firstInvoicePaid: false,
};

describe("ReferralBonusNote", () => {
	test("on an invoice, says exactly what paying it brings", () => {
		render(<ReferralBonusNote referral={referral} plan="starter" />);
		expect(screen.getByText(/Siti's Kitchen/)).toBeTruthy();
		expect(
			screen.getByText(/pay this invoice and 30 bonus credits land/),
		).toBeTruthy();
		expect(screen.getByText(/last 12 months/)).toBeTruthy();
	});

	test("before a plan is picked, quotes both tiers", () => {
		render(<ReferralBonusNote referral={referral} />);
		expect(screen.getByText(/60 on Pro, 30 on Starter/)).toBeTruthy();
	});

	test("a deleted referrer still reads as a referral", () => {
		render(
			<ReferralBonusNote referral={{ ...referral, referrerName: null }} />,
		);
		expect(screen.getByText("a Kedaipal seller")).toBeTruthy();
	});

	test("goes quiet once the first invoice is paid", () => {
		const { container } = render(
			<ReferralBonusNote
				referral={{ ...referral, firstInvoicePaid: true }}
				plan="pro"
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});
