import { describe, expect, it } from "vitest";
import { httpsRedirectStatus, httpsRedirectTarget } from "./https-redirect";

describe("httpsRedirectTarget", () => {
	it("redirects a public http root to the same https URL", () => {
		expect(httpsRedirectTarget("http://kedaipal.com/")).toBe(
			"https://kedaipal.com/",
		);
	});

	it("keeps path and query identical", () => {
		expect(
			httpsRedirectTarget("http://kedaipal.com/some-slug/p/abc?ref=wa"),
		).toBe("https://kedaipal.com/some-slug/p/abc?ref=wa");
	});

	it.each([
		["/track/abc123DEF456ghi789", "a buyer tracking link"],
		["/app/orders/ORD-ABCD", "a seller dashboard page"],
		["/img/3346125e-42d4-4560-a3e1-abf7438de45f?w=480", "an image route"],
	])("redirects %s (%s) before any route handles it", (path) => {
		expect(httpsRedirectTarget(`http://kedaipal.com${path}`)).toBe(
			`https://kedaipal.com${path}`,
		);
	});

	// The placeholder rescue then 301s the https URL to the clean one — one hop
	// each. The 86eyheqzv loop was the router DECODING the braces in `Location`;
	// this hop must leave them percent-encoded.
	it("preserves percent-encoded placeholder paths byte-for-byte", () => {
		const path = "/track/%7B%7B1%7D%7Dabc123?x=%7B%7D&y=a%20b";
		expect(httpsRedirectTarget(`http://kedaipal.com${path}`)).toBe(
			`https://kedaipal.com${path}`,
		);
	});

	// `Response.redirect` parses and re-serialises the target before it reaches
	// `Location` — this pins what the browser actually receives, not just the
	// helper's string.
	it("survives Response.redirect's serialisation into Location", () => {
		const url =
			"http://kedaipal.com/track/%7B%7B1%7D%7Dabc123?x=%7B%7D&y=a%20b";
		const target = httpsRedirectTarget(url);
		expect(target).not.toBeNull();
		const response = Response.redirect(
			target as string,
			httpsRedirectStatus("GET"),
		);
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe(
			url.replace(/^http:/, "https:"),
		);
	});

	it("drops a non-default port on a public host", () => {
		expect(httpsRedirectTarget("http://kedaipal.com:8080/pricing")).toBe(
			"https://kedaipal.com/pricing",
		);
	});

	it("redirects a bare host with no path", () => {
		expect(httpsRedirectTarget("http://kedaipal.com")).toBe(
			"https://kedaipal.com",
		);
	});

	it("covers *.workers.dev, where Cloudflare zone settings don't apply", () => {
		expect(httpsRedirectTarget("http://kedaipal.acct.workers.dev/x")).toBe(
			"https://kedaipal.acct.workers.dev/x",
		);
	});

	it("matches the scheme case-insensitively", () => {
		expect(httpsRedirectTarget("HTTP://kedaipal.com/a")).toBe(
			"https://kedaipal.com/a",
		);
	});

	it("leaves an https request alone", () => {
		expect(httpsRedirectTarget("https://kedaipal.com/pricing")).toBeNull();
	});

	it.each([
		"http://localhost:3000/",
		"http://localhost/app",
		"http://app.localhost:3000/x",
		"http://127.0.0.1:8787/",
		"http://0.0.0.0:3000/",
		"http://[::1]:3000/",
		"http://192.168.1.5:3000/track/abc",
		"http://10.0.0.12:3000/",
		"http://172.16.0.4/",
		"http://172.31.255.255:5173/",
	])("never redirects local dev: %s", (url) => {
		expect(httpsRedirectTarget(url)).toBeNull();
	});

	it.each([
		"http://localhost.evil.com/",
		"http://10.example.com/",
		"http://192.168.example.com/",
		"http://172.32.0.1/",
	])("treats a host that only LOOKS local as public: %s", (url) => {
		expect(httpsRedirectTarget(url)).toBe(url.replace(/^http:/, "https:"));
	});

	it.each([
		"",
		"ftp://kedaipal.com/",
		"http://",
		"not a url",
	])("returns null for a non-http or hostless URL: %j", (url) => {
		expect(httpsRedirectTarget(url)).toBeNull();
	});
});

describe("httpsRedirectStatus", () => {
	it.each(["GET", "HEAD", "get"])("is a permanent 301 for %s", (method) => {
		expect(httpsRedirectStatus(method)).toBe(301);
	});

	it.each([
		"POST",
		"PUT",
		"PATCH",
		"DELETE",
		"OPTIONS",
	])("is 308 for %s so the method and body are not downgraded to GET", (method) => {
		expect(httpsRedirectStatus(method)).toBe(308);
	});
});
