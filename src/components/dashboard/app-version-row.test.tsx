// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../lib/app-version";
import { AppVersionRow } from "./app-version-row";

afterEach(cleanup);

describe("AppVersionRow", () => {
	it("renders the running version", () => {
		render(<AppVersionRow />);
		expect(screen.getByText("Version", { exact: false })).toBeTruthy();
		expect(screen.getByText(APP_VERSION)).toBeTruthy();
	});

	it("offers a copy control whose accessible name carries the version", () => {
		// The visible "Copy" label is sr-only here (the row sits in tight nav
		// chrome), so the aria-label is the ONLY thing a screen-reader user gets.
		// If it ever degrades to a bare "Copy" this test fails — an unlabelled
		// icon button in the nav footer is indistinguishable from the others.
		render(<AppVersionRow />);
		expect(
			screen.getByRole("button", { name: `Copy app version ${APP_VERSION}` }),
		).toBeTruthy();
	});

	it("writes the version to the clipboard on tap", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		render(<AppVersionRow />);
		screen.getByRole("button", { name: /Copy app version/ }).click();

		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(APP_VERSION));
		vi.unstubAllGlobals();
	});

	it("keeps a 44px minimum tap target on the copy control", () => {
		// Mobile-first hard requirement — this row lives in the More panel, where
		// it sits directly above the bottom nav and is easy to fat-finger.
		render(<AppVersionRow />);
		const btn = screen.getByRole("button", { name: /Copy app version/ });
		expect(btn.className).toContain("min-h-[44px]");
	});
});

describe("AppVersionRow — compact pill", () => {
	it("keeps a 44px touch target below lg, released at lg", () => {
		// PR #218 review, MEDIUM. The pill renders in two chromes with different
		// input models: below `lg` its only host is the mobile More sheet
		// (touch-only, hard ≥44px rule, and a miss lands on the adjacent
		// "What's new" button); from `lg` up it is the desktop sidebar's meta
		// line, where a 44px row would bloat the footer.
		//
		// So the hit area must live on the BUTTON and be released at the
		// breakpoint — shrinking the visual pill must never shrink the target.
		render(<AppVersionRow compact />);
		const btn = screen.getByRole("button", { name: /copy/i });
		expect(btn.className).toContain("min-h-11");
		expect(btn.className).toContain("min-w-11");
		expect(btn.className).toContain("lg:min-h-0");
		expect(btn.className).toContain("lg:min-w-0");
	});

	it("still copies the version", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		render(<AppVersionRow compact />);
		screen.getByRole("button", { name: /copy/i }).click();

		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(APP_VERSION));
		vi.unstubAllGlobals();
	});

	it("shows the version number, not a label", () => {
		render(<AppVersionRow compact />);
		expect(screen.getByText(APP_VERSION)).toBeTruthy();
		expect(screen.queryByText("Version", { exact: false })).toBeNull();
	});
});
