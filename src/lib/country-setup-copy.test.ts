// @vitest-environment jsdom
/**
 * A settings deep link (`?spot=` / `?fix=`) has to LAND on its card
 * (z8r3fdhpm7, found in the Chrome test): the old one-frame attempt ran while
 * the tab was still a skeleton, so the ring pulsed below the fold and the
 * seller was left at the top of the tab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	autoRenewMethodPhrase,
	countrySetupCopy,
	revealAnchorWhenMounted,
	SETTINGS_ANCHOR,
} from "./country-setup-copy";

afterEach(() => {
	document.body.innerHTML = "";
	vi.useRealTimers();
});

function mountCard(id: string) {
	const card = document.createElement("section");
	card.id = id;
	card.scrollIntoView = vi.fn();
	document.body.append(card);
	return card;
}

describe("billing_currency copy (86eyp7hn7)", () => {
	const item = {
		key: "billing_currency" as const,
		severity: "money" as const,
		verifiable: false,
	};

	it("with nothing attached: states the rule and the way back, never a claim about the past", () => {
		const copy = countrySetupCopy(item, "SG", "MY", { autoRenewOn: false });
		expect(copy.title).toBe("Your Kedaipal subscription now bills in SGD");
		expect(copy.body).toContain("Every invoice from your next one is in SGD");
		expect(copy.body).toContain(
			"Auto-renewal is off: a method saved in MYR can't be charged in SGD",
		);
		expect(copy.body).toContain("Turn it on from Billing with an SGD card");
		// "If auto-renewal was on" read as a claim about a seller who never
		// had it (Chrome test, 28 Oct 2026).
		expect(copy.body).not.toMatch(/if auto-renewal was on/i);
		expect(copy.tab).toBe("billing");
		expect(copy.action).toBe("Open Billing");
		// The money chip's default says "Payments at risk" — the buyer's. This
		// row is the seller's own bill.
		expect(copy.chip).toBe("Your subscription");
		// The deep link rings the auto-renewal card, which is where "set it up
		// again" happens.
		expect(SETTINGS_ANCHOR.billing_currency).toBe("settings-auto-renewal");
	});

	it("with a method attached again: no 'set it up' — it is set up", () => {
		const copy = countrySetupCopy(item, "SG", "MY", { autoRenewOn: true });
		expect(copy.body).toBe(
			"Every invoice from your next one is in SGD, at the Singapore price, and auto-renewal is set up for it.",
		);
	});

	it("never invents the previous country on an older, un-stamped row", () => {
		const copy = countrySetupCopy(item, "MY", undefined, {
			autoRenewOn: false,
		});
		expect(copy.body).toContain("a method saved in another currency");
		expect(copy.body).not.toContain("undefined");
	});

	it("names the rails a currency can actually save, article included", () => {
		// MYR tokenises card + Touch 'n Go; SGD is card-only (PayNow can't be
		// tokenised). "a SGD card" was the toast's grammar before this.
		expect(autoRenewMethodPhrase("MYR")).toBe("a card or Touch 'n Go");
		expect(autoRenewMethodPhrase("SGD")).toBe("an SGD card");
	});
});

describe("revealAnchorWhenMounted", () => {
	it("waits for a card that mounts late, then scrolls to it once", async () => {
		const stop = revealAnchorWhenMounted("closed-dates");
		await new Promise((r) => setTimeout(r, 20));
		const card = mountCard("closed-dates");
		await new Promise((r) => setTimeout(r, 0));
		expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
		// Later renders never yank the page back.
		document.body.append(document.createElement("div"));
		await new Promise((r) => setTimeout(r, 0));
		expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
		stop();
	});

	it("gives up after its window, so a card that never renders can't scroll later", async () => {
		vi.useFakeTimers();
		revealAnchorWhenMounted("closed-dates", 1000);
		vi.advanceTimersByTime(1500);
		const card = mountCard("closed-dates");
		await vi.runAllTimersAsync();
		expect(card.scrollIntoView).not.toHaveBeenCalled();
	});

	it("a hidden tab (a cmd-clicked link) jumps — its smooth scroll would never run", async () => {
		const visibility = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("hidden");
		const card = mountCard("closed-dates");
		const stop = revealAnchorWhenMounted("closed-dates");
		document.body.append(document.createElement("div"));
		await new Promise((r) => setTimeout(r, 0));
		expect(card.scrollIntoView).toHaveBeenCalledWith({
			behavior: "auto",
			block: "start",
		});
		stop();
		visibility.mockRestore();
	});

	it("cleanup stops the watch", async () => {
		const stop = revealAnchorWhenMounted("closed-dates");
		stop();
		const card = mountCard("closed-dates");
		await new Promise((r) => setTimeout(r, 20));
		expect(card.scrollIntoView).not.toHaveBeenCalled();
	});
});
