import { describe, expect, test } from "vitest";
import { templateParam } from "./whatsapp";

/**
 * Meta rejects template parameters containing newlines, tabs, or 4+ consecutive
 * spaces, and `classifyPushFailure` treats that rejection (132007) as TERMINAL —
 * no retry, the buyer simply never gets the message. Buyer-controlled strings
 * (a WhatsApp pushname, a cashier-typed name) reach `bodyParams` on the claim
 * link and the seller alerts, so this guard is what stops one pasted tab from
 * killing a send.
 */
describe("templateParam", () => {
	test("collapses the exact shapes Meta rejects", () => {
		expect(templateParam("Ali\tBaba", "x")).toBe("Ali Baba");
		expect(templateParam("Ali\nBaba", "x")).toBe("Ali Baba");
		expect(templateParam("Ali\r\nBaba", "x")).toBe("Ali Baba");
		// 4+ consecutive spaces is its own rejection class.
		expect(templateParam("Ali    Baba", "x")).toBe("Ali Baba");
		expect(templateParam("  Ali  Baba  ", "x")).toBe("Ali Baba");
	});

	test("empty / whitespace-only degenerates to the fallback (empty is also rejected)", () => {
		expect(templateParam(undefined, "there")).toBe("there");
		expect(templateParam(null, "there")).toBe("there");
		expect(templateParam("", "there")).toBe("there");
		expect(templateParam("   \t\n ", "there")).toBe("there");
	});

	test("an ordinary name passes through untouched", () => {
		expect(templateParam("Aina Hamzah", "there")).toBe("Aina Hamzah");
		expect(templateParam("K Frozen Food", "the store")).toBe("K Frozen Food");
		// Non-Latin names must survive intact — only whitespace is normalized.
		expect(templateParam("陈美玲", "there")).toBe("陈美玲");
		expect(templateParam("Nurul 'Ain", "there")).toBe("Nurul 'Ain");
	});
});
