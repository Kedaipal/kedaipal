import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOLD_MONTHLY_PRICES } from "../../convex/lib/plans";
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

	it("answers the three questions the Oct 2026 features raised, in the argument's order", () => {
		// Sell-more right after the money lands; the two fit-my-shop questions
		// (a helper, Singapore) with their siblings; all three in the JSON-LD.
		expect(m.faq_q_14()).toMatch(/sale/i);
		expect(m.faq_a_14()).toMatch(/voucher/i);
		expect(m.faq_q_15()).toMatch(/bank details/i);
		expect(m.faq_q_16()).toMatch(/Singapore/);
		const at = (id: (typeof FAQ_PRIMARY_IDS)[number]) =>
			FAQ_PRIMARY_IDS.indexOf(id);
		expect(at(14)).toBe(at(3) + 1);
		expect(at(13)).toBe(at(14) + 1);
		expect(at(15)).toBeGreaterThan(at(12));
		expect(at(16)).toBe(at(15) + 1);
		expect(at(7)).toBeGreaterThan(at(16));
	});

	it("quotes the pause plan at the hold price the ledger charges, in every locale", () => {
		// FAQ answers render param-less (the FAQPage mirror), so the price is
		// spelled in; this pins it to `HOLD_MONTHLY_PRICES` the way faq_a_8 is
		// pinned to the trial constants — the one way a spelled price can't rot.
		const my = String(HOLD_MONTHLY_PRICES.MYR / 100);
		const sg = String(HOLD_MONTHLY_PRICES.SGD / 100);
		for (const locale of ["en", "ms", "zh"] as const) {
			const answer = m.faq_a_9({}, { locale });
			expect(answer, locale).toMatch(new RegExp(`RM ?${my}\\b`));
			expect(answer, locale).toMatch(new RegExp(`S\\$ ?${sg}\\b`));
		}
		expect(m.faq_q_9()).toMatch(/quiet/i);
		expect(FAQ_SECONDARY_IDS[0]).toBe(9);
	});
});
