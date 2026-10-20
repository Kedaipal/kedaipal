// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ms from "../../../messages/ms.json";
import zh from "../../../messages/zh.json";
import { m } from "../../paraglide/messages";
import { FitCheck } from "./fit-check";

/**
 * "Is Kedaipal for you?" (z8r3fdtpub T2): the three locked ICP gates and the
 * "not yet for you" row, right before pricing, so a hobby seller or a
 * one-off event vendor self-selects out before a demo is booked.
 */

const { trackDemoCta } = vi.hoisted(() => ({ trackDemoCta: vi.fn() }));
vi.mock("../../lib/ga-events", () => ({ trackDemoCta }));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return { ...actual, useReducedMotion: () => true };
});

class NeverInViewObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

describe("FitCheck", () => {
	beforeEach(() => vi.stubGlobal("IntersectionObserver", NeverInViewObserver));
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		trackDemoCta.mockClear();
	});

	it("states the three gates and the not-yet row", () => {
		const { container } = render(<FitCheck />);
		const text = container.textContent ?? "";
		expect(text).toContain(m.fit_gate_1_title());
		expect(text).toContain(m.fit_gate_2_title());
		expect(text).toContain(m.fit_gate_3_title());
		expect(text).toContain(m.fit_not_label());
		expect(text).toContain(m.fit_not_body());
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			m.fit_heading(),
		);
	});

	it("offers WhatsApp for the unsure, as an outline link that reports its placement", () => {
		render(<FitCheck />);
		const link = screen.getByRole("link", { name: m.fit_cta() });
		expect(link.getAttribute("href")).toContain("wa.me/60123456789");
		expect(link.className).not.toContain("bg-accent");
		fireEvent.click(link);
		expect(trackDemoCta).toHaveBeenCalledWith("fit");
	});

	it("never softens the RM2,000 floor, in any locale", () => {
		for (const catalog of [en, ms, zh] as Record<string, string>[]) {
			expect(catalog.fit_gate_1_title).toMatch(/2,000|2000/);
		}
	});
});
