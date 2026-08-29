// @vitest-environment jsdom
// The theme store (z8r3fdadub). Needs a DOM because the whole point of this
// module is what it does to <html> — the class and the colorScheme — and
// because the pre-paint script is exercised here against the real document.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	__resetThemeStoreForTests,
	applyResolvedTheme,
	DEFAULT_THEME_PREFERENCE,
	getThemeSnapshot,
	isThemePreference,
	readStoredPreference,
	resolveTheme,
	setThemePreference,
	subscribeTheme,
	THEME_INIT_SCRIPT,
	THEME_STORAGE_KEY,
	type ThemePreference,
} from "./theme";

/** jsdom ships no matchMedia. Returns the listener set so a test can fire an
 *  OS-level change the way the browser would. */
function stubMatchMedia(prefersDark: boolean) {
	const listeners = new Set<() => void>();
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: query.includes("dark") ? prefersDark : false,
			media: query,
			addEventListener: (_: string, cb: () => void) => listeners.add(cb),
			removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
		}),
	});
	return {
		fireChange: (next: boolean) => {
			stubMatchMedia(next);
			for (const cb of listeners) cb();
		},
	};
}

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	stubMatchMedia(false);
	__resetThemeStoreForTests();
});

afterEach(() => {
	__resetThemeStoreForTests();
	vi.restoreAllMocks();
});

describe("resolveTheme", () => {
	test("explicit choices ignore the OS", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("light", false)).toBe("light");
		expect(resolveTheme("dark", true)).toBe("dark");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	test("system follows the OS", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});
});

describe("isThemePreference", () => {
	test("accepts exactly the three preferences", () => {
		for (const value of ["light", "dark", "system"]) {
			expect(isThemePreference(value)).toBe(true);
		}
	});

	test("rejects anything else", () => {
		for (const value of ["", "DARK", "auto", null, undefined, 1, {}]) {
			expect(isThemePreference(value)).toBe(false);
		}
	});
});

describe("readStoredPreference", () => {
	test("reads a stored value", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		expect(readStoredPreference()).toBe("dark");
	});

	test("falls back to the default when unset", () => {
		expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE);
	});

	test("falls back when the stored value is junk", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
		expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE);
	});

	test("survives storage throwing (private mode)", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("SecurityError");
		});
		expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE);
	});
});

describe("applyResolvedTheme", () => {
	test("dark adds the class and the colorScheme", () => {
		applyResolvedTheme("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe("dark");
	});

	test("light removes the class again", () => {
		applyResolvedTheme("dark");
		applyResolvedTheme("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("light");
	});

	test("leaves other classes on <html> alone", () => {
		document.documentElement.className = "js-ready";
		applyResolvedTheme("dark");
		expect(document.documentElement.className).toContain("js-ready");
	});
});

describe("setThemePreference", () => {
	test("persists, applies and notifies", () => {
		const seen: string[] = [];
		subscribeTheme(() => seen.push(getThemeSnapshot().resolved));

		setThemePreference("dark");

		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(seen).toEqual(["dark"]);
		expect(getThemeSnapshot()).toEqual({
			preference: "dark",
			resolved: "dark",
		});
	});

	test("system resolves against the OS at the moment it is chosen", () => {
		stubMatchMedia(true);
		__resetThemeStoreForTests();
		setThemePreference("system");
		expect(getThemeSnapshot().resolved).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	test("applies even when storage is unavailable", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceeded");
		});
		expect(() => setThemePreference("dark")).not.toThrow();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	test("re-setting the same preference does not re-notify", () => {
		setThemePreference("dark");
		let calls = 0;
		subscribeTheme(() => calls++);
		setThemePreference("dark");
		expect(calls).toBe(0);
	});
});

describe("following the OS", () => {
	test("a system-preference user flips when the OS flips", () => {
		const media = stubMatchMedia(false);
		__resetThemeStoreForTests();
		subscribeTheme(() => {});
		setThemePreference("system");
		expect(getThemeSnapshot().resolved).toBe("light");

		media.fireChange(true);

		expect(getThemeSnapshot().resolved).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	test("an explicit choice is NOT overridden when the OS flips", () => {
		const media = stubMatchMedia(false);
		__resetThemeStoreForTests();
		subscribeTheme(() => {});
		setThemePreference("light");

		media.fireChange(true);

		// This is the guard that matters: delete the `preference !== "system"`
		// early return in onSystemChange and this case goes red.
		expect(getThemeSnapshot().resolved).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});
});

describe("cross-tab sync", () => {
	test("a storage event from another tab applies here", () => {
		subscribeTheme(() => {});
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: THEME_STORAGE_KEY,
				newValue: "dark",
			}),
		);
		expect(getThemeSnapshot().preference).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	test("an unrelated storage key is ignored", () => {
		subscribeTheme(() => {});
		setThemePreference("light");
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "kp:sidebar:collapsed",
				newValue: "1",
			}),
		);
		expect(getThemeSnapshot().preference).toBe("light");
	});

	test("unsubscribing detaches the listener", () => {
		const unsubscribe = subscribeTheme(() => {});
		unsubscribe();
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: THEME_STORAGE_KEY,
				newValue: "dark",
			}),
		);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});
});

