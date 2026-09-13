import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_MESSAGES } from "../components/landing/faq";
import { m } from "../paraglide/messages";
import { FAQ_PRIMARY_IDS, FAQ_SECONDARY_IDS, faqJsonLd } from "./landing-faq";

const en = JSON.parse(
	readFileSync(join(process.cwd(), "messages", "en.json"), "utf8"),
) as Record<string, string>;

describe("landing FAQ ↔ FAQPage structured data", () => {
	it("mirrors every visible primary question, in order, verbatim, in English", () => {
		const entries = faqJsonLd(FAQ_MESSAGES);
		expect(entries).toHaveLength(FAQ_PRIMARY_IDS.length);
		FAQ_PRIMARY_IDS.forEach((id, i) => {
			expect(entries[i].name).toBe(en[`faq_q_${id}`]);
			expect(entries[i].acceptedAnswer.text).toBe(en[`faq_a_${id}`]);
			// …and it is exactly what the component renders for that id.
			expect(entries[i].name).toBe(FAQ_MESSAGES[id].q({}, { locale: "en" }));
		});
	});

	it("keeps the two lists disjoint and every id renderable", () => {
		const ids = [...FAQ_PRIMARY_IDS, ...FAQ_SECONDARY_IDS];
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(FAQ_MESSAGES[id].q(), `faq_q_${id}`).toBeTruthy();
			expect(FAQ_MESSAGES[id].a(), `faq_a_${id}`).toBeTruthy();
		}
	});

	it("puts the courier question on the page (z8r3fdegej AC)", () => {
		expect(FAQ_PRIMARY_IDS).toContain(13);
		expect(m.faq_q_13()).toMatch(/courier/i);
	});
});
