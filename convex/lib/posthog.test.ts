import { describe, expect, test } from "vitest";
import {
	ANALYTICS_EVENTS,
	POSTHOG_MAX_DISTINCT_ID,
	posthogEnvironment,
	posthogEnvironmentFromUrl,
	sanitizeDistinctId,
} from "./posthog";

describe("sanitizeDistinctId", () => {
	test("keeps a well-formed posthog uuid untouched", () => {
		const id = "0198f3a1-4b2c-7d3e-8f90-a1b2c3d4e5f6";
		expect(sanitizeDistinctId(id)).toBe(id);
	});

	test("treats absent and blank input as no id", () => {
		expect(sanitizeDistinctId(undefined)).toBeUndefined();
		expect(sanitizeDistinctId(null)).toBeUndefined();
		expect(sanitizeDistinctId("")).toBeUndefined();
		expect(sanitizeDistinctId("   ")).toBeUndefined();
	});

	// A client that failed to mint an id happily sends the STRING "undefined".
	// Storing it would merge every such buyer into one shared PostHog person and
	// silently corrupt every funnel built on top.
	test.each([
		"undefined",
		"null",
		"NaN",
		"None",
		"anonymous",
		"guest",
		"distinct_id",
		"0",
		"true",
		"false",
		"[object Object]",
	])("drops the known-junk id %j", (junk) => {
		expect(sanitizeDistinctId(junk)).toBeUndefined();
	});

	test("matches junk case-insensitively and after trimming", () => {
		expect(sanitizeDistinctId("  UNDEFINED  ")).toBeUndefined();
		expect(sanitizeDistinctId("Null")).toBeUndefined();
	});

	test("strips control characters that would corrupt the POST body", () => {
		expect(sanitizeDistinctId("abc\u0000def")).toBe("abcdef");
		expect(sanitizeDistinctId("line\nbreak")).toBe("linebreak");
		expect(sanitizeDistinctId("tab\tsep")).toBe("tabsep");
		expect(sanitizeDistinctId("del\u007fete")).toBe("delete");
		// Control characters ONLY leaves nothing behind — that is not an id.
		expect(sanitizeDistinctId("\u0000\u0001\u007f")).toBeUndefined();
		// A plain space is not a control character; only the ends are trimmed.
		expect(sanitizeDistinctId("  keep me  ")).toBe("keep me");
	});

	test("caps at PostHog's documented distinct_id limit", () => {
		const long = "a".repeat(POSTHOG_MAX_DISTINCT_ID + 50);
		expect(sanitizeDistinctId(long)).toHaveLength(POSTHOG_MAX_DISTINCT_ID);
	});

	// The cap can re-expose trailing whitespace the first trim removed, and a
	// trailing space would make the same browser look like two people.
	test("is idempotent", () => {
		const messy = `${" ".repeat(5)}${"b".repeat(POSTHOG_MAX_DISTINCT_ID)}   `;
		const once = sanitizeDistinctId(messy);
		expect(once).toBeDefined();
		expect(sanitizeDistinctId(once)).toBe(once);
	});

	test("never throws on hostile input", () => {
		expect(() => sanitizeDistinctId("𝕏".repeat(5000))).not.toThrow();
		expect(() => sanitizeDistinctId("../../etc/passwd")).not.toThrow();
	});
});

describe("ANALYTICS_EVENTS", () => {
	// The event name is a contract with a third party's dashboard: renaming it
	// silently orphans every saved funnel and insight built on it.
	test("pins the wire names", () => {
		expect(ANALYTICS_EVENTS.orderCreated).toBe("order_created");
	});
});


describe("posthogEnvironment", () => {
	test("classifies the production host and its subdomains", () => {
		expect(posthogEnvironment("kedaipal.com")).toBe("production");
		expect(posthogEnvironment("www.kedaipal.com")).toBe("production");
		expect(posthogEnvironment("KEDAIPAL.COM")).toBe("production");
		// Trailing dot is a legal FQDN form.
		expect(posthogEnvironment("kedaipal.com.")).toBe("production");
	});

	test("everything else is development", () => {
		expect(posthogEnvironment("localhost")).toBe("development");
		expect(posthogEnvironment("127.0.0.1")).toBe("development");
		expect(posthogEnvironment("abc-123.trycloudflare.com")).toBe("development");
		expect(posthogEnvironment("kedaipal.workers.dev")).toBe("development");
	});

	// A look-alike domain must never be read as production — that is the one
	// direction that silently corrupts the numbers a decision gets made on.
	test("does not match look-alike domains", () => {
		expect(posthogEnvironment("notkedaipal.com")).toBe("development");
		expect(posthogEnvironment("kedaipal.com.evil.test")).toBe("development");
		expect(posthogEnvironment("fake-kedaipal.com")).toBe("development");
	});

	test("unknown input fails to development, never production", () => {
		expect(posthogEnvironment(undefined)).toBe("development");
		expect(posthogEnvironment(null)).toBe("development");
		expect(posthogEnvironment("")).toBe("development");
		expect(posthogEnvironment("   ")).toBe("development");
	});
});

describe("posthogEnvironmentFromUrl", () => {
	test("reads the hostname out of SITE_URL", () => {
		expect(posthogEnvironmentFromUrl("https://kedaipal.com")).toBe("production");
		expect(posthogEnvironmentFromUrl("https://kedaipal.com/app/orders")).toBe(
			"production",
		);
		expect(posthogEnvironmentFromUrl("http://localhost:3000")).toBe(
			"development",
		);
	});

	// An unset or malformed SITE_URL must not inherit the "https://kedaipal.com"
	// fallback the email helpers use — that would tag dev events as production.
	test("unset or unparseable reads as development", () => {
		expect(posthogEnvironmentFromUrl(undefined)).toBe("development");
		expect(posthogEnvironmentFromUrl("")).toBe("development");
		expect(posthogEnvironmentFromUrl("not a url")).toBe("development");
	});
});
