import { describe, expect, it } from "vitest";
import {
	absoluteProxiedImageUrl,
	clampImageWidth,
	convexStorageUuid,
	DEFAULT_IMAGE_WIDTH,
	IMAGE_WIDTHS,
	imageSrcSet,
	proxiedImageUrl,
} from "./image-proxy";

const UUID = "3346125e-42d4-4560-a3e1-abf7438de45f";
const STORAGE = `https://qualified-chihuahua-441.convex.cloud/api/storage/${UUID}`;

describe("convexStorageUuid", () => {
	it("extracts the file uuid from a real Convex storage URL", () => {
		expect(convexStorageUuid(STORAGE)).toBe(UUID);
	});

	it("matches any deployment host — dev and prod are different subdomains", () => {
		expect(
			convexStorageUuid(
				`https://peaceful-falcon-152.convex.cloud/api/storage/${UUID}`,
			),
		).toBe(UUID);
	});

	it.each([
		["blob: upload preview", "blob:http://localhost/9c1e6b1e-preview"],
		["data: inline preview", "data:image/png;base64,iVBORw0KGgo="],
		["a bundled static asset", "/logo.svg"],
		["a third-party host", `https://evil.example.com/api/storage/${UUID}`],
		["a lookalike host", `https://convex.cloud.evil.com/api/storage/${UUID}`],
		["a non-storage Convex path", "https://x.convex.cloud/api/query"],
		[
			"a non-uuid file segment",
			"https://x.convex.cloud/api/storage/not-a-uuid",
		],
		[
			"a nested path under storage",
			`https://x.convex.cloud/api/storage/${UUID}/extra`,
		],
		["garbage", "::::"],
	])("leaves %s alone", (_label, src) => {
		expect(convexStorageUuid(src)).toBeNull();
		// …and the URL builder must pass it through completely untouched.
		expect(proxiedImageUrl(src)).toBe(src);
		expect(imageSrcSet(src)).toBeNull();
	});
});

describe("clampImageWidth", () => {
	it("snaps an arbitrary width up to the next whitelisted width", () => {
		expect(clampImageWidth(200)).toBe(320);
		expect(clampImageWidth(641)).toBe(960);
	});

	it("keeps an exact whitelisted width", () => {
		for (const w of IMAGE_WIDTHS) expect(clampImageWidth(w)).toBe(w);
	});

	it("caps anything larger than the biggest width — this is the billing ceiling", () => {
		expect(clampImageWidth(99_999)).toBe(1280);
		expect(clampImageWidth("4000")).toBe(1280);
	});

	it.each([
		null,
		undefined,
		"",
		"abc",
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("falls back to the default for unusable input (%s)", (raw) => {
		expect(clampImageWidth(raw as never)).toBe(DEFAULT_IMAGE_WIDTH);
	});

	it("never returns a width outside the whitelist, for any input", () => {
		const probes = [-5000, -1, 0, 1, 159, 160, 161, 999, 1279, 1280, 1281, 1e9];
		for (const p of probes) {
			expect(IMAGE_WIDTHS).toContain(clampImageWidth(p));
		}
	});
});

describe("proxiedImageUrl / imageSrcSet", () => {
	it("rewrites a storage URL onto our own route, hiding the Convex host", () => {
		const out = proxiedImageUrl(STORAGE, 320);
		expect(out).toBe(`/img/${UUID}?w=320`);
		expect(out).not.toContain("convex.cloud");
	});

	it("defaults to the default width when none is given", () => {
		expect(proxiedImageUrl(STORAGE)).toBe(
			`/img/${UUID}?w=${DEFAULT_IMAGE_WIDTH}`,
		);
	});

	it("clamps an out-of-whitelist width rather than emitting it", () => {
		expect(proxiedImageUrl(STORAGE, 5000)).toBe(`/img/${UUID}?w=1280`);
	});

	it("emits one srcset candidate per whitelisted width, in ascending order", () => {
		const set = imageSrcSet(STORAGE);
		expect(set).toBe(
			IMAGE_WIDTHS.map((w) => `/img/${UUID}?w=${w} ${w}w`).join(", "),
		);
		// Descriptors must match the width actually requested, or the browser
		// picks the wrong candidate and the whole exercise backfires.
		for (const w of IMAGE_WIDTHS) expect(set).toContain(`?w=${w} ${w}w`);
	});
});

describe("absoluteProxiedImageUrl", () => {
	it("makes an absolute URL for og:image — unfurlers can't resolve a relative path", () => {
		expect(absoluteProxiedImageUrl(STORAGE, "https://kedaipal.com")).toBe(
			`https://kedaipal.com/img/${UUID}?w=1280`,
		);
	});

	it("tolerates a trailing slash on the site URL without doubling it", () => {
		expect(absoluteProxiedImageUrl(STORAGE, "https://kedaipal.com/")).toBe(
			`https://kedaipal.com/img/${UUID}?w=1280`,
		);
	});

	it("passes a non-proxyable src straight through, absolute or not", () => {
		expect(absoluteProxiedImageUrl("/logo.svg", "https://kedaipal.com")).toBe(
			"/logo.svg",
		);
	});
});
