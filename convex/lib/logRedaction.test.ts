import { describe, expect, it } from "vitest";
import { redactPhone } from "./logRedaction";

describe("redactPhone", () => {
	it("keeps only the last four digits of a full number", () => {
		expect(redactPhone("60115939791")).toBe("…9791");
	});

	it("strips formatting before slicing", () => {
		expect(redactPhone("+60 11-5939 9791")).toBe("…9791");
	});

	it("handles missing values", () => {
		expect(redactPhone(undefined)).toBe("(none)");
		expect(redactPhone(null)).toBe("(none)");
		expect(redactPhone("")).toBe("(none)");
	});

	it("handles non-numeric input", () => {
		expect(redactPhone("not-a-phone")).toBe("(none)");
	});

	it("never returns more than four digits", () => {
		expect(redactPhone("123")).toBe("…123");
		for (const input of ["60115939791", "+65 8123 4567", "0123456789"]) {
			const digits = redactPhone(input).replace(/\D/g, "");
			expect(digits.length).toBeLessThanOrEqual(4);
		}
	});
});
