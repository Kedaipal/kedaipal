// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Dark mode reaches every page, and every page a visitor dwells on carries a
 * way to flip it (z8r3fdadub).
 *
 * The shell emits the pre-paint script unconditionally and Clerk's widgets
 * take the theme through the provider — both asserted below from source. What
 * the rest of this file guards is the CHROME: a route with no toggle is a page
 * the visitor cannot fix, and the first cut shipped exactly that gap on /track
 * (a WhatsApp-ordered buyer never sees a storefront). Every route file must
 * therefore either render a piece of chrome that carries `<ThemeToggle />`, or
 * be listed in NO_CONTROL with the reason — a closed list, so a new route has
 * to be classified before it ships.
 */
const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

/** Chrome that carries the toggle, and how a route file reveals it renders it. */
const CHROME: ReadonlyArray<{ file: string; rendersAs: RegExp }> = [
	{
		file: "components/storefront/storefront-footer.tsx",
		rendersAs: /StorefrontFooter/,
	},
	{ file: "components/landing/nav.tsx", rendersAs: /<Nav\b|LandingPage/ },
	{ file: "components/legal/legal-layout.tsx", rendersAs: /LegalLayout/ },
	{
		file: "components/marketplace/stores-compact-header.tsx",
		rendersAs: /StoresCompactHeader/,
	},
];

/**
 * Routes that render no toggle of their own and INHERIT the theme instead.
 * Each is a widget, a redirect or a one-tap page nobody dwells on; a control
 * there would be chrome on a page the visitor reads and leaves.
 */
const NO_CONTROL: Record<string, string> = {
	"__root.tsx": "the shell itself — it emits the theme, it does not sit in it",
	"sign-in.$.tsx": "Clerk's widget, themed through clerkAppearance",
	"sign-up.$.tsx": "Clerk's widget, themed through clerkAppearance",
	"onboarding.tsx": "Clerk's SignUp plus a one-time form",
	"join.$token.tsx": "one-tap invite acceptance",
	"referral.$slug.tsx": "a referral landing that hands straight off",
	"sitemap[.]xml.ts": "not a page",
};

describe("the theme reaches every page", () => {
	test("the shell emits the pre-paint script on every route", () => {
		const root = src("routes/__root.tsx");
		expect(root).toContain("THEME_INIT_SCRIPT");
		// The first cut gated it on a themed-route check; a stale preference
		// then could never darken the marketing site. There is no such gate now.
		expect(root).not.toMatch(/themed\s*\?/);
		expect(root).toContain("useThemeSync()");
	});

	test("Clerk's widgets take the theme", () => {
		const root = src("routes/__root.tsx");
		expect(root).toMatch(/clerkAppearance\(resolved\)/);
		expect(root).toMatch(/appearance=\{appearance\}/);
	});

	test("every piece of chrome that claims the toggle really carries it", () => {
		for (const c of CHROME)
			expect(src(c.file), c.file).toContain("ThemeToggle");
		// The landing page composes Nav; index.tsx reveals itself as LandingPage.
		expect(src("components/landing/landing-page.tsx")).toMatch(/<Nav\b/);
		// The /app shell: its header and sidebar carry the toggle, so every
		// app.* route is covered by rendering inside app.tsx.
		expect(src("components/dashboard/mobile-header.tsx")).toContain(
			"ThemeToggle",
		);
		expect(src("components/dashboard/sidebar.tsx")).toContain("ThemeToggle");
		expect(src("routes/app.tsx")).toMatch(/MobileHeader/);
		expect(src("routes/app.tsx")).toMatch(/<Sidebar\b/);
	});

	test("every route carries a theme control or is classified as inheriting", () => {
		const files = readdirSync(join(__dirname, "../routes")).filter(
			(f) => /\.tsx?$/.test(f) && !/\.test\./.test(f),
		);
		expect(files.length).toBeGreaterThan(20);

		const missing: string[] = [];
		for (const file of files) {
			if (file in NO_CONTROL) continue;
			if (file.startsWith("app.")) continue; // the /app shell carries it
			const source = src(`routes/${file}`);
			const ok =
				/ThemeToggle/.test(source) ||
				CHROME.some((c) => c.rendersAs.test(source));
			if (!ok) missing.push(file);
		}

		expect(
			missing.sort(),
			[
				"These routes render no theme control, so a visitor who lands there has",
				"no way to override the theme their device picked.",
				"",
				"Render chrome that carries it (StorefrontFooter, Nav, LegalLayout, the",
				"/stores headers), place `<ThemeToggle />` in the page's own utility row,",
				"or — for a widget / redirect page nobody dwells on — add the file to",
				"NO_CONTROL with the reason.",
			].join("\n"),
		).toEqual([]);
	});

	test("NO_CONTROL names only routes that exist", () => {
		const files = new Set(readdirSync(join(__dirname, "../routes")));
		for (const file of Object.keys(NO_CONTROL)) {
			expect(files.has(file), `${file} is listed but gone`).toBe(true);
		}
	});
});
