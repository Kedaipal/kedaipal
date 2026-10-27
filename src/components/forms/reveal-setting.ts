import { highlightRingClass } from "../../lib/country-setup-copy";
import { DISCLOSURE_PANEL_ATTR, REVEAL_EVENT } from "../ui/question-row";
import type { LazyContainer } from "./product-setting-index";

/**
 * Taking a seller to one field on a long form of collapsed sections — the
 * shared path behind "take me to the error" (`focus-error.ts`) and the
 * product form's "Find a setting" (z8r3fdwwy3).
 *
 * Two kinds of disclosure stand in the way:
 *  - **Mounted while closed** (`hidden`, marked `DISCLOSURE_PANEL_ATTR`): the
 *    question rows and the choice lists. The field is in the DOM, so walk up
 *    from it and ask each closed panel to open (`REVEAL_EVENT`).
 *  - **Not rendered while closed** (`LAZY_DISCLOSURE_ATTR`): the price card's
 *    Advanced box. The field can't be found until the box opens, so the
 *    caller names it (`opens`) and it is asked first.
 */

/** Marks a disclosure whose body is NOT rendered while it is closed. Its
 * element listens for `REVEAL_EVENT` and opens. */
export const LAZY_DISCLOSURE_ATTR = "data-lazy-disclosure";

/**
 * Ask the innermost closed panel around `el` to open. `true` = it had to
 * ask, so `el` isn't visible yet and the caller should look again once it
 * renders (a second closed panel further out is found on that next look).
 */
export function openEnclosingDisclosure(el: HTMLElement): boolean {
	const closed = el.closest<HTMLElement>(`[${DISCLOSURE_PANEL_ATTR}][hidden]`);
	if (!closed) return false;
	closed.dispatchEvent(new CustomEvent(REVEAL_EVENT));
	return true;
}

/** A question row landed on as a whole: open its own panel too. */
function openOwnPanel(el: HTMLElement): boolean {
	const own = el.querySelector<HTMLElement>(
		`:scope > [${DISCLOSURE_PANEL_ATTR}][hidden]`,
	);
	if (!own) return false;
	own.dispatchEvent(new CustomEvent(REVEAL_EVENT));
	return true;
}

const FOCUSABLE =
	"input:not([type='hidden']):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href]";

/** The control a seller should be typing into once they land on `el`: the
 * field itself, else the first control inside an opened panel (a row's
 * switch), else the first control at all — a link counts ("create your
 * first category"). */
function focusTarget(el: HTMLElement): HTMLElement | null {
	if (el.matches("input, textarea, select")) return el;
	return (
		el.querySelector<HTMLElement>(
			`[${DISCLOSURE_PANEL_ATTR}] :is(${FOCUSABLE})`,
		) ?? el.querySelector<HTMLElement>(FOCUSABLE)
	);
}

/** Focus must always LEAVE the search box: left behind, it sits off-screen
 * and a phone's keyboard stays up over the place the seller was sent. With
 * no control to take it, the landing itself does, for as long as it holds
 * it. */
function focusLanding(el: HTMLElement) {
	const control = focusTarget(el);
	if (control) {
		control.focus({ preventScroll: true });
		return;
	}
	const borrowed = !el.hasAttribute("tabindex");
	if (borrowed) el.setAttribute("tabindex", "-1");
	// The ring is the focus mark here; the browser's own outline would be a
	// second one.
	el.classList.add("outline-none");
	el.addEventListener(
		"blur",
		() => {
			el.classList.remove("outline-none");
			if (borrowed) el.removeAttribute("tabindex");
		},
		{ once: true },
	);
	el.focus({ preventScroll: true });
}

/** A bare wrapper (no padding, margin or rounding — a label around one
 * field) would wear the ring flush on its text with square corners. Grow it
 * by the same amount it is pulled out, so the ring has room and the layout
 * doesn't move. */
