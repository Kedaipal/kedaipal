import { describe, expect, test } from "vitest";
import * as serverLegal from "../../convex/lib/legal";
import {
	AUP_VERSION,
	consentIsStale,
	LEGAL_CONTACT_EMAIL,
	PRIVACY_VERSION,
	TERMS_VERSION,
} from "./legal";

const allCurrent = {
	termsVersion: TERMS_VERSION,
	privacyVersion: PRIVACY_VERSION,
	aupVersion: AUP_VERSION,
};

// The two files are hand-mirrored (Convex bundles from `convex/`, the frontend
// from `src/`). Bumping only one silently desyncs the "Last updated" date shown
// on the legal page from the version stamped onto retailers — and from the one
// `consentIsStale` compares against, so the re-acceptance banner never fires.
describe("legal constants mirror convex/lib/legal.ts", () => {
	test("all three document versions match", () => {
		expect(TERMS_VERSION).toBe(serverLegal.TERMS_VERSION);
		expect(PRIVACY_VERSION).toBe(serverLegal.PRIVACY_VERSION);
		expect(AUP_VERSION).toBe(serverLegal.AUP_VERSION);
	});

	test("the contact address matches", () => {
		expect(LEGAL_CONTACT_EMAIL).toBe(serverLegal.LEGAL_CONTACT_EMAIL);
	});
});

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
