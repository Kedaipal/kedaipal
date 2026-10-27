// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { highlightRingClass, SETTINGS_ANCHOR } from "./country-setup-copy";
import { PRODUCT_SPOTLIGHT } from "./product-spotlight";
import {
	isHomeSpotlightKey,
	isProductSpotlightKey,
	isSettingsSpotlightKey,
	isSpotlightKey,
	SPOTLIGHT_ANCHOR,
	spotlightHref,
} from "./spotlight";

const SETTINGS_ROUTE = join(__dirname, "../routes/app.settings.tsx");
const SETTINGS_COMPONENTS = join(__dirname, "../components/settings");
// A settings card does not have to live in `components/settings`: the credit
// balance card is the same component the dashboard renders in its compact
// variant, so it sits in `components/credits` and the billing tab mounts it.
// The guarantee this test makes is "a card renders the anchor", not "the file
// is in one folder" — so the directories a settings TAB mounts cards from are
// all scanned.
const SETTINGS_CARD_DIRS = [
	SETTINGS_COMPONENTS,
	join(__dirname, "../components/credits"),
];
const PRODUCT_FORM = join(__dirname, "../components/forms/product-form.tsx");
const HOME_COMPONENTS = join(__dirname, "../components/home");

const settingsEntries = Object.entries(SPOTLIGHT_ANCHOR).filter(
	([, t]) => t.page === "settings",
);
const productEntries = Object.entries(SPOTLIGHT_ANCHOR).filter(
	([, t]) => t.page === "product",
);
const homeEntries = Object.entries(SPOTLIGHT_ANCHOR).filter(
	([, t]) => t.page === "home",
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
		expect(homeEntries.length).toBeGreaterThan(0);
	});

	test("every Home anchor is rendered as a section id by a Home component", () => {
		// Same rule as the settings cards: a Home key nothing renders scrolls
		// nowhere. The Refer card renders two sections (live and paused) and
		// both must carry the anchor, or the deep link works for one standing
		// and dead-ends for the other.
		const source = readdirSync(HOME_COMPONENTS)
			.filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
			.map((f) => readFileSync(join(HOME_COMPONENTS, f), "utf8"))
			.join("\n");
		for (const [key] of homeEntries) {
			expect(
				source.includes(`id={SPOTLIGHT_ANCHOR.${key}.anchor}`),
				`no Home component renders id={SPOTLIGHT_ANCHOR.${key}.anchor}`,
			).toBe(true);
		}
		const refer = readFileSync(join(HOME_COMPONENTS, "refer-card.tsx"), "utf8");
		expect(refer.split("id={SPOTLIGHT_ANCHOR.refer.anchor}").length - 1).toBe(
			2,
		);
	});

	test("every anchor is rendered as a card id somewhere under settings", () => {
		// A registry row nothing renders is a deep link that scrolls nowhere
		// and rings nothing — the seller lands on the tab and hunts, which is
		// exactly what the spotlight exists to prevent. Every card takes its id
		// FROM the registry (`SPOTLIGHT_ANCHOR.<key>.anchor`), so a renamed
		// anchor can't leave a stale literal behind.
		const sources = [
			readFileSync(SETTINGS_ROUTE, "utf8"),
			...SETTINGS_CARD_DIRS.flatMap((dir) =>
				readdirSync(dir)
					.filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
					.map((f) => readFileSync(join(dir, f), "utf8")),
			),
		].join("\n");
		for (const [key, { anchor }] of settingsEntries) {
			// A card the post-switch checklist already anchors keeps taking its
			// id from SETTINGS_ANCHOR — one card, one source; the registries are
			// asserted equal below, so either spelling proves the card exists.
			const accepted = [
				`id={SPOTLIGHT_ANCHOR.${key}.anchor}`,
				// The courier cards wrap their OWN AccountCard shell (so hiding in
				// an unserved country takes the border with it) and receive the
				// anchor as `shellId` — same registry source, different prop.
				`shellId={SPOTLIGHT_ANCHOR.${key}.anchor}`,
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
		// prep_time is the mirror image: everything but a booking, because a
		// booking's notice row renders neither field.
		expect(PRODUCT_SPOTLIGHT.prep_time.applies({ kind: "physical" })).toBe(
			true,
		);
		expect(PRODUCT_SPOTLIGHT.prep_time.applies({})).toBe(true); // legacy = physical
		expect(PRODUCT_SPOTLIGHT.prep_time.applies({ kind: "booking" })).toBe(
			false,
		);
		// promo renders on every kind, so every row forwards — a booking and an
		// event included, where the card says why the flash extras don't apply.
		for (const kind of [undefined, "physical", "booking", "service"])
			expect(PRODUCT_SPOTLIGHT.promo.applies({ kind })).toBe(true);
	});

	test("anchors shared with the post-switch checklist are the same string", () => {
		// One card, two senders. If these drift, `?fix=hitpay` and
		// `?spot=hitpay` would ring different elements — or one of them none.
		expect(SPOTLIGHT_ANCHOR.hitpay.anchor).toBe(SETTINGS_ANCHOR.hitpay);
		expect(SPOTLIGHT_ANCHOR.delivery_charge.anchor).toBe(
			SETTINGS_ANCHOR.delivery_mode,
		);
		expect(SPOTLIGHT_ANCHOR.business_address.anchor).toBe(
			SETTINGS_ANCHOR.business_address,
		);
		expect(SPOTLIGHT_ANCHOR.pickup_points.anchor).toBe(
			SETTINGS_ANCHOR.pickup_addresses,
		);
		// The keys fix sends the seller to Integrations, so it must ring the
		// Lalamove card there — not a Fulfilment card that tab never renders.
		expect(SPOTLIGHT_ANCHOR.lalamove.anchor).toBe(
			SETTINGS_ANCHOR.delivery_booking,
		);
	});

	test("spotlightHref carries the tab AND the key, from one source", () => {
		expect(spotlightHref("delyva")).toBe(
			"/app/settings?tab=integrations&spot=delyva",
		);
		expect(spotlightHref("business_details")).toBe(
			"/app/settings?tab=store&spot=business_details",
		);
		// Its own card, not the Pickup card above it (z8r3fdm32x).
		expect(spotlightHref("event_venues")).toBe(
			"/app/settings?tab=fulfilment&spot=event_venues",
		);
	});

	test("a product-page key lands on the products LIST, not a guessed product", () => {
		// The list is the first hop: a note can't know which product the
		// seller means, so it never carries an id.
		expect(spotlightHref("weekend_rate")).toBe(
			"/app/products?spot=weekend_rate",
		);
		expect(spotlightHref("promo")).toBe("/app/products?spot=promo");
	});

	test("a Home key lands on Home, with no tab", () => {
		expect(spotlightHref("refer")).toBe("/app?spot=refer");
		expect(isHomeSpotlightKey("refer")).toBe(true);
		expect(isHomeSpotlightKey("delyva")).toBe(false);
		expect(isSettingsSpotlightKey("refer")).toBe(false);
		expect(isProductSpotlightKey("refer")).toBe(false);
		expect(isHomeSpotlightKey("toString")).toBe(false);
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