const BARE_RING = ["-m-2", "p-2", "rounded-lg"];

function isBare(el: HTMLElement): boolean {
	if (el.matches("input, textarea, select")) return false;
	const s = getComputedStyle(el);
	const zero = (v: string) => v === "" || v === "0px";
	return [
		s.borderRadius,
		s.paddingTop,
		s.paddingRight,
		s.paddingBottom,
		s.paddingLeft,
		s.marginTop,
		s.marginRight,
		s.marginBottom,
		s.marginLeft,
	].every(zero);
}

/** How long the landing ring stays — the spotlight pulse runs once inside it. */
const RING_MS = 2400;

function land(el: HTMLElement) {
	// Instant, never smooth: a smooth scroll over a long distance was measured
	// moving the page 0px in Chrome (see focus-error.ts). Optional-called —
	// jsdom has no scrollIntoView.
	el.scrollIntoView?.({ block: "center" });
	const ring = [
		...highlightRingClass("spotlight").split(" "),
		...(isBare(el) ? BARE_RING : []),
	];
	el.classList.add(...ring);
	setTimeout(() => el.classList.remove(...ring), RING_MS);
	focusLanding(el);
}

export type RevealLanding = {
	/** Selector for the field (or its section when it can't be used). */
	target: string;
	/** Its card or row — the fallback landing. */
	section: string;
	opens: readonly LazyContainer[];
};

export type RevealOutcome = "found" | "fallback";

/** Gave up looking — leave the seller at the section rather than hang. */
export const REVEAL_TIMEOUT_MS = 2000;
// ~One frame. A TIMER, never rAF: a hidden document never runs rAF, and a
// covered Chrome window is hidden (z8r3fdrkq2, see focus-error.ts).
const RETRY_MS = 16;

/**
 * Open everything between the seller and `landing.target`, then scroll to
 * it, ring it and focus it. Resolves in the same tick when nothing is in the
 * way; otherwise looks again every frame while sections open and render.
 * After `REVEAL_TIMEOUT_MS` it lands on the section instead and reports
 * "fallback", so the caller can say so. Returns a cancel for an effect.
 */
export function revealSetting(
	root: HTMLElement,
	landing: RevealLanding,
	onSettled: (outcome: RevealOutcome) => void,
	timeoutMs = REVEAL_TIMEOUT_MS,
): () => void {
	let done = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const askedLazy = new Set<LazyContainer>();
	const started = Date.now();

	const settle = (outcome: RevealOutcome) => {
		done = true;
		if (timer !== undefined) clearTimeout(timer);
		onSettled(outcome);
	};

	const attempt = (): boolean => {
		const el = root.querySelector<HTMLElement>(landing.target);
		if (!el) {
			for (const key of landing.opens) {
				if (askedLazy.has(key)) continue;
				askedLazy.add(key);
				root
					.querySelector<HTMLElement>(`[${LAZY_DISCLOSURE_ATTR}="${key}"]`)
					?.dispatchEvent(new CustomEvent(REVEAL_EVENT));
			}
			return false;
		}
		if (openEnclosingDisclosure(el) || openOwnPanel(el)) return false;
		land(el);
		return true;
	};

	const loop = () => {
		if (done) return;
		if (attempt()) return settle("found");
		if (Date.now() - started >= timeoutMs) {
			const section = root.querySelector<HTMLElement>(landing.section);
			if (section) {
				openEnclosingDisclosure(section);
				land(section);
			}
			return settle("fallback");
		}
		timer = setTimeout(loop, RETRY_MS);
	};

	if (attempt()) {
		settle("found");
	} else {
		// Something visible happens on the tap even while a big section is
		// still rendering: the section the field lives in comes into view.
		root
			.querySelector<HTMLElement>(landing.section)
			?.scrollIntoView?.({ block: "start" });
		timer = setTimeout(loop, RETRY_MS);
	}
	return () => {
		done = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}
