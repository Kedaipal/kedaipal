import { describe, expect, it } from "vitest";
import { buildStoreChatLink, storeChatPrefill } from "./store-chat";

const store = { storeName: "Kek Sayang Bakery", waPhone: "60123456789" };

describe("buildStoreChatLink (z8r3fdvwcy)", () => {
	it("is a wa.me link to the store's number with the store-named prefill", () => {
		const href = buildStoreChatLink(store, "en");
		expect(href).toBe(
			`https://wa.me/60123456789?text=${encodeURIComponent(
				"Hi Kek Sayang Bakery, I'm looking at your Kedaipal store and have a question.",
			)}`,
		);
	});

	it("takes an SG number as it is stored — no plus, no spaces", () => {
		const href = buildStoreChatLink(
			{ storeName: "Lekor Mr Ganu", waPhone: "6591234567" },
			"en",
		);
		expect(href?.startsWith("https://wa.me/6591234567?text=")).toBe(true);
	});

	it("speaks the store's locale", () => {
		expect(storeChatPrefill("Dapur Mak Yan", "ms")).toBe(
			"Hai Dapur Mak Yan, saya sedang lihat kedai Kedaipal anda dan ada soalan.",
		);
		expect(storeChatPrefill("Dapur Mak Yan", "zh")).toContain("Dapur Mak Yan");
		expect(
			buildStoreChatLink({ ...store, storeName: "Dapur Mak Yan" }, "ms"),
		).toContain(encodeURIComponent("Hai Dapur Mak Yan"));
	});

	it("URL-encodes a store name that carries & and an emoji", () => {
		const href = buildStoreChatLink(
			{ storeName: "Nasi & Kuih ✦", waPhone: "60123456789" },
			"en",
		);
		expect(href).not.toContain("&");
		expect(href).not.toContain("✦");
		expect(decodeURIComponent(href?.split("text=")[1] ?? "")).toContain(
			"Hi Nasi & Kuih ✦,",
		);
	});

	it("is null when the store has no WhatsApp number — the action is not rendered", () => {
		expect(buildStoreChatLink({ storeName: "No Phone" }, "en")).toBeNull();
		expect(
			buildStoreChatLink({ storeName: "Blank", waPhone: "  " }, "en"),
		).toBeNull();
	});

	it("is null when the owner switched the action off", () => {
		expect(
			buildStoreChatLink({ ...store, storefrontChatEnabled: false }, "en"),
		).toBeNull();
		expect(
			buildStoreChatLink({ ...store, storefrontChatEnabled: true }, "en"),
		).not.toBeNull();
	});
});
