import { describe, expect, it, vi } from "vitest";
import { handleImageRequest } from "./image-route";

const UUID = "3346125e-42d4-4560-a3e1-abf7438de45f";
const CONVEX = "https://peaceful-falcon-152.convex.cloud";

function okResponse(headers: Record<string, string> = {}) {
	return new Response("bytes", {
		status: 200,
		headers: {
			"content-type": "image/webp",
			"cache-control": "private, max-age=2592000",
			...headers,
		},
	});
}

/** Returns [handler result, the fetch spy] for a GET of `url`. */
async function get(
	url: string,
	upstream = okResponse(),
	convexUrl: string | null = CONVEX,
) {
	const fetchImpl = vi.fn().mockResolvedValue(upstream);
	const res = await handleImageRequest(new Request(url), {
		// `null` is the explicit "not configured" sentinel — a defaulted
		// `undefined` parameter would silently fall back to CONVEX and the
		// misconfiguration branch would never actually be exercised.
		convexUrl: convexUrl ?? undefined,
		fetchImpl: fetchImpl as unknown as typeof fetch,
	});
	return { res, fetchImpl };
}

describe("handleImageRequest — routing", () => {
	it("returns null for anything that isn't the image route, so the app router runs", async () => {
		for (const path of [
			"/",
			"/her-moolah-collective",
			"/track/abc",
			"/imgx/y",
		]) {
			const { res } = await get(`https://kedaipal.com${path}`);
			expect(res).toBeNull();
		}
	});

	it("handles the image route", async () => {
		const { res } = await get(`https://kedaipal.com/img/${UUID}?w=320`);
		expect(res?.status).toBe(200);
	});
});

describe("handleImageRequest — origin construction is closed", () => {
	it("builds the origin from the uuid alone — the caller never supplies a host", async () => {
		const { fetchImpl } = await get(`https://kedaipal.com/img/${UUID}?w=320`);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(fetchImpl.mock.calls[0][0]).toBe(`${CONVEX}/api/storage/${UUID}`);
	});

	it.each([
		["a full URL as the id", "https://evil.example.com/x.jpg"],
		["a protocol-relative host", "//evil.example.com/x.jpg"],
		["path traversal", "../../api/query"],
		["an empty id", ""],
		["a non-uuid id", "not-a-uuid"],
		["a uuid with a suffix", `${UUID}extra`],
		["a nested path", `${UUID}/../secret`],
	])("404s on %s without ever fetching", async (_label, id) => {
		const { res, fetchImpl } = await get(
			`https://kedaipal.com/img/${encodeURIComponent(id)}`,
		);
		expect(res?.status).toBe(404);
		// The point of the whole design: an unrecognised id can never reach fetch,
		// so this can never become an open proxy billed to our account.
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("500s when the Convex origin isn't configured, rather than guessing one", async () => {
		const { res, fetchImpl } = await get(
			`https://kedaipal.com/img/${UUID}`,
			okResponse(),
			null,
		);
		expect(res?.status).toBe(500);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("rejects non-GET/HEAD methods", async () => {
		const fetchImpl = vi.fn();
		const res = await handleImageRequest(
			new Request(`https://kedaipal.com/img/${UUID}`, { method: "POST" }),
			{ convexUrl: CONVEX, fetchImpl: fetchImpl as unknown as typeof fetch },
		);
		expect(res?.status).toBe(405);
		expect(res?.headers.get("allow")).toBe("GET, HEAD");
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe("handleImageRequest — transformation options", () => {
	function cfOf(fetchImpl: ReturnType<typeof vi.fn>) {
		return (
			fetchImpl.mock.calls[0][1] as { cf: { image: Record<string, unknown> } }
		).cf;
	}

	it("asks Cloudflare for the requested width as webp, never upscaling", async () => {
		const { fetchImpl } = await get(`https://kedaipal.com/img/${UUID}?w=960`);
		expect(cfOf(fetchImpl).image).toMatchObject({
			width: 960,
			format: "webp",
			fit: "scale-down",
		});
	});

	it("clamps a hostile width to the whitelist — the unique-transformation bill is bounded", async () => {
		const { fetchImpl } = await get(`https://kedaipal.com/img/${UUID}?w=99999`);
		expect(cfOf(fetchImpl).image.width).toBe(1280);
	});

	it("caches successful transforms hard at the edge", async () => {
		const { fetchImpl } = await get(`https://kedaipal.com/img/${UUID}?w=320`);
		const cf = cfOf(fetchImpl) as unknown as {
			cacheEverything: boolean;
			cacheTtlByStatus: Record<string, number>;
		};
		expect(cf.cacheEverything).toBe(true);
		expect(cf.cacheTtlByStatus["200-299"]).toBe(31_536_000);
		// A missing file must NOT be cached for a year — a deleted blob would
		// otherwise 404 at the edge long after it stopped mattering.
		expect(cf.cacheTtlByStatus["404"]).toBe(60);
	});
});

describe("handleImageRequest — response headers", () => {
	it("replaces Convex's `private` caching with a public, immutable year", async () => {
		const { res } = await get(`https://kedaipal.com/img/${UUID}?w=320`);
		// `private` is exactly why storage has no CDN in front of it today.
		expect(res?.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
	});

	it("does not slap an immutable year onto a failed upstream response", async () => {
		const { res } = await get(
			`https://kedaipal.com/img/${UUID}?w=320`,
			new Response("nope", { status: 404 }),
		);
		expect(res?.status).toBe(404);
		// Upstream sent no cache-control and we must not invent one.
		expect(res?.headers.get("cache-control")).toBeNull();
	});

	it("passes the original bytes through when the transform could not run", async () => {
		// Zone toggle off, or an SVG source: Cloudflare returns the ORIGINAL with
		// a `Cf-Resized: err=` marker. That must degrade to today's behaviour —
		// a real picture — never to a broken image.
		const { res } = await get(
			`https://kedaipal.com/img/${UUID}?w=320`,
			okResponse({ "cf-resized": "err=9421" }),
		);
		expect(res?.status).toBe(200);
		expect(await res?.text()).toBe("bytes");
		expect(res?.headers.get("cf-resized")).toBe("err=9421");
	});
});
