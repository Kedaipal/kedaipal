// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { __resetThemeStoreForTests, THEME_STORAGE_KEY } from "../../lib/theme";
import { AppearanceTab } from "./appearance-tab";

/** jsdom ships no matchMedia; the store treats a throw as "light". */
function stubMatchMedia(prefersDark: boolean) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: query.includes("dark") ? prefersDark : false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
	});
}

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	stubMatchMedia(false);
	__resetThemeStoreForTests();
});

afterEach(() => {
	cleanup();
	__resetThemeStoreForTests();
});

describe("AppearanceTab", () => {
	test("offers exactly the three preferences", () => {
		render(<AppearanceTab />);
		const radios = screen.getAllByRole("radio");
		expect(radios).toHaveLength(3);
		expect(screen.getByText("Light")).toBeTruthy();
		expect(screen.getByText("Dark")).toBeTruthy();
		expect(screen.getByText("Match device")).toBeTruthy();
	});

	test("defaults to Match device when nothing is stored", () => {
		render(<AppearanceTab />);
		const system = screen.getByRole("radio", { name: /match device/i });
		expect((system as HTMLInputElement).checked).toBe(true);
	});

	test("reflects a stored preference", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		render(<AppearanceTab />);
		expect(
			// `^dark` — "Match device"'s own description says "light/dark setting".
			(screen.getByRole("radio", { name: /^dark/i }) as HTMLInputElement)
				.checked,
		).toBe(true);
	});

	test("choosing Dark applies it to the document and persists it", () => {
		render(<AppearanceTab />);
		fireEvent.click(screen.getByRole("radio", { name: /^dark/i }));

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
	});

	test("choosing Light takes the class back off", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		render(<AppearanceTab />);
		fireEvent.click(screen.getByRole("radio", { name: /^light/i }));

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
	});

	test("Match device resolves against the OS", () => {
		stubMatchMedia(true);
		__resetThemeStoreForTests();
		window.localStorage.setItem(THEME_STORAGE_KEY, "light");
		render(<AppearanceTab />);

		fireEvent.click(screen.getByRole("radio", { name: /match device/i }));

		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	test("tells the seller the two things they would otherwise discover by accident", () => {
		// Discoverability is a house rule, not a nicety: a per-device setting that
		// silently fails to follow you to your laptop reads as a bug, and a seller
		// must not fear they have darkened their buyers' storefront.
		render(<AppearanceTab />);
		const helper = screen.getByText(/applies to this device only/i);
		expect(helper.textContent).toMatch(/storefront/i);
		expect(helper.textContent).toMatch(/pick their own theme/i);
		// "never reaches your buyers", NOT "your storefront is unaffected" — the
		// two surfaces share one key, so on the seller's OWN device previewing
		// their OWN storefront it very much is affected. That is the one case a
		// seller can actually check, so the copy must not contradict it.
		expect(helper.textContent).toMatch(/never reaches your buyers/i);
	});
});
