import { describe, expect, it } from "vitest";
import { detectCountryFromTimeZone } from "./useLandingRegion";

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
