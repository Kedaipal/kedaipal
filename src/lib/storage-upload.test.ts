// @vitest-environment jsdom
/**
 * z8r3fdtk85 — a product photo sat on "Uploading…" forever with no request in
 * the Network tab. Every step of an upload used to be an unbounded await, so
 * one that never settled left a spinner with nothing behind it.
 *
 * Pins the contract every upload site now leans on: `uploadImage` always
 * SETTLES — a step that never answers becomes a timeout with a sentence and a
 * retryable flag — and each failure says honestly whether Retry can help.
 */
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareImageUpload = vi.fn();
vi.mock("./image-upload", () => ({
	prepareImageUpload: (file: File) => prepareImageUpload(file),
}));

import {
	MINT_TIMEOUT_MS,
	POST_TIMEOUT_MS,
	PREPARE_TIMEOUT_MS,
	prepareImage,
	uploadImage,
} from "./storage-upload";

const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
const blob = new Blob(["y"], { type: "image/webp" });
const never = <T>() => new Promise<T>(() => {});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	prepareImageUpload.mockReset();
	prepareImageUpload.mockResolvedValue({
		ok: true,
		blob,
		contentType: "image/webp",
		normalized: true,
	});
	fetchMock = vi.fn(async () => ({
		ok: true,
		json: async () => ({ storageId: "s-1" }),
	}));
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("uploadImage — the happy path", () => {
	it("returns the storage id and the bytes it stored", async () => {
		const mint = vi.fn(async () => "https://upload.example/u");
		const result = await uploadImage(file, mint);
		expect(result).toEqual({ ok: true, storageId: "s-1", blob });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://upload.example/u",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "image/webp" },
				body: blob,
			}),
		);
	});
});

describe("uploadImage — a step that never answers still settles", () => {
	it("prepare: a decode/encode that hangs times out, retryable", async () => {
		prepareImageUpload.mockReturnValue(never());
		const mint = vi.fn(async () => "u");
		const pending = uploadImage(file, mint);
		await vi.advanceTimersByTimeAsync(PREPARE_TIMEOUT_MS);
		const result = await pending;
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "timeout", step: "prepare" },
		});
		expect(mint).not.toHaveBeenCalled();
	});

	it("mint: an upload-URL call the client never sends times out — the Campfest hang", async () => {
		// A Convex mutation queued behind a reconnecting socket or a stalled
		// auth refresh: it never resolves AND never reaches the network, which
		// is exactly why DevTools showed no request.
		const pending = uploadImage(file, () => never<string>());
		await vi.advanceTimersByTimeAsync(MINT_TIMEOUT_MS);
		const result = await pending;
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "timeout", step: "mint" },
		});
		expect(result.ok === false && result.message).toMatch(
			/Couldn't reach Kedaipal/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("post: a byte upload that stalls times out AND is aborted", async () => {
		let signal: AbortSignal | undefined;
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			signal = init.signal ?? undefined;
			return never();
		});
		const pending = uploadImage(file, async () => "u");
		await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS);
		const result = await pending;
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "timeout", step: "post" },
		});
		// Stops the bytes still going up after we've given up on them.
		expect(signal?.aborted).toBe(true);
	});

	it("doesn't time out a step that is merely slow", async () => {
		const pending = uploadImage(
			file,
			() =>
				new Promise<string>((resolve) =>
					setTimeout(() => resolve("u"), MINT_TIMEOUT_MS - 1),
				),
		);
		await vi.advanceTimersByTimeAsync(MINT_TIMEOUT_MS - 1);
		expect(await pending).toMatchObject({ ok: true, storageId: "s-1" });
	});
});

describe("uploadImage — every failure says whether Retry can help", () => {
	it("a file we refuse (HEIC) is NOT retryable and keeps its own sentence", async () => {
		prepareImageUpload.mockResolvedValue({
			ok: false,
			reason: "undecodable",
			message: '"photo.jpg" is in a format browsers can\'t show',
		});
		const mint = vi.fn(async () => "u");
		const result = await uploadImage(file, mint);
		expect(result).toMatchObject({
			ok: false,
			retryable: false,
			reason: { kind: "rejected", reject: "undecodable" },
			message: '"photo.jpg" is in a format browsers can\'t show',
		});
		expect(mint).not.toHaveBeenCalled();
	});

	it("a server refusal naming its own fix is NOT retryable and is shown verbatim", async () => {
		const result = await uploadImage(file, async () => {
			throw new ConvexError("Your store is view-only. Pay your invoice.");
		});
		expect(result).toMatchObject({
			ok: false,
			retryable: false,
			reason: { kind: "refused", rateLimited: false },
			message: "Your store is view-only. Pay your invoice.",
		});
	});

	it("the rate limiter's refusal IS retryable — it says when", async () => {
		const result = await uploadImage(file, async () => {
			throw new ConvexError({
				kind: "RateLimited",
				name: "productWrite",
				retryAfter: 30_000,
			});
		});
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "refused", rateLimited: true },
		});
		expect(result.ok === false && result.message).toMatch(/try again in/);
	});

	it("storage answering non-2xx is a retryable transport failure", async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => ({}),
		});
		const result = await uploadImage(file, async () => "u");
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "transport" },
		});
	});

	it("a 200 without a storage id is never trusted as one", async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: 1 }) });
		const result = await uploadImage(file, async () => "u");
		expect(result).toMatchObject({ ok: false, reason: { kind: "transport" } });
	});

	it("offline fails fast, before minting, without waiting out a deadline", async () => {
		vi.stubGlobal("navigator", { ...navigator, onLine: false });
		const mint = vi.fn(async () => "u");
		const result = await uploadImage(file, mint);
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			reason: { kind: "offline" },
		});
		expect(mint).not.toHaveBeenCalled();
	});
});

describe("prepareImage", () => {
	it("passes the prepared bytes through", async () => {
		expect(await prepareImage(file)).toMatchObject({ ok: true, blob });
	});
});
