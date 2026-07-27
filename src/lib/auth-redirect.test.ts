import { describe, expect, it } from "vitest";
import {
	DEFAULT_SIGNED_IN_DESTINATION,
	isSafeInternalPath,
	resolveSignedInDestination,
} from "./auth-redirect";

const ORIGIN = "https://kedaipal.com";

describe("isSafeInternalPath", () => {
	it("accepts ordinary same-origin paths", () => {
		expect(isSafeInternalPath("/app")).toBe(true);
		expect(isSafeInternalPath("/onboarding?p=abc123")).toBe(true);
		expect(isSafeInternalPath("/app/orders/ORD-1234#items")).toBe(true);
	});

	it("rejects anything that resolves off-origin", () => {
		expect(isSafeInternalPath("https://evil.com/app")).toBe(false);
		// Protocol-relative — the leading slash makes it *look* internal.
		expect(isSafeInternalPath("//evil.com")).toBe(false);
		expect(isSafeInternalPath("/\\evil.com")).toBe(false);
		expect(isSafeInternalPath("app")).toBe(false);
		expect(isSafeInternalPath("")).toBe(false);
	});

	it("rejects the auth routes themselves so a signed-in visitor can't loop", () => {
		expect(isSafeInternalPath("/sign-in")).toBe(false);
		expect(isSafeInternalPath("/sign-up")).toBe(false);
		expect(isSafeInternalPath("/sign-in/factor-one")).toBe(false);
		// A route that merely starts with the same letters is fine.
		expect(isSafeInternalPath("/sign-integrity")).toBe(true);
	});
});

describe("resolveSignedInDestination", () => {
	it("defaults to the dashboard when the URL carries nothing", () => {
		expect(resolveSignedInDestination({}, ORIGIN)).toBe(
			DEFAULT_SIGNED_IN_DESTINATION,
		);
	});

	it("honours Clerk's redirect_url so an invite's prefill survives", () => {
		expect(
			resolveSignedInDestination(
				{ redirect_url: "/onboarding?p=abc123" },
				ORIGIN,
			),
		).toBe("/onboarding?p=abc123");
	});

	it("accepts an absolute URL on our own origin (onboarding passes location.href)", () => {
		expect(
			resolveSignedInDestination(
				{ redirect_url: `${ORIGIN}/onboarding?p=abc123` },
				ORIGIN,
			),
		).toBe("/onboarding?p=abc123");
	});

	it("prefers a force redirect over the plain redirect_url", () => {
		expect(
			resolveSignedInDestination(
				{
					redirect_url: "/app",
					sign_up_force_redirect_url: "/onboarding?p=abc123",
				},
				ORIGIN,
			),
		).toBe("/onboarding?p=abc123");
	});

	it("falls back to the dashboard rather than following an off-origin redirect", () => {
		expect(
			resolveSignedInDestination(
				{ redirect_url: "https://evil.com/steal" },
				ORIGIN,
			),
		).toBe(DEFAULT_SIGNED_IN_DESTINATION);
		expect(
			resolveSignedInDestination({ redirect_url: "//evil.com" }, ORIGIN),
		).toBe(DEFAULT_SIGNED_IN_DESTINATION);
		expect(
			resolveSignedInDestination(
				{ redirect_url: `https://evil.com/x` },
				ORIGIN,
			),
		).toBe(DEFAULT_SIGNED_IN_DESTINATION);
	});

	it("falls back rather than bouncing back onto an auth route", () => {
		expect(
			resolveSignedInDestination(
				{ redirect_url: "/sign-in/factor-one" },
				ORIGIN,
			),
		).toBe(DEFAULT_SIGNED_IN_DESTINATION);
	});

	it("skips unusable values and keeps scanning", () => {
		expect(
			resolveSignedInDestination(
				{ sign_in_force_redirect_url: "   ", redirect_url: "/app/orders" },
				ORIGIN,
			),
		).toBe("/app/orders");
		expect(resolveSignedInDestination({ redirect_url: 42 }, ORIGIN)).toBe(
			DEFAULT_SIGNED_IN_DESTINATION,
		);
	});

	it("drops absolute URLs when no origin is known (SSR render)", () => {
		expect(
			resolveSignedInDestination({ redirect_url: `${ORIGIN}/onboarding` }),
		).toBe(DEFAULT_SIGNED_IN_DESTINATION);
		// Relative paths still work without an origin.
		expect(resolveSignedInDestination({ redirect_url: "/onboarding" })).toBe(
			"/onboarding",
		);
	});
});
