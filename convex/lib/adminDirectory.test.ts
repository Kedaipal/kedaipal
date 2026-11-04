import { describe, expect, it } from "vitest";
import {
	ADMIN_COUNT_SCAN_LIMIT,
	ADMIN_STORE_LIST_LIMIT,
	storeNameKeyOf,
} from "./adminDirectory";

describe("storeNameKeyOf", () => {
	it("lowercases and trims so the name index files 'iKuih' under i, not after Z", () => {
		expect(storeNameKeyOf("  iKuih by Mak ")).toBe("ikuih by mak");
		expect(storeNameKeyOf("Zed Outdoor")).toBe("zed outdoor");
	});
	it("collapses inner runs of whitespace", () => {
		expect(storeNameKeyOf("Kak   Ros\tKitchen")).toBe("kak ros kitchen");
	});
});

describe("the directory limits", () => {
	it("the count scan reaches further than the legacy list cap", () => {
		expect(ADMIN_COUNT_SCAN_LIMIT).toBeGreaterThan(ADMIN_STORE_LIST_LIMIT);
	});
});
