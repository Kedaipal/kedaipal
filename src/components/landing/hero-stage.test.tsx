// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import { HeroStage } from "./hero-stage";

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

describe("HeroStage", () => {
	beforeEach(() => {
		reducedMotion = false;
	});
	afterEach(() => {
		cleanup();
	});

	it("carries a machine-readable description of the before/after story", () => {
		render(<HeroStage />);
		expect(screen.getByText(m.hero_stage_alt()).className).toContain("sr-only");
	});

	it("opens on Pending with the order and the WhatsApp inbox", () => {
		const { container } = render(<HeroStage />);
		expect(container.textContent).toContain(m.hero_after_status_1());
		expect(container.textContent).toContain(m.hero_after_order());
		expect(container.textContent).toContain(m.hero_before_label());
		expect(container.textContent).toContain(m.hero_after_label());
	});

	it("renders the final frame as a still under reduced motion", () => {
		reducedMotion = true;
		const { container } = render(<HeroStage />);
		expect(container.textContent).toContain(m.hero_after_status_4());
		expect(container.textContent).toContain(m.hero_before_missed());
		expect(container.textContent).toContain(m.hero_after_toast_4());
		// The pill itself, not the sr-only description (which narrates all four).
		expect(screen.queryByText(m.hero_after_status_1())).toBeNull();
		expect(screen.getByText(m.hero_after_status_4())).toBeTruthy();
	});
});
