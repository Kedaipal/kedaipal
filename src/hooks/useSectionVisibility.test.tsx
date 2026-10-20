// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSectionVisibility } from "./useSectionVisibility";

/**
 * A controllable IntersectionObserver: records each observed element's
 * callback so a test can report it entering or leaving the viewport.
 */
type Entry = { target: Element; isIntersecting: boolean };
const observers: { cb: (entries: Entry[]) => void; targets: Element[] }[] = [];

class FakeObserver {
	targets: Element[] = [];
	constructor(cb: (entries: Entry[]) => void) {
		observers.push({ cb, targets: this.targets });
	}
	observe(el: Element) {
		this.targets.push(el);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function report(id: string, isIntersecting: boolean) {
	const el = document.getElementById(id);
	if (!el) throw new Error(`no #${id}`);
	for (const o of observers) {
		if (o.targets.includes(el))
			act(() => o.cb([{ target: el, isIntersecting }]));
	}
}

describe("useSectionVisibility", () => {
	beforeEach(() => {
		observers.length = 0;
		vi.stubGlobal("IntersectionObserver", FakeObserver);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("reads null until the section reports, then follows it", () => {
		document.body.innerHTML = '<section id="top"></section>';
		const { result } = renderHook(() => useSectionVisibility("top"));
		expect(result.current).toBeNull();
		report("top", true);
		expect(result.current).toBe(true);
		report("top", false);
		expect(result.current).toBe(false);
	});

	it("stays null for a section that is not on the page", () => {
		const { result } = renderHook(() => useSectionVisibility("missing"));
		expect(result.current).toBeNull();
	});
});
