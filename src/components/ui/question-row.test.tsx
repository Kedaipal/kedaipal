// @vitest-environment jsdom
/**
 * The question row (z8r3fdv1z2): a capability asked as a question, collapsed
 * to one line that carries its current answer. Pins the four rules the row
 * owns — collapsed by default, the panel stays mounted while closed, a
 * `REVEAL_EVENT` opens it, and the Pro pill shows on the header.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	DISCLOSURE_PANEL_ATTR,
	QuestionGroup,
	QuestionRow,
	REVEAL_EVENT,
} from "./question-row";

afterEach(cleanup);

function renderRow(props: Partial<Parameters<typeof QuestionRow>[0]> = {}) {
	return render(
		<QuestionGroup title="Selling options">
			<QuestionRow
				icon={<span />}
				question="Is it on sale right now?"
				answer="No"
				{...props}
			>
				<input id="inside" aria-label="Sale price" />
			</QuestionRow>
		</QuestionGroup>,
	);
}

const header = () =>
	screen.getByRole("button", { name: /Is it on sale right now/ });
const panel = () =>
	document.querySelector(`[${DISCLOSURE_PANEL_ATTR}]`) as HTMLElement;

describe("QuestionRow", () => {
	it("is collapsed by default, with the answer on the header", () => {
		renderRow({ answer: "Yes · 20% off" });
		expect(header().getAttribute("aria-expanded")).toBe("false");
		expect(header().textContent).toContain("Yes · 20% off");
		// Mounted but hidden: a half-typed draft survives a collapse.
		expect(panel().hidden).toBe(true);
		expect(document.getElementById("inside")).not.toBeNull();
	});

	it("opens and closes from the header, wiring aria-controls to the panel", () => {
		renderRow();
		fireEvent.click(header());
		expect(header().getAttribute("aria-expanded")).toBe("true");
		expect(panel().hidden).toBe(false);
		expect(header().getAttribute("aria-controls")).toBe(panel().id);
		fireEvent.click(header());
		expect(panel().hidden).toBe(true);
	});

	it("opens itself when asked to reveal (a refused save inside it)", () => {
		renderRow();
		fireEvent(panel(), new CustomEvent(REVEAL_EVENT));
		expect(header().getAttribute("aria-expanded")).toBe("true");
		expect(panel().hidden).toBe(false);
	});

	it("opens at mount for a deep link", () => {
		renderRow({ defaultOpen: true });
		expect(panel().hidden).toBe(false);
	});

	it("shows a badge on the header, so a locked feature is visible closed", () => {
		renderRow({ badge: <span>Pro</span> });
		expect(header().textContent).toContain("Pro");
	});

	it("labels the group for assistive tech", () => {
		renderRow();
		expect(
			screen.getByRole("region", { name: "Selling options" }),
		).toBeTruthy();
	});

	it("marks an error row so it reads differently from a merely-on one", () => {
		renderRow({ tone: "error", answer: "Needs a fix before you can save" });
		const answer = header().querySelector("[data-question-answer]");
		expect(answer?.className).toContain("text-destructive");
	});
});
