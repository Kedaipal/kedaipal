import { describe, expect, it } from "vitest";
import type { MessageTemplates } from "../../convex/lib/whatsappCopy";
import { editableTemplates } from "./message-templates";

describe("editableTemplates", () => {
	it("drops a legacy store's dead keys, which would otherwise refuse the whole save", () => {
		// Shape of a row saved before one-message-per-order: the schema still
		// allows these keys, the updateSettings validator does not.
		const legacy = {
			en: { confirm: "Hi {shortId}", packed: "Packed!", shipped: "Out!" },
			ms: { unknownFallback: "Maaf" },
		} as unknown as MessageTemplates;
		expect(editableTemplates(legacy)).toEqual({
			en: { confirm: "Hi {shortId}" },
		});
	});

	it("treats blank as 'use the default' and omits the language", () => {
		expect(
			editableTemplates({ en: { confirm: "   " }, zh: { confirm: "你好" } }),
		).toEqual({
			zh: { confirm: "你好" },
		});
	});

	it("is empty for a store that never customised anything", () => {
		expect(editableTemplates(undefined)).toEqual({});
	});
});
