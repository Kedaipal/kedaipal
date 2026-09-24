// @vitest-environment jsdom
/**
 * A settings deep link (`?spot=` / `?fix=`) has to LAND on its card
 * (z8r3fdhpm7, found in the Chrome test): the old one-frame attempt ran while
 * the tab was still a skeleton, so the ring pulsed below the fold and the
 * seller was left at the top of the tab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealAnchorWhenMounted } from "./country-setup-copy";

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
