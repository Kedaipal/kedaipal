/**
 * The Kedaipal-credits stub in the profile menu, and the balance line on the
 * avatar row that opens it (z8r3fdx34j, Zaki's 29 Oct picks: the 2A outlined
 * torn receipt). Pure, so every state is pinned by a test: the menu renders
 * whatever this returns and decides nothing itself.
 *
 * What it reuses rather than restates — one rule, one author:
 *  - `ordersBalanceLabel` for the headline ("54 orders left" / "3 orders owed");
 *  - `creditTone` (the last-20% rule) for ok / low / out;
 *  - `creditPaceLine`'s arithmetic for the runway on a low balance;
 *  - `lockCta` for the one button when orders are waiting.
 *
 * Copy rule (docs/credits.md): credits are ORDERS — never money, never a
 * "wallet", never a percentage.
 */

import type { CreditBalanceView } from "../../convex/credits";
import {
	type CreditUnlockRoute,
	refreshedPlanBalance,
} from "../../convex/lib/credits";
import { TOP_UP_SEARCH } from "./credit-top-up";
import {
	creditTone,
	lockCta,
	ordersBalanceLabel,
	ordersWaitingLabel,
} from "./credits-ui";

/** "1 Nov" — the stub's leader line has no room for a year, and the reset is
 * always within the month. Malaysia/Singapore time (both UTC+8), so the 1st
 * reads as the 1st on any device. */
const STUB_DATE = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "Asia/Kuala_Lumpur",
});
export function stubDate(ms: number): string {
	return STUB_DATE.format(ms);
}

/** Dots on the stub's perforation: one row of the month's grant. */
export const STUB_DOTS = 20;

export type StubTone = "ok" | "low" | "out" | "onus";

export type StubButton = {
	label: string;
	search: { tab: "billing"; topup?: 1 };
	/** Set when this reader can't act on it — the button greys out and this
	 * sentence takes the leader line's place. */
	disabledReason: string | null;
};

export type CreditStub = {
	tone: StubTone;
	/** The rotated rubber stamp, when the state needs one. */
	stamp: "Low" | "Waiting" | "Trial" | "On us" | null;
	headline: string;
	/** Filled dots out of STUB_DOTS. */
	filled: number;
	/** The dotted-leader line: "Resets ........ 1 Nov · 200". */
	leader: { label: string; value: string };
	button: StubButton | null;
	/** The avatar row's second line. */
	triggerLine: string;
	/** The avatar's tone dot — none when healthy. */
	dot: "low" | "out" | null;
};

export type CreditStubInput = {
	/** `credits.getBalance` — null = unmetered (no balance at all). */
	balance: CreditBalanceView | null;
	/** Live orders waiting on credits (`useCreditGate`). */
	ordersWaiting: number;
	route: CreditUnlockRoute;
	/** The reader can act on the lock's way back (`useCreditGate.canAct`). */
	canAct: boolean;
	/** Orders a day at this week's pace (`credits.getUsagePace`). */
	perDay: number;
	/** Why this reader can't buy a pack (`topUpOptions`), or null. */
	topUpRefusal: string | null;
	/** Packs are sold on this deployment AND the store can be locked. */
	topUpSold: boolean;
	/** The unmetered store is sponsored (comped), not a Kedaipal-owned one. */
	sponsored: boolean;
};

function runwayDays(balance: number, perDay: number): number | null {
	if (perDay < 1 || balance <= 0) return null;
	return Math.max(1, Math.round(balance / perDay));
}

export function creditStub(input: CreditStubInput): CreditStub {
	const { balance } = input;

	// Unmetered: still shown (Zaki, 29 Oct) — the stub is how a store learns
	// what a credit is, and "on us" is good news worth seeing.
	if (balance === null) {
		return {
			tone: "onus",
			stamp: "On us",
			headline: "∞ orders",
			filled: STUB_DOTS,
			leader: input.sponsored
				? { label: "Plan", value: "Sponsored" }
				: { label: "Orders", value: "Unlimited" },
			button: null,
			triggerLine: "Unlimited orders",
			dot: null,
		};
	}

	const tone = creditTone(balance.total, balance.periodGrant);
	const filled =
		balance.periodGrant > 0
			? Math.max(
					0,
					Math.min(
						STUB_DOTS,
						Math.round(
							(Math.max(0, balance.plan) / balance.periodGrant) * STUB_DOTS,
						),
					),
				)
			: 0;
	const resets =
		balance.refreshesAt !== null && balance.nextGrant !== null
			? {
					label: "Resets",
					date: stubDate(balance.refreshesAt),
					value: `${stubDate(balance.refreshesAt)} · ${Math.max(
						0,
						refreshedPlanBalance(balance.plan, balance.nextGrant),
					)}`,
				}
			: null;

	const topUp = (label: string): StubButton | null =>
		input.topUpSold
			? {
					label,
					search: TOP_UP_SEARCH,
					disabledReason: input.topUpRefusal,
				}
			: null;

	// Orders waiting: the count the seller can act on, in red, every dot torn.
	if (input.ordersWaiting > 0) {
		const cta = lockCta(input.route);
		return {
			tone: "out",
			stamp: "Waiting",
			headline: `${input.ordersWaiting} ${input.ordersWaiting === 1 ? "order" : "orders"} waiting`,
			filled: 0,
			leader: resets
				? { label: resets.label, value: resets.value }
				: { label: "Balance", value: ordersBalanceLabel(balance.total) },
			button: {
				label: cta.label,
				search: cta.search,
				disabledReason: input.canAct
					? null
					: "Only the store owner can do this — ask them.",
			},
			triggerLine:
				ordersWaitingLabel(input.ordersWaiting) ??
				ordersBalanceLabel(balance.total),
			dot: "out",
		};
	}

	if (balance.regime === "trial") {
		return {
			tone: tone === "ok" ? "ok" : tone,
			stamp: "Trial",
			headline: ordersBalanceLabel(balance.total),
			filled,
			leader: { label: "Trial", value: `${balance.periodGrant} orders` },
			button: {
				label: "Pick a plan",
				search: { tab: "billing" },
				disabledReason: null,
			},
			triggerLine: ordersBalanceLabel(balance.total),
			dot: tone === "low" ? "low" : tone === "out" ? "out" : null,
		};
	}

	const days = tone === "low" ? runwayDays(balance.total, input.perDay) : null;
	const runway =
		days !== null ? `about ${days} ${days === 1 ? "day" : "days"}` : null;

	return {
		tone,
		stamp: tone === "low" ? "Low" : null,
		headline: ordersBalanceLabel(balance.total),
		filled,
		leader:
			runway && resets
				? { label: capitalise(runway), value: resets.date }
				: resets
					? { label: resets.label, value: resets.value }
					: { label: "Bought", value: `${balance.purchased} orders` },
		button: topUp(tone === "out" ? "Top up credits" : "Top up"),
		triggerLine: runway
			? `${ordersBalanceLabel(balance.total)} · ${runway}`
			: ordersBalanceLabel(balance.total),
		dot: tone === "low" ? "low" : tone === "out" ? "out" : null,
	};
}

function capitalise(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}
