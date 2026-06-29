import { describe, expect, test } from "vitest";
import { extractWabaHealthEvents } from "./wabaWebhook";

function qualityPayload(event: string, currentLimit?: string) {
	return {
		object: "whatsapp_business_account",
		entry: [
			{
				id: "WABA_ID",
				changes: [
					{
						field: "phone_number_quality_update",
						value: {
							display_phone_number: "60123456789",
							event,
							...(currentLimit ? { current_limit: currentLimit } : {}),
						},
					},
				],
			},
		],
	};
}

function accountPayload(event: string) {
	return {
		object: "whatsapp_business_account",
		entry: [
			{
				id: "WABA_ID",
				changes: [{ field: "account_update", value: { event } }],
			},
		],
	};
}

describe("extractWabaHealthEvents", () => {
	test("FLAGGED → LOW, with messaging tier", () => {
		const [ev] = extractWabaHealthEvents(qualityPayload("FLAGGED", "TIER_1K"));
		expect(ev).toMatchObject({ qualityRating: "LOW", messagingTier: 1000 });
	});

	test("DOWNGRADE → MEDIUM, UNFLAGGED/UPGRADE → HIGH", () => {
		expect(
			extractWabaHealthEvents(qualityPayload("DOWNGRADE"))[0].qualityRating,
		).toBe("MEDIUM");
		expect(
			extractWabaHealthEvents(qualityPayload("UNFLAGGED"))[0].qualityRating,
		).toBe("HIGH");
		expect(
			extractWabaHealthEvents(qualityPayload("UPGRADE"))[0].qualityRating,
		).toBe("HIGH");
	});

	test("severe account events → LOW", () => {
		expect(
			extractWabaHealthEvents(accountPayload("ACCOUNT_RESTRICTION"))[0],
		).toMatchObject({ qualityRating: "LOW" });
		expect(extractWabaHealthEvents(accountPayload("DISABLED_UPDATE"))).toHaveLength(
			1,
		);
	});

	test("benign account events emit nothing (don't downgrade)", () => {
		expect(extractWabaHealthEvents(accountPayload("VERIFIED_ACCOUNT"))).toEqual(
			[],
		);
		expect(extractWabaHealthEvents(accountPayload("PARTNER_ADDED"))).toEqual([]);
	});

	test("ignores message webhooks + template-status + garbage", () => {
		expect(
			extractWabaHealthEvents({
				object: "whatsapp_business_account",
				entry: [
					{ id: "1", changes: [{ field: "messages", value: { messages: [] } }] },
				],
			}),
		).toEqual([]);
		expect(
			extractWabaHealthEvents({
				entry: [
					{
						changes: [
							{ field: "message_template_status_update", value: { event: "APPROVED" } },
						],
					},
				],
			}),
		).toEqual([]);
		expect(extractWabaHealthEvents(null)).toEqual([]);
		expect(extractWabaHealthEvents({ entry: "nope" })).toEqual([]);
	});
});
