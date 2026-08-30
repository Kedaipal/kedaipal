import { describe, expect, it } from "vitest";
import {
	detectCountryFromTimeZone,
	readStoredRegion,
	resolveLandingRegion,
} from "./useLandingRegion";

describe("detectCountryFromTimeZone", () => {
	it("reads Singapore's time zone as SG", () => {
		expect(detectCountryFromTimeZone("Asia/Singapore")).toBe("SG");
	});

	it("defaults every other time zone to MY, including Malaysia's own", () => {
		expect(detectCountryFromTimeZone("Asia/Kuala_Lumpur")).toBe("MY");
		expect(detectCountryFromTimeZone("Asia/Jakarta")).toBe("MY");
		expect(detectCountryFromTimeZone("America/New_York")).toBe("MY");
		expect(detectCountryFromTimeZone("")).toBe("MY");
	});
});

describe("readStoredRegion — the toggle's cookie, client side", () => {
	it("finds the pick among other cookies", () => {
		expect(readStoredRegion("foo=1; kp_landing_region=SG; bar=2")).toBe("SG");
		expect(readStoredRegion("kp_landing_region=MY")).toBe("MY");
	});

	it("tolerates the spacing browsers actually serialize", () => {
		expect(readStoredRegion("a=1;kp_landing_region=SG")).toBe("SG");
		expect(readStoredRegion("  kp_landing_region=SG  ")).toBe("SG");
	});

	it("is absent rather than wrong for anything unparseable", () => {
		// Client-written, so a stale or hand-edited value must degrade to
		// detection — never a third state and never a throw.
		expect(readStoredRegion("")).toBeNull();
		expect(readStoredRegion("other=SG")).toBeNull();
		expect(readStoredRegion("kp_landing_region=")).toBeNull();
		expect(readStoredRegion("kp_landing_region=ID")).toBeNull();
		expect(readStoredRegion("kp_landing_region=sg")).toBeNull();
	});

	it("does not match a cookie whose name merely ends with ours", () => {
		expect(readStoredRegion("x_kp_landing_region=SG")).toBeNull();
	});
});

describe("resolveLandingRegion — stored pick → server → time zone → MY", () => {
	it("honours a stored pick over everything else", () => {
		expect(
			resolveLandingRegion({ stored: "MY", server: "SG", timeZone: "SG" }),
		).toBe("MY");
		expect(
			resolveLandingRegion({ stored: "SG", server: "MY", timeZone: "MY" }),
		).toBe("SG");
	});

	it("uses the server's answer when the visitor has never picked", () => {
		expect(
			resolveLandingRegion({ stored: null, server: "SG", timeZone: "MY" }),
		).toBe("SG");
	});

	it("lets the server overrule the time zone — the case time zones get wrong", () => {
		// An SG visitor whose phone still says Asia/Kuala_Lumpur.
		expect(
			resolveLandingRegion({ stored: null, server: "SG", timeZone: "MY" }),
		).toBe("SG");
		// A Malaysian visitor whose device is set to Asia/Singapore.
		expect(
			resolveLandingRegion({ stored: null, server: "MY", timeZone: "SG" }),
		).toBe("MY");
	});

	it("falls back to the time zone only when the server could not answer", () => {
		expect(
			resolveLandingRegion({ stored: null, server: null, timeZone: "SG" }),
		).toBe("SG");
	});

	it("defaults to MY when no signal answers", () => {
		expect(
			resolveLandingRegion({ stored: null, server: null, timeZone: null }),
		).toBe("MY");
	});
});
