// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { referralRefereeOffer } from "../../../convex/lib/referral";
import { ReferralInvitePill } from "./referral-invite-pill";

afterEach(cleanup);

const invite = {
	slug: "siti-kitchen",
	storeName: "Siti's Kitchen",
	offer: referralRefereeOffer(),
};

describe("ReferralInvitePill", () => {
	test("names the referrer and the referee's bonus on each tier", () => {
		render(<ReferralInvitePill invite={invite} />);
		expect(screen.getByText("Invited by Siti's Kitchen")).toBeTruthy();
		expect(
			screen.getByText(
				"Get 60 bonus credits when you start Pro, or 30 on Starter",
			),
		).toBeTruthy();
	});

	test("holds its place while an expected invite resolves", () => {
		const { container } = render(<ReferralInvitePill invite={undefined} />);
		const placeholder = container.firstElementChild;
		expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
		expect(screen.queryByText(/Invited by/)).toBeNull();
	});

	test("renders nothing without an invite", () => {
		const { container } = render(<ReferralInvitePill invite={null} />);
		expect(container.firstChild).toBeNull();
	});
});
