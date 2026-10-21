// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetThemeStoreForTests, THEME_STORAGE_KEY } from "../lib/theme";
import { useThemeSync } from "./useTheme";

/**
 * Every value the sync writes to <html>, in order. Recorded at the module
 * seam: jsdom's `classList` is a Proxy, so a spy on it sees nothing, and a
 * `MutationObserver` runs only after React has already re-rendered and put
 * the class back.
 */
const written = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock("../lib/theme", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/theme")>();
	return {
		...actual,
		applyResolvedTheme: (resolved: "light" | "dark") => {
			written.values.push(resolved);
			actual.applyResolvedTheme(resolved);
		},
	};
});

/**
 * The root shell's theme sync, exercised the way it really runs: a page the
 * pre-paint script already darkened, then hydrated from server markup that
 * was rendered light (z8r3fdadub).
 *
 * The first cut flashed white on every full load — the layout effect wrote the
 * HYDRATION-PASS value ("light", the server snapshot) before React re-rendered
 * from the store. The invariant is that no write ever asks for light, not
 * merely that the document ends dark — so the test records every write.
 */

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
	const { resolved } = useThemeSync();
	return <span>{resolved}</span>;
}

/** jsdom ships no matchMedia. */
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

/** What THEME_INIT_SCRIPT leaves behind before React loads. */
function prePaintDarkened() {
	document.documentElement.classList.add("dark");
	document.documentElement.style.colorScheme = "dark";
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	stubMatchMedia(false);
	__resetThemeStoreForTests();
	written.values.length = 0;
	container = document.createElement("div");
	document.body.appendChild(container);
});

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	container.remove();
	__resetThemeStoreForTests();
});

async function hydrateDarkenedPage(preference: "dark" | "system") {
	window.localStorage.setItem(THEME_STORAGE_KEY, preference);
	prePaintDarkened();

	// The server knows no device, so it renders light — and the hydration pass
	// must match that markup before the store's value can take over.
	const markup = renderToString(<Probe />);
	expect(markup).toContain("light");
	container.innerHTML = markup;

	await act(async () => {
		root = hydrateRoot(container, <Probe />);
	});
	await act(async () => {});
	return written.values;
}

describe("useThemeSync across hydration", () => {
	test("a page the script darkened never passes through light", async () => {
		const writes = await hydrateDarkenedPage("dark");

		// The sync ran, and never once asked for light.
		expect(writes.length).toBeGreaterThan(0);
		expect(writes).not.toContain("light");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe("dark");
		// And the rendered value caught up with the store.
		expect(container.textContent).toBe("dark");
	});

	test("the same holds when 'system' resolves to dark on this device", async () => {
		stubMatchMedia(true);
		const writes = await hydrateDarkenedPage("system");

		expect(writes.length).toBeGreaterThan(0);
		expect(writes).not.toContain("light");
		expect(container.textContent).toBe("dark");
	});

	test("a light device hydrates light and stays light", async () => {
		// No stored preference, OS light: the script left <html> bare.
		container.innerHTML = renderToString(<Probe />);
		await act(async () => {
			root = hydrateRoot(container, <Probe />);
		});
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("light");
		expect(container.textContent).toBe("light");
		expect(written.values).toEqual(["light"]);
	});
});
