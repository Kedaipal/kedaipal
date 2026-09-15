import { describe, expect, test } from "vitest";
import {
	categoryChangeShouldAlert,
	extractWabaTemplateEvents,
} from "./wabaTemplateWebhook";

function envelope(field: string, value: Record<string, unknown>) {
	return {
		object: "whatsapp_business_account",
		entry: [{ id: "WABA_ID", changes: [{ field, value }] }],
	};
}

const STATUS = "message_template_status_update";
const CATEGORY = "template_category_update";
const QUALITY = "message_template_quality_update";

describe("extractWabaTemplateEvents — status updates", () => {
	test("PAUSED alerts and carries the reason", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(STATUS, {
				event: "PAUSED",
				message_template_id: 1,
				message_template_name: "order_confirmation_utility",
				message_template_language: "en",
				reason: "LOW_QUALITY",
			}),
		);
		expect(ev).toMatchObject({
			kind: "status",
			templateName: "order_confirmation_utility",
			language: "en",
			event: "PAUSED",
			reason: "LOW_QUALITY",
			shouldAlert: true,
		});
		expect(ev.summary).toContain("PAUSED");
		expect(ev.summary).toContain("LOW_QUALITY");
	});

	test("APPROVED is recorded but does not alert", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(STATUS, {
				event: "approved",
				message_template_name: "payment_reminder_utility",
				message_template_language: "ms",
			}),
		);
		expect(ev).toMatchObject({ event: "APPROVED", shouldAlert: false });
	});

	test.each(["REJECTED", "DISABLED", "PENDING_DELETION", "FLAGGED"])(
		"%s alerts",
		(event) => {
			const [ev] = extractWabaTemplateEvents(
				envelope(STATUS, { event, message_template_name: "t" }),
			);
			expect(ev.shouldAlert).toBe(true);
		},
	);

	test("disable_info + other_info flatten into the reason", () => {
		const [disabled] = extractWabaTemplateEvents(
			envelope(STATUS, {
				event: "DISABLED",
				message_template_name: "t",
				disable_info: { disable_date: "2026-10-03" },
			}),
		);
		expect(disabled.reason).toBe("disable_date=2026-10-03");
		const [rejected] = extractWabaTemplateEvents(
			envelope(STATUS, {
				event: "REJECTED",
				message_template_name: "t",
				other_info: { title: "INVALID_FORMAT", description: "bad braces" },
			}),
		);
		expect(rejected.reason).toBe("INVALID_FORMAT: bad braces");
	});
});

describe("extractWabaTemplateEvents — category changes (the 6.1× trap)", () => {
	test("UTILITY → MARKETING alerts", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(CATEGORY, {
				message_template_name: "seller_new_order_utility",
				message_template_language: "en",
				previous_category: "UTILITY",
				new_category: "MARKETING",
			}),
		);
		expect(ev).toMatchObject({
			kind: "category",
			previousCategory: "UTILITY",
			newCategory: "MARKETING",
			shouldAlert: true,
		});
		expect(ev.summary).toBe(
			"seller_new_order_utility (en) category UTILITY → MARKETING",
		);
	});

	test("MARKETING → UTILITY (an appeal won) is recorded, no alert", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(CATEGORY, {
				message_template_name: "t",
				previous_category: "MARKETING",
				new_category: "UTILITY",
			}),
		);
		expect(ev.shouldAlert).toBe(false);
	});

	test("correct_category rides along as the reason", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(CATEGORY, {
				message_template_name: "t",
				previous_category: "UTILITY",
				new_category: "MARKETING",
				correct_category: "MARKETING",
			}),
		);
		expect(ev.reason).toBe("correct_category=MARKETING");
	});

	test("categoryChangeShouldAlert truth table", () => {
		expect(categoryChangeShouldAlert("UTILITY", "MARKETING")).toBe(true);
		expect(categoryChangeShouldAlert(undefined, "MARKETING")).toBe(true);
		expect(categoryChangeShouldAlert("UTILITY", "AUTHENTICATION")).toBe(false);
		expect(categoryChangeShouldAlert("MARKETING", "UTILITY")).toBe(false);
		expect(categoryChangeShouldAlert("MARKETING", "MARKETING")).toBe(false);
		expect(categoryChangeShouldAlert("UTILITY", undefined)).toBe(false);
	});
});

describe("extractWabaTemplateEvents — quality scores", () => {
	test("GREEN → RED alerts; quality events use Meta's bare `name`", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(QUALITY, {
				previous_quality_score: "GREEN",
				new_quality_score: "RED",
				message_template_id: 2,
				name: "claim_link_utility",
				language: "en",
			}),
		);
		expect(ev).toMatchObject({
			kind: "quality",
			templateName: "claim_link_utility",
			previousQuality: "GREEN",
			newQuality: "RED",
			shouldAlert: true,
		});
	});

	test("YELLOW alerts (the pre-pause warning); GREEN does not", () => {
		expect(
			extractWabaTemplateEvents(
				envelope(QUALITY, { name: "t", new_quality_score: "YELLOW" }),
			)[0].shouldAlert,
		).toBe(true);
		expect(
			extractWabaTemplateEvents(
				envelope(QUALITY, { name: "t", new_quality_score: "GREEN" }),
			)[0].shouldAlert,
		).toBe(false);
	});
});

describe("extractWabaTemplateEvents — robustness", () => {
	test("ignores health + message fields, junk, and events with no template name", () => {
		expect(
			extractWabaTemplateEvents(
				envelope("phone_number_quality_update", { event: "FLAGGED" }),
			),
		).toEqual([]);
		expect(
			extractWabaTemplateEvents(envelope("messages", { messages: [] })),
		).toEqual([]);
		expect(extractWabaTemplateEvents(envelope(STATUS, { event: "PAUSED" }))).toEqual(
			[],
		);
		expect(extractWabaTemplateEvents(null)).toEqual([]);
		expect(extractWabaTemplateEvents("nope")).toEqual([]);
		expect(extractWabaTemplateEvents({ entry: "nope" })).toEqual([]);
		expect(extractWabaTemplateEvents({ entry: [{ changes: [null, 3] }] })).toEqual(
			[],
		);
	});

	test("several changes in one entry all come out, in order", () => {
		const events = extractWabaTemplateEvents({
			entry: [
				{
					changes: [
						{
							field: STATUS,
							value: { event: "APPROVED", message_template_name: "a" },
						},
						{
							field: CATEGORY,
							value: {
								message_template_name: "b",
								previous_category: "UTILITY",
								new_category: "MARKETING",
							},
						},
					],
				},
			],
		});
		expect(events.map((e) => e.templateName)).toEqual(["a", "b"]);
		expect(events.map((e) => e.shouldAlert)).toEqual([false, true]);
	});

	test("missing language reads as '?' rather than dropping the event", () => {
		const [ev] = extractWabaTemplateEvents(
			envelope(STATUS, { event: "PAUSED", message_template_name: "t" }),
		);
		expect(ev.language).toBe("?");
	});
});
