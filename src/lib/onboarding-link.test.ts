import { describe, expect, it } from "vitest";
import { buildOnboardingInviteLink } from "./onboarding-link";

const ORIGIN = "https://kedaipal.com";

describe("buildOnboardingInviteLink", () => {
	it("always tags the link as admin-assisted", () => {
		const link = buildOnboardingInviteLink(ORIGIN, { storeName: "Mak Kuih" });
		const params = new URL(link).searchParams;
		expect(params.get("via")).toBe("admin");
		expect(params.get("store")).toBe("Mak Kuih");
	});

	it("includes slug and WhatsApp number when given", () => {
		const link = buildOnboardingInviteLink(ORIGIN, {
			storeName: "Mak Kuih",
			slug: "mak-kuih",
			waPhone: "60123456789",
		});
		const params = new URL(link).searchParams;
		expect(params.get("slug")).toBe("mak-kuih");
		expect(params.get("wa")).toBe("60123456789");
	});

	it("omits blank optional fields rather than emitting empty params", () => {
		const link = buildOnboardingInviteLink(ORIGIN, {
			storeName: "Mak Kuih",
			slug: "   ",
			waPhone: "",
		});
		const params = new URL(link).searchParams;
		expect(params.has("slug")).toBe(false);
		expect(params.has("wa")).toBe(false);
	});

	it("trims and URL-encodes the store name", () => {
		const link = buildOnboardingInviteLink(ORIGIN, {
			storeName: "  Kek & Kuih Sdn ",
		});
		const params = new URL(link).searchParams;
		// Round-trips to the trimmed value; encoding is handled by URLSearchParams.
		expect(params.get("store")).toBe("Kek & Kuih Sdn");
		expect(link).toContain("store=Kek+%26+Kuih+Sdn");
	});

	it("returns an empty string when the store name is blank (gates the button)", () => {
		expect(buildOnboardingInviteLink(ORIGIN, { storeName: "   " })).toBe("");
	});

	it("points at the onboarding route on the given origin", () => {
		const link = buildOnboardingInviteLink("http://localhost:3000", {
			storeName: "Test",
		});
		expect(link.startsWith("http://localhost:3000/onboarding?")).toBe(true);
	});
});
