// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import { FLASH_BEAT, HERO_BEATS, HeroStage } from "./hero-stage";

/**
 * The stage is decorative, so the tests pin the two things a screen reader
 * or a reduced-motion visitor actually gets: the transcript, and the final
 * frame as a still. The beat loop itself is covered by `useBeatLoop.test.tsx`.
 */

let reducedMotion = false;

// framer caches the reduced-motion media query on first read, so the flag is
// mocked at the hook rather than at matchMedia; useInView is pinned "in view".
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return {
		...actual,
		useReducedMotion: () => reducedMotion,
		useInView: () => true,
	};
});

/** One `act` per beat — the hook re-arms from an effect (see delivery.test). */
let beatCursor = 0;
function stepLoop(count: number) {
	for (let i = 0; i < count; i++) {
		act(() => vi.advanceTimersByTime(HERO_BEATS[beatCursor]));
		beatCursor = (beatCursor + 1) % HERO_BEATS.length;
	}
}

describe("HeroStage", () => {
	beforeEach(() => {
		reducedMotion = false;
		beatCursor = 0;
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("carries a machine-readable description of the before/after story", () => {
		render(<HeroStage />);
		expect(screen.getByText(m.hero_stage_alt()).className).toContain("sr-only");
	});

	it("opens with the order still on top of the chat and nothing in the inbox yet", () => {
		const { container } = render(<HeroStage />);
		// Beat 0: Aina's order is the newest chat, no arrivals have buried it,
		// and the Kedaipal side shows no status — the order hasn't crossed yet.
		expect(container.textContent).toContain(m.hero_before_name_1());
		expect(container.textContent).not.toContain(m.hero_before_name_5());
		expect(screen.queryByText(m.hero_after_status_1())).toBeNull();
		expect(screen.queryByText(m.hero_before_missed())).toBeNull();
		// Both labels, twice: the desktop chat list AND the phone's Before
		// strip carry the Before pill (one hides per breakpoint).
		expect(screen.getAllByText(m.hero_before_label())).toHaveLength(2);
		expect(container.textContent).toContain(m.hero_after_label());
		expect(screen.queryByText(m.hero_after_flash_tag())).toBeNull();
		expect(container.textContent).toContain(m.hero_after_chip_new());
	});

	it("lands Mira's flash-sale order above Aina's on the sixth beat, with the count and the toast", () => {
		vi.useFakeTimers();
		const { container } = render(<HeroStage />);
		stepLoop(FLASH_BEAT);
		const text = container.textContent ?? "";
		expect(text).toContain(m.hero_after_flash_order());
		expect(text).toContain(m.hero_after_flash_tag());
		expect(text).toContain(m.hero_after_chip_new_2());
		expect(text).not.toContain(m.hero_after_chip_new());
		expect(text).toContain(m.hero_after_toast_5());
		expect(text).not.toContain(m.hero_after_toast_4());
		// Aina's order is still shipped under it; the sale lands ABOVE her.
		expect(text).toContain(m.hero_after_status_4());
		expect(text.indexOf(m.hero_after_flash_order())).toBeLessThan(
			text.indexOf(m.hero_after_order()),
		);
	});

	it("never says a receipt or tracking number was sent — they live on the order page", () => {
		expect(m.hero_after_toast_3()).toMatch(/order page/i);
		expect(m.hero_after_toast_4()).toMatch(/order page/i);
		expect(m.hero_after_toast_3()).not.toMatch(/sent/i);
		expect(m.hero_after_toast_4()).not.toMatch(/sent/i);
	});

	it("renders the final frame as a still under reduced motion", () => {
		reducedMotion = true;
		const { container } = render(<HeroStage />);
		expect(container.textContent).toContain(m.hero_after_status_4());
		expect(container.textContent).toContain(m.hero_before_missed());
		// The last beat is the flash sale: its toast, its card, "New · 2".
		expect(container.textContent).toContain(m.hero_after_toast_5());
		expect(container.textContent).toContain(m.hero_after_flash_order());
		expect(container.textContent).toContain(m.hero_after_chip_new_2());
		// Both arrivals are in, so the order is buried under them.
		expect(container.textContent).toContain(m.hero_before_name_5());
		expect(container.textContent).toContain(m.hero_before_name_6());
		// The pill itself, not the sr-only description (which narrates all four):
		// Aina's reads Shipped; the one Pending pill on screen is Mira's new order.
		expect(screen.getAllByText(m.hero_after_status_1())).toHaveLength(1);
		expect(screen.getByText(m.hero_after_status_4())).toBeTruthy();
	});
});
