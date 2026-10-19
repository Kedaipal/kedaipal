// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveSection, useSectionVisibility } from "./useActiveSection";

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

function mountSections(...ids: string[]) {
	document.body.innerHTML = ids
		.map((id) => `<section id="${id}"></section>`)
		.join("");
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
		mountSections("top");
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

describe("useActiveSection", () => {
	beforeEach(() => {
		observers.length = 0;
		vi.stubGlobal("IntersectionObserver", FakeObserver);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("names the section most recently seen, and keeps it when it leaves", () => {
		mountSections("top", "flow", "pricing");
		const { result } = renderHook(() =>
			useActiveSection(["top", "flow", "pricing"]),
		);
		expect(result.current).toBeNull();
		report("top", true);
		expect(result.current).toBe("top");
		report("flow", true);
		expect(result.current).toBe("flow");
		// Scrolling on: the last section seen stays the answer until a new one
		// reports — the reader is between sections, not nowhere.
		report("flow", false);
		expect(result.current).toBe("flow");
	});
});
