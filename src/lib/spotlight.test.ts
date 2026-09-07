// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { highlightRingClass, SETTINGS_ANCHOR } from "./country-setup-copy";
import { isSpotlightKey, SPOTLIGHT_ANCHOR, spotlightHref } from "./spotlight";

const SETTINGS_ROUTE = join(__dirname, "../routes/app.settings.tsx");
const SETTINGS_COMPONENTS = join(__dirname, "../components/settings");

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
		for (const [key, { tab }] of Object.entries(SPOTLIGHT_ANCHOR)) {
			expect(tabs, `${key} names tab "${tab}"`).toContain(tab);
		}
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
		for (const [key, { anchor }] of Object.entries(SPOTLIGHT_ANCHOR)) {
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

	test("isSpotlightKey admits registry keys only", () => {
		expect(isSpotlightKey("delyva")).toBe(true);
		expect(isSpotlightKey("settings-delyva")).toBe(false); // an id, not a key
		expect(isSpotlightKey("toString")).toBe(false); // prototype walk
		expect(isSpotlightKey(undefined)).toBe(false);
		expect(isSpotlightKey(42)).toBe(false);
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
