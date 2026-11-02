// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	HomeReferButtonContent,
	type ReferEntryCard,
	ReferEntryRowContent,
	referEntryHint,
	referEntryLine,
} from "./refer-entry";

/**
 * Refer & earn's doors — the profile-menu row, Home's header button and
 * Home's phone row share these words, so a standing the page explains is
 * never a door that promises something else.
 */

function card(over: Partial<ReferEntryCard> = {}): ReferEntryCard {
	return {
		offer: { pro: 60 },
		earns: true,
		pending: 0,
		standing: { canRefer: true, earnsReward: true },
		...over,
	} as unknown as ReferEntryCard;
}

afterEach(cleanup);

describe("the door's words", () => {
	it("an active paid store: both sides get the orders", () => {
		expect(referEntryLine(card())).toBe(
			"Refer a kedai, you both get 60 free orders",
		);
		expect(referEntryHint(card())).toBe("60 free orders each");
	});

	it("a comped store is never promised a reward it doesn't earn", () => {
		const c = card({ earns: false });
		expect(referEntryLine(c)).toBe("Refer a kedai, they get 60 free orders");
		expect(referEntryHint(c)).toBe("they get 60");
	});

	it("a trial store is told when it starts, not shown a dead link", () => {
		const c = card({ standing: { canRefer: false, reason: "trial" } });
		expect(referEntryLine(c)).toBe("Starts once your plan is active");
		expect(referEntryHint(c)).toBe("starts with your plan");
	});

	it.each([
		"paused",
		"lapsed",
	] as const)("a %s store reads paused, not 'starts'", (reason) => {
		const c = card({ standing: { canRefer: false, reason } });
		expect(referEntryLine(c)).toBe("Paused until your plan is active again");
		expect(referEntryHint(c)).toBe("paused");
	});
});

describe("the waiting badge", () => {
	it("a waiting referee replaces the chevron and the hint", () => {
		render(<ReferEntryRowContent card={card({ pending: 2 })} />);
		expect(screen.getByTestId("refer-waiting").textContent).toBe("2 waiting");
		cleanup();
		render(<HomeReferButtonContent card={card({ pending: 1 })} />);
		expect(screen.getByTestId("refer-waiting").textContent).toBe("1 waiting");
		expect(screen.queryByText(/free orders each/)).toBeNull();
	});

	it("is never shown on a paused link — nothing counts while it is paused", () => {
		render(
			<HomeReferButtonContent
				card={card({
					pending: 3,
					standing: { canRefer: false, reason: "paused" },
				})}
			/>,
		);
		expect(screen.queryByTestId("refer-waiting")).toBeNull();
		expect(screen.getByText(/paused/)).toBeTruthy();
	});
});
