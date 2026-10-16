/**
 * The FAQ items shown on `/` and mirrored into its `FAQPage` structured data
 * (landing v2, z8r3fdegej). ONE ordered list of ids feeds both `faq.tsx`
 * (via `m.faq_q_<id>`) and `src/routes/index.tsx` (via the English catalog),
 * so the two cannot drift — Google ignores or penalises FAQ JSON-LD that
 * doesn't match on-page content, and before this the mirror was a comment
 * asking the next editor to remember.
 *
 * Order is the argument the page makes: WhatsApp setup → payments → selling
 * more (promotions, flash sales, vouchers — the one sell-more question, right
 * after the money lands) → couriers → the "does it fit my shop" questions
 * (a stall, custom-made, a helper without my bank details, Singapore or
 * overseas buyers) → data → who's behind it.
 */
export const FAQ_PRIMARY_IDS = [1, 3, 14, 13, 12, 11, 15, 16, 7, 10] as const;

/** Revealed by "See all questions" — never in the structured data. The pause
 * plan (9) leads it: a cost question, asked once a seller is already sold. */
export const FAQ_SECONDARY_IDS = [9, 8, 2, 4, 5, 6] as const;

export type FaqId =
	| (typeof FAQ_PRIMARY_IDS)[number]
	| (typeof FAQ_SECONDARY_IDS)[number];

/** A compiled paraglide message: `(inputs?, { locale? })` → string. */
type Message = (
	inputs?: Record<string, never>,
	options?: { locale?: "en" | "ms" | "zh" },
) => string;

export type FaqMessages = Record<FaqId, { q: Message; a: Message }>;

/**
 * `FAQPage.mainEntity` for `/`, always in English — the structured data is
 * one document per URL, not per locale. Reads the SAME message functions the
 * FAQ component renders (with paraglide's locale override), so the English
 * catalog never has to be imported into the client bundle.
 */
export function faqJsonLd(messages: FaqMessages) {
	return FAQ_PRIMARY_IDS.map((id) => ({
		"@type": "Question",
		name: messages[id].q({}, { locale: "en" }),
		acceptedAnswer: {
			"@type": "Answer",
			text: messages[id].a({}, { locale: "en" }),
		},
	}));
}
