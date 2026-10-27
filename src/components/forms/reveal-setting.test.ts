// @vitest-environment jsdom
/**
 * `revealSetting` — the one way the product form takes a seller to a field
 * behind collapsed sections (z8r3fdwwy3; shared with focus-error.ts). Pins:
 *
 * - closed panels around the field are asked to open, innermost first,
 *   until the field is visible — then it is scrolled to, ringed and focused;
 * - a box that isn't rendered while closed is asked to open BEFORE the
 *   field can even be found;
 * - a field that never turns up lands on its section after the timeout and
 *   says "fallback", rather than hanging or doing nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE_PANEL_ATTR, REVEAL_EVENT } from "../ui/question-row";
import {
	LAZY_DISCLOSURE_ATTR,
	openEnclosingDisclosure,
	revealSetting,
} from "./reveal-setting";

let root: HTMLElement;

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	root = document.createElement("form");
	document.body.append(root);
});
afterEach(() => {
	root.remove();
	vi.useRealTimers();
});

/** A panel that opens itself on REVEAL_EVENT, the way QuestionRow does. */
function panel(parent: HTMLElement, id: string): HTMLElement {
	const el = document.createElement("div");
	el.id = id;
	el.setAttribute(DISCLOSURE_PANEL_ATTR, "");
	el.hidden = true;
	el.addEventListener(REVEAL_EVENT, () => {
		el.hidden = false;
	});
	parent.append(el);
	return el;
}

function input(parent: HTMLElement, id: string): HTMLInputElement {
	const el = document.createElement("input");
	el.id = id;
	parent.append(el);
	return el;
}

const settled = () => {
	const calls: string[] = [];
	return { calls, onSettled: (o: string) => calls.push(o) };
};

describe("openEnclosingDisclosure", () => {
	it("asks the innermost closed panel to open and reports it had to", () => {
		const outer = panel(root, "outer");
		const inner = panel(outer, "inner");
		const field = input(inner, "f");
		expect(openEnclosingDisclosure(field)).toBe(true);
		expect(inner.hidden).toBe(false);
		expect(outer.hidden).toBe(true);
		expect(openEnclosingDisclosure(field)).toBe(true);
		expect(outer.hidden).toBe(false);
		expect(openEnclosingDisclosure(field)).toBe(false);
	});
});

describe("revealSetting", () => {
	it("lands at once when nothing is in the way", () => {
		const field = input(root, "prep");
		const s = settled();
		revealSetting(
			root,
			{ target: "#prep", section: "#prep", opens: [] },
			s.onSettled,
		);
		expect(s.calls).toEqual(["found"]);
		expect(document.activeElement).toBe(field);
		expect(field.className).toContain("animate-kp-spotlight");
		expect(field.scrollIntoView).toHaveBeenCalled();
	});

	it("opens every closed panel around the field, then focuses it", async () => {
		const row = panel(root, "row");
		const fold = panel(row, "fold");
		const field = input(fold, "sku");
		const s = settled();
		revealSetting(
			root,
			{ target: "#sku", section: "#row", opens: [] },
			s.onSettled,
		);
		await vi.waitFor(() => expect(s.calls).toEqual(["found"]));
		expect(row.hidden).toBe(false);
		expect(fold.hidden).toBe(false);
		expect(document.activeElement).toBe(field);
	});

	it("asks an unrendered box to open before looking for the field in it", async () => {
		const box = document.createElement("div");
		box.setAttribute(LAZY_DISCLOSURE_ATTR, "advanced");
		// Like the Advanced box: its body is only created when asked to open.
		box.addEventListener(REVEAL_EVENT, () => {
			setTimeout(() => input(box, "sku"), 30);
		});
		root.append(box);
		const s = settled();
		revealSetting(
			root,
			{ target: "#sku", section: "#none", opens: ["advanced"] },
			s.onSettled,
		);
		await vi.waitFor(() => expect(s.calls).toEqual(["found"]));
		expect(document.activeElement?.id).toBe("sku");
	});

	it("a row landed on whole opens its own panel and focuses the switch inside", async () => {
		const row = document.createElement("li");
		row.id = "promo";
		const header = document.createElement("button");
		row.append(header);
		const body = panel(row, "promo-panel");
		const toggle = document.createElement("button");
		body.append(toggle);
		root.append(row);
		const s = settled();
		revealSetting(
			root,
			{ target: "#promo", section: "#promo", opens: [] },
			s.onSettled,
		);
		await vi.waitFor(() => expect(s.calls).toEqual(["found"]));
		expect(body.hidden).toBe(false);
		expect(document.activeElement).toBe(toggle);
	});

	it("gives up at the section after the timeout, and says so", async () => {
		vi.useFakeTimers();
		const section = document.createElement("section");
		section.id = "pricing";
		root.append(section);
		const s = settled();
		revealSetting(
			root,
			{ target: "#never", section: "#pricing", opens: [] },
			s.onSettled,
			200,
		);
		await vi.advanceTimersByTimeAsync(150);
		expect(s.calls).toEqual([]);
		await vi.advanceTimersByTimeAsync(100);
		expect(s.calls).toEqual(["fallback"]);
		expect(section.className).toContain("animate-kp-spotlight");
	});

	it("can be cancelled, so a new pick replaces the old one", async () => {
		vi.useFakeTimers();
		const s = settled();
		const cancel = revealSetting(
			root,
			{ target: "#never", section: "#none", opens: [] },
			s.onSettled,
			200,
		);
		cancel();
		await vi.advanceTimersByTimeAsync(500);
		expect(s.calls).toEqual([]);
	});

	it("takes the ring off again once it has drawn the eye", async () => {
		vi.useFakeTimers();
		const field = input(root, "f");
		revealSetting(root, { target: "#f", section: "#f", opens: [] }, () => {});
		expect(field.className).toContain("animate-kp-spotlight");
		await vi.advanceTimersByTimeAsync(3000);
		expect(field.className).not.toContain("animate-kp-spotlight");
	});
});
