// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "./input";
import { InputPrefixFrame } from "./input-prefix-frame";

afterEach(cleanup);

/**
 * The frame LENDS its control the `field` metrics (`z8r3fdr617`).
 *
 * A `bare` input is `px-0` by design — the wrapper owns the chrome. That makes
 * the gap beside the value entirely the plate's doing, so the end the plate is
 * NOT welded to puts the text hard against the border. It shipped exactly that
 * way in the voucher dialog's percentage field, after three earlier call sites
 * had each hand-copied `min-h-11 px-3 text-base` and the fourth forgot.
 *
 * So the frame applies them to its child, and these tests are what stop a
 * future edit quietly taking them away again.
 */
describe("InputPrefixFrame slot metrics", () => {
	function frameOf(side?: "start" | "end"): HTMLElement {
		render(
			<InputPrefixFrame prefix="RM" side={side}>
				<Input variant="bare" aria-label="amount" />
			</InputPrefixFrame>,
		);
		const input = screen.getByLabelText("amount");
		const frame = input.parentElement;
		if (!frame) throw new Error("the frame should be the input's parent");
		return frame;
	}

	it("gives the input the 44px floor, the horizontal gutter and 16px type", () => {
		const cls = frameOf().className;
		// 16px is not cosmetic: iOS Safari zooms the page for a focused input
		// under it.
		expect(cls).toContain("[&>input]:min-h-11");
		expect(cls).toContain("[&>input]:px-3");
		expect(cls).toContain("[&>input]:text-base");
	});

	it("applies them whichever end the plate is welded to", () => {
		// The `end` plate is the case that FOUND this — with no plate on the
		// left there is nothing else holding the value off the border.
		expect(frameOf("end").className).toContain("[&>input]:px-3");
	});

	it("puts the plate after the control for side=end, before it for start", () => {
		render(
			<InputPrefixFrame prefix="%" side="end">
				<Input variant="bare" aria-label="percent" />
			</InputPrefixFrame>,
		);
		const frame = screen.getByLabelText("percent").parentElement;
		// A "%" plate rendered first reads "%10", which is not how anyone
		// writes a percentage.
		expect(frame?.lastElementChild?.textContent).toBe("%");
	});

	it("no call site has to repeat the metrics", () => {
		// The three pre-existing hosts (MyPhoneInput, BuyerPhoneInput,
		// TextField) each carried them by hand; the frame is the one author
		// now, so a bare child passing NO className of its own is correct —
		// and a host that re-adds them is duplicating, not fixing.
		render(
			<InputPrefixFrame prefix="RM">
				<Input variant="bare" aria-label="bare amount" />
			</InputPrefixFrame>,
		);
		const cls = screen.getByLabelText("bare amount").className;
		expect(cls).toContain("px-0");
		expect(cls).not.toContain("px-3");
	});
});
