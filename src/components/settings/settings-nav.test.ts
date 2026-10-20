import { describe, expect, it } from "vitest";
import { storeGlance } from "./settings-nav";

// The rail is read from every other settings tab, so a store that isn't taking
// orders must say so there — not hide behind its own name (z8r3fdudf7).
describe("storeGlance", () => {
	it("an open store glances as its name", () => {
		expect(storeGlance("Kuih Lab", { state: "open" })).toEqual({
			text: "Kuih Lab",
		});
	});

	it("still loading reads as the name, never as a guess", () => {
		expect(storeGlance("Kuih Lab", undefined)).toEqual({ text: "Kuih Lab" });
	});

	it("a paused store warns, whoever paused it", () => {
		for (const by of ["seller", "admin", "hold"] as const)
			expect(storeGlance("Kuih Lab", { state: "paused", by })).toEqual({
				text: "Paused",
				tone: "warn",
			});
	});

	it("an offline store warns", () => {
		expect(storeGlance("Kuih Lab", { state: "offline", by: "admin" })).toEqual({
			text: "Offline",
			tone: "warn",
		});
	});
});
