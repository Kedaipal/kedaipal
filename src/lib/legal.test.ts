import { describe, expect, test } from "vitest";
import {
	AUP_VERSION,
	consentIsStale,
	PRIVACY_VERSION,
	TERMS_VERSION,
} from "./legal";

const allCurrent = {
	termsVersion: TERMS_VERSION,
	privacyVersion: PRIVACY_VERSION,
	aupVersion: AUP_VERSION,
};

describe("consentIsStale", () => {
	test("false when all three accepted versions are current", () => {
		expect(consentIsStale(allCurrent)).toBe(false);
	});

	test("true when no versions have been accepted", () => {
		expect(consentIsStale({})).toBe(true);
	});

	test("true when the terms version is stale", () => {
		expect(consentIsStale({ ...allCurrent, termsVersion: "2020-01-01" })).toBe(
			true,
		);
	});

	test("true when the privacy version is stale", () => {
		expect(
			consentIsStale({ ...allCurrent, privacyVersion: "2020-01-01" }),
		).toBe(true);
	});

	test("true when the AUP version is stale", () => {
		expect(consentIsStale({ ...allCurrent, aupVersion: "2020-01-01" })).toBe(
			true,
		);
	});

	test("true when a single version is missing", () => {
		expect(
			consentIsStale({
				termsVersion: TERMS_VERSION,
				privacyVersion: PRIVACY_VERSION,
			}),
		).toBe(true);
	});
});
