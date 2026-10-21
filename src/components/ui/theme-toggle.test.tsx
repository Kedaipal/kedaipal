// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { __resetThemeStoreForTests, THEME_STORAGE_KEY } from "../../lib/theme";
import { ThemeToggle } from "./theme-toggle";

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
	stubMatchMedia(false);
	__resetThemeStoreForTests();
});

afterEach(() => {
	cleanup();
	__resetThemeStoreForTests();
});

describe("ThemeToggle (buyer)", () => {
	test("offers dark when the page is light", () => {
		render(<ThemeToggle />);
		expect(
			screen.getByRole("button", { name: "Switch to dark mode" }),
		).toBeTruthy();
	});

	test("offers light when the page is dark", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		render(<ThemeToggle />);
		expect(
			screen.getByRole("button", { name: "Switch to light mode" }),
		).toBeTruthy();
	});

	test("a tap applies and persists an explicit choice", () => {
		render(<ThemeToggle />);
		fireEvent.click(screen.getByRole("button"));

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		// Explicit, not "system": a buyer tapping this means "the other one", and
		// leaving it on system would let the OS undo their tap at sunrise.
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
	});

	test("a second tap goes back", () => {
		render(<ThemeToggle />);
		fireEvent.click(screen.getByRole("button"));
		fireEvent.click(screen.getByRole("button"));

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
	});

	test("a system-dark buyer's first tap goes to light, not dark", () => {
		// The label follows the RESOLVED theme, not the preference — otherwise a
		// buyer whose phone is dark would tap "switch to dark" and see nothing.
		stubMatchMedia(true);
		__resetThemeStoreForTests();
		render(<ThemeToggle />);

		expect(
			screen.getByRole("button", { name: "Switch to light mode" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button"));
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	test("meets the 44px tap target", () => {
		const { container } = render(<ThemeToggle />);
		expect(container.querySelector("button")?.className).toContain("size-11");
	});
});
