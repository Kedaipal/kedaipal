import { describe, expect, it } from "vitest";
import { confirmationSentBody } from "./track-confirmation-copy";

const STATES = [
	{ free: false, paymentsPaused: false },
	{ free: true, paymentsPaused: false },
	{ free: false, paymentsPaused: true },
];

describe("confirmationSentBody — the 'Confirmation sent' card", () => {
	it("tells the buyer plainly they have nothing to send — never the bare 'Nothing to send.'", () => {
		for (const s of STATES) {
			const en = confirmationSentBody({ ms: false, ...s });
			expect(en.startsWith("You don't need to message the store")).toBe(true);
			expect(en).not.toMatch(/^Nothing to send/);
		}
	});

	it("each state keeps its own promise", () => {
		expect(
			confirmationSentBody({ ms: false, free: true, paymentsPaused: false }),
		).toMatch(/nothing to pay/);
		expect(
			confirmationSentBody({ ms: false, free: false, paymentsPaused: true }),
		).toMatch(/once the store is taking payments/);
		expect(
			confirmationSentBody({ ms: false, free: false, paymentsPaused: false }),
		).toMatch(/how to pay, your latest status/);
	});

	it("Malay keeps its own (already plain) wording", () => {
		for (const s of STATES) {
			expect(confirmationSentBody({ ms: true, ...s })).toMatch(
				/^Tak perlu hantar apa-apa/,
			);
		}
	});
});
