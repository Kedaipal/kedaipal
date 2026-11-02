import { describe, expect, test } from "vitest";
import { isLocalHttpOrigin } from "./localOrigin";

describe("isLocalHttpOrigin", () => {
	test.each([
		"http://localhost",
		"http://localhost:3000/track/ORD-ABCD",
		"http://LOCALHOST:3000",
		"http://app.localhost:3000/",
		"http://127.0.0.1:8787/",
		"http://127.1.2.3/",
		"http://0.0.0.0:3000",
		"http://[::1]:3000/",
		"http://10.0.0.12:3000/",
		"http://192.168.1.5:3000?x=1",
		"http://172.16.0.4/",
		"http://172.31.255.255#h",
	])("local: %s", (url) => {
		expect(isLocalHttpOrigin(url)).toBe(true);
	});

	// A prefix match would have accepted every one of these.
	test.each([
		"http://localhost.evil.com/",
		"http://localhostx/",
		"http://10.example.com/",
		"http://192.168.evil.com/",
		"http://127.0.0.1.nip.io/",
		"http://172.15.0.1/",
		"http://172.32.0.1/",
		"http://kedaipal.com/",
	])("public: %s", (url) => {
		expect(isLocalHttpOrigin(url)).toBe(false);
	});

	test("https is never a local http origin", () => {
		expect(isLocalHttpOrigin("https://localhost:3000/")).toBe(false);
	});
});