describe("THEME_INIT_SCRIPT agrees with the module", () => {
	// The script is a hand-written ES5 copy of readStoredPreference +
	// resolveTheme + applyResolvedTheme, because it has to run before any bundle
	// loads. This table is what stops the copy drifting from the original.
	const CASES: {
		stored: string | null;
		osDark: boolean;
		expectDark: boolean;
	}[] = [
		{ stored: "dark", osDark: false, expectDark: true },
		{ stored: "dark", osDark: true, expectDark: true },
		{ stored: "light", osDark: true, expectDark: false },
		{ stored: "light", osDark: false, expectDark: false },
		{ stored: "system", osDark: true, expectDark: true },
		{ stored: "system", osDark: false, expectDark: false },
		{ stored: null, osDark: true, expectDark: true },
		{ stored: null, osDark: false, expectDark: false },
		{ stored: "neon", osDark: true, expectDark: true },
		{ stored: "neon", osDark: false, expectDark: false },
	];

	for (const { stored, osDark, expectDark } of CASES) {
		test(`stored=${stored ?? "unset"} os=${osDark ? "dark" : "light"} → ${
			expectDark ? "dark" : "light"
		}`, () => {
			if (stored !== null)
				window.localStorage.setItem(THEME_STORAGE_KEY, stored);
			stubMatchMedia(osDark);

			// eslint-disable-next-line no-eval -- exercising the shipped script text
			// biome-ignore lint/security/noGlobalEval: the point of the test is to run the real script
			eval(THEME_INIT_SCRIPT);

			expect(document.documentElement.classList.contains("dark")).toBe(
				expectDark,
			);
			expect(document.documentElement.style.colorScheme).toBe(
				expectDark ? "dark" : "light",
			);

			// And the module, given the same inputs, must agree.
			const preference = readStoredPreference();
			expect(resolveTheme(preference, osDark)).toBe(
				expectDark ? "dark" : "light",
			);
		});
	}

	test("never throws when storage is unavailable", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("SecurityError");
		});
		stubMatchMedia(true);
		// biome-ignore lint/security/noGlobalEval: the point of the test is to run the real script
		expect(() => eval(THEME_INIT_SCRIPT)).not.toThrow();
	});

	test("references the same storage key the module uses", () => {
		expect(THEME_INIT_SCRIPT).toContain(`"${THEME_STORAGE_KEY}"`);
	});
});

describe("SSR safety", () => {
	test("the exported preference list is exactly the union", () => {
		const all: ThemePreference[] = ["light", "dark", "system"];
		for (const p of all) expect(isThemePreference(p)).toBe(true);
	});
});
