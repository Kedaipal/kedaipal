import { describe, expect, it } from "vitest";
import { detectCountryFromGeoHeader, parseRegionCookie } from "./geo-region";

describe("detectCountryFromGeoHeader", () => {
	it("reads Singapore as SG", () => {
		expect(detectCountryFromGeoHeader("SG")).toBe("SG");
	});

	it("accepts the header in any case, with padding", () => {
		expect(detectCountryFromGeoHeader("sg")).toBe("SG");
		expect(detectCountryFromGeoHeader("  Sg  ")).toBe("SG");
	});

	it("treats every other resolvable country as MY — a real answer, not a guess", () => {
		// Load-bearing: a resolved non-SG country must NOT return null, or the
		// time-zone fallback would get to overrule the edge on a Malaysian
		// visitor whose device is set to Asia/Singapore.
		expect(detectCountryFromGeoHeader("MY")).toBe("MY");
		expect(detectCountryFromGeoHeader("ID")).toBe("MY");
		expect(detectCountryFromGeoHeader("US")).toBe("MY");
	});

	it("returns null when the header cannot answer", () => {
		expect(detectCountryFromGeoHeader(null)).toBeNull();
		expect(detectCountryFromGeoHeader(undefined)).toBeNull();
		expect(detectCountryFromGeoHeader("")).toBeNull();
		expect(detectCountryFromGeoHeader("   ")).toBeNull();
	});

	it("returns null for Cloudflare's unresolved codes so the time zone still gets a vote", () => {
		expect(detectCountryFromGeoHeader("XX")).toBeNull();
		expect(detectCountryFromGeoHeader("T1")).toBeNull();
		expect(detectCountryFromGeoHeader("t1")).toBeNull();
	});
});

describe("parseRegionCookie — the toggle's stored pick, server side", () => {
	it("accepts either country", () => {
		expect(parseRegionCookie("SG")).toBe("SG");
		expect(parseRegionCookie("MY")).toBe("MY");
		expect(parseRegionCookie(" SG ")).toBe("SG");
	});

	it("treats anything else as absent, so detection still decides", () => {
		// The value is client-written: a stale or hand-edited cookie must
		// degrade to geo-IP, never to a third state and never to a throw.
		expect(parseRegionCookie(null)).toBeNull();
		expect(parseRegionCookie(undefined)).toBeNull();
		expect(parseRegionCookie("")).toBeNull();
		expect(parseRegionCookie("ID")).toBeNull();
		expect(parseRegionCookie("<script>")).toBeNull();
	});

	it("is case-SENSITIVE, unlike the geo header", () => {
		// We write it, so we know its shape exactly. The header comes from
		// Cloudflare and is normalized on the way in; this one isn't, because a
		// lowercase value here means something wrote it that wasn't the toggle.
		expect(parseRegionCookie("sg")).toBeNull();
	});
});
