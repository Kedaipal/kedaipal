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
 *   says "fallback", rather than hanging or doing nothing;
 * - focus always LEAVES the search box — to a link if that's all there is,
 *   else to the landing itself — so a phone keyboard never stays up;
 * - a bare wrapper is ringed with room and rounding, the layout unmoved.
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

describe("where focus goes", () => {
	const land = (id: string) =>
		revealSetting(
			root,
			{ target: `#${id}`, section: `#${id}`, opens: [] },
			() => {},
		);

	it("a link is a control: “create your first category” takes focus", () => {
		const block = document.createElement("div");
		block.id = "cats";
		const link = document.createElement("a");
		link.href = "/app/products/categories";
		block.append(link);
		root.append(block);
		land("cats");
		expect(document.activeElement).toBe(link);
	});

	it("with nothing to focus, the landing itself takes it — never the search box", () => {
		const search = input(root, "search");
		search.focus();
		const block = document.createElement("div");
		block.id = "note";
		block.textContent = "Nothing here yet";
		root.append(block);
		land("note");
		expect(document.activeElement).toBe(block);
		block.blur();
		expect(block.hasAttribute("tabindex")).toBe(false);
		expect(block.classList.contains("outline-none")).toBe(false);
	});

	it("a landing that is itself a control takes focus as it is", () => {
		const pill = document.createElement("a");
		pill.id = "currency";
		pill.href = "/app/settings";
		root.append(pill);
		land("currency");
		expect(document.activeElement).toBe(pill);
		expect(pill.hasAttribute("tabindex")).toBe(false);
	});

	it("keeps a tabindex the element already had", () => {
		const block = document.createElement("div");
		block.id = "own";
		block.tabIndex = 0;
		root.append(block);
		land("own");
		block.blur();
		expect(block.getAttribute("tabindex")).toBe("0");
	});
});

describe("the landing ring", () => {
	const land = (id: string) =>
		revealSetting(
			root,
			{ target: `#${id}`, section: `#${id}`, opens: [] },
			() => {},
		);

	it("gives a bare wrapper room and rounding, then takes it back", () => {
		vi.useFakeTimers();
		const wrap = document.createElement("div");
		wrap.id = "weight";
		root.append(wrap);
		land("weight");
		for (const c of ["-m-2", "p-2", "rounded-lg"])
			expect(wrap.classList.contains(c), c).toBe(true);
		vi.advanceTimersByTime(3000);
		for (const c of ["-m-2", "p-2", "rounded-lg"])
			expect(wrap.classList.contains(c), c).toBe(false);
	});

	it("a second pick inside the ring's time restarts it, not cut short by the first", () => {
		vi.useFakeTimers();
		const wrap = document.createElement("div");
		wrap.id = "again";
		root.append(wrap);
		land("again");
		vi.advanceTimersByTime(2000);
		land("again");
		vi.advanceTimersByTime(1000);
		expect(wrap.classList.contains("animate-kp-spotlight")).toBe(true);
		vi.advanceTimersByTime(1500);
		expect(wrap.classList.contains("animate-kp-spotlight")).toBe(false);
	});

	it("leaves an element with its own shape alone", () => {
		const row = document.createElement("li");
		row.id = "row";
		row.style.borderRadius = "12px";
		root.append(row);
		land("row");
		expect(row.classList.contains("p-2")).toBe(false);
		const field = input(root, "field");
		land("field");
		expect(field.classList.contains("p-2")).toBe(false);
	});
});
