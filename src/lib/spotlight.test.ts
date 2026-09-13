// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { highlightRingClass, SETTINGS_ANCHOR } from "./country-setup-copy";
import { PRODUCT_SPOTLIGHT } from "./product-spotlight";
import {
	isProductSpotlightKey,
	isSettingsSpotlightKey,
	isSpotlightKey,
	SPOTLIGHT_ANCHOR,
	spotlightHref,
} from "./spotlight";

const SETTINGS_ROUTE = join(__dirname, "../routes/app.settings.tsx");
const SETTINGS_COMPONENTS = join(__dirname, "../components/settings");
const PRODUCT_FORM = join(__dirname, "../components/forms/product-form.tsx");

const settingsEntries = Object.entries(SPOTLIGHT_ANCHOR).filter(
	([, t]) => t.page === "settings",
);
const productEntries = Object.entries(SPOTLIGHT_ANCHOR).filter(
	([, t]) => t.page === "product",
);

describe("spotlight registry", () => {
	test("every key's tab is a tab the settings route actually has", () => {
		// The union in the route is the source of truth; the copy in
		// spotlight.ts exists only so the registry can be typed without
		// importing a route module. Parsed as text, like releases.test.ts does.
		const declared = readFileSync(SETTINGS_ROUTE, "utf8").match(
			/type SettingsTab =\s*([\s\S]*?);/,
		)?.[1];
		expect(declared).toBeDefined();
		const tabs = [...(declared as string).matchAll(/"([a-z-]+)"/g)].map(
			(m) => m[1],
		);
		for (const [key, target] of settingsEntries) {
			if (target.page !== "settings") continue; // narrowing only
			expect(tabs, `${key} names tab "${target.tab}"`).toContain(target.tab);
		}
	});

	test("every page has at least one key, so both branches stay exercised", () => {
		expect(settingsEntries.length).toBeGreaterThan(0);
		expect(productEntries.length).toBeGreaterThan(0);
	});

	test("every anchor is rendered as a card id somewhere under settings", () => {
		// A registry row nothing renders is a deep link that scrolls nowhere
		// and rings nothing — the seller lands on the tab and hunts, which is
		// exactly what the spotlight exists to prevent. Every card takes its id
		// FROM the registry (`SPOTLIGHT_ANCHOR.<key>.anchor`), so a renamed
		// anchor can't leave a stale literal behind.
		const sources = [
			readFileSync(SETTINGS_ROUTE, "utf8"),
			...readdirSync(SETTINGS_COMPONENTS)
				.filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
				.map((f) => readFileSync(join(SETTINGS_COMPONENTS, f), "utf8")),
		].join("\n");
		for (const [key, { anchor }] of settingsEntries) {
			// A card the post-switch checklist already anchors keeps taking its
			// id from SETTINGS_ANCHOR — one card, one source; the registries are
			// asserted equal below, so either spelling proves the card exists.
			const accepted = [
				`id={SPOTLIGHT_ANCHOR.${key}.anchor}`,
				...Object.entries(SETTINGS_ANCHOR)
					.filter(([, id]) => id === anchor)
					.map(([fixKey]) => `id={SETTINGS_ANCHOR.${fixKey}}`),
			];
			expect(
				accepted.some((form) => sources.includes(form)),
				`no card renders any of: ${accepted.join(" / ")}`,
			).toBe(true);
		}
	});

	test("every product-page anchor is rendered as a card id on the product form", () => {
		// Same rule as the settings cards, different file: the form is the one
		// place a product-page spotlight can land, so the anchor must be there.
		const source = readFileSync(PRODUCT_FORM, "utf8");
		for (const [key] of productEntries) {
			expect(
				source.includes(`id={SPOTLIGHT_ANCHOR.${key}.anchor}`),
				`product-form.tsx renders no card with id={SPOTLIGHT_ANCHOR.${key}.anchor}`,
			).toBe(true);
		}
	});

	test("every product-page key has list copy and an eligibility rule", () => {
		// The products list is the first hop for a product-page key: it has to
		// say what the seller is looking for and know which rows to forward to.
		// The Record type makes a missing row a compile error; this pins that
		// the copy is real and the rule admits a stay and refuses a parcel.
		for (const [key] of productEntries) {
			const copy = PRODUCT_SPOTLIGHT[key as keyof typeof PRODUCT_SPOTLIGHT];
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.body.length).toBeGreaterThan(0);
			expect(copy.empty.length).toBeGreaterThan(0);
		}
		expect(PRODUCT_SPOTLIGHT.weekend_rate.applies({ kind: "booking" })).toBe(
			true,
		);
		expect(PRODUCT_SPOTLIGHT.weekend_rate.applies({ kind: "physical" })).toBe(
			false,
		);
		expect(PRODUCT_SPOTLIGHT.weekend_rate.applies({})).toBe(false); // legacy = physical
	});

	test("anchors shared with the post-switch checklist are the same string", () => {
		// One card, two senders. If these drift, `?fix=hitpay` and
		// `?spot=hitpay` would ring different elements — or one of them none.
		expect(SPOTLIGHT_ANCHOR.hitpay.anchor).toBe(SETTINGS_ANCHOR.hitpay);
		expect(SPOTLIGHT_ANCHOR.delivery_charge.anchor).toBe(
			SETTINGS_ANCHOR.delivery_mode,
		);
	});

	test("spotlightHref carries the tab AND the key, from one source", () => {
		expect(spotlightHref("delyva")).toBe(
			"/app/settings?tab=integrations&spot=delyva",
		);
		expect(spotlightHref("business_details")).toBe(
			"/app/settings?tab=store&spot=business_details",
		);
	});

	test("a product-page key lands on the products LIST, not a guessed product", () => {
		// The list is the first hop: a note can't know which product the
		// seller means, so it never carries an id.
		expect(spotlightHref("weekend_rate")).toBe(
			"/app/products?spot=weekend_rate",
		);
	});

	test("isSpotlightKey admits registry keys only", () => {
		expect(isSpotlightKey("delyva")).toBe(true);
		expect(isSpotlightKey("settings-delyva")).toBe(false); // an id, not a key
		expect(isSpotlightKey("toString")).toBe(false); // prototype walk
		expect(isSpotlightKey(undefined)).toBe(false);
		expect(isSpotlightKey(42)).toBe(false);
	});

	test("each page admits only its own keys", () => {
		// A settings key pasted onto the products list (or the reverse) must
		// be dropped, not forwarded to a page that renders no such card.
		expect(isSettingsSpotlightKey("delyva")).toBe(true);
		expect(isSettingsSpotlightKey("weekend_rate")).toBe(false);
		expect(isProductSpotlightKey("weekend_rate")).toBe(true);
		expect(isProductSpotlightKey("delyva")).toBe(false);
		expect(isProductSpotlightKey("toString")).toBe(false);
		expect(isSettingsSpotlightKey(undefined)).toBe(false);
	});
});

describe("spotlight ring", () => {
	test("is the brand mint, never a warning colour", () => {
		// A What's-new note is an invitation. Borrowing the checklist's red or
		// amber would tell the seller something is wrong with a card that is
		// merely new.
		const cls = highlightRingClass("spotlight");
		expect(cls).toMatch(/ring-accent/);
		expect(cls).toMatch(/animate-kp-spotlight/);
		expect(cls).not.toMatch(/destructive|amber/);
		expect(highlightRingClass(undefined)).toBe("border-input");
	});
});
