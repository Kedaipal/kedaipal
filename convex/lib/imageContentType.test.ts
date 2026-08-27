import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	isRenderableImageType,
	isStoredImageRenderable,
	RENDERABLE_IMAGE_TYPES,
	UNRENDERABLE_PROOF_MESSAGE,
} from "./imageContentType";

/** Minimal stand-in for the slice of ctx the check reads. */
function ctxWith(meta: { contentType?: string } | null) {
	return { db: { system: { get: async () => meta } } };
}
const ID = "kg2fake" as Id<"_storage">;

describe("isRenderableImageType", () => {
	it.each(RENDERABLE_IMAGE_TYPES)("accepts %s", (t) => {
		expect(isRenderableImageType(t)).toBe(true);
	});

	it("rejects HEIC — the format that started this", () => {
		expect(isRenderableImageType("image/heic")).toBe(false);
		expect(isRenderableImageType("image/heif")).toBe(false);
	});

	it("rejects non-images that merely got uploaded through an image field", () => {
		expect(isRenderableImageType("application/pdf")).toBe(false);
		expect(isRenderableImageType("text/html")).toBe(false);
	});

	it("treats a missing content type as unrenderable", () => {
		expect(isRenderableImageType(undefined)).toBe(false);
		expect(isRenderableImageType(null)).toBe(false);
		expect(isRenderableImageType("")).toBe(false);
	});

	it("ignores charset parameters and casing, which browsers send freely", () => {
		expect(isRenderableImageType("image/png; charset=binary")).toBe(true);
		expect(isRenderableImageType("IMAGE/JPEG")).toBe(true);
		expect(isRenderableImageType(" image/webp ")).toBe(true);
	});

	it("does not match on a prefix — image/heic must not pass because image/h... is close", () => {
		expect(isRenderableImageType("image/jpeg-xl")).toBe(false);
		expect(isRenderableImageType("image/pngx")).toBe(false);
	});
});

describe("UNRENDERABLE_PROOF_MESSAGE", () => {
	it("names HEIC and a concrete alternative, since a buyer sees this mid-payment", () => {
		expect(UNRENDERABLE_PROOF_MESSAGE).toContain(".HEIC");
		expect(UNRENDERABLE_PROOF_MESSAGE).toMatch(/JPEG|PNG/);
	});
});

describe("isStoredImageRenderable", () => {
	it("refuses a stored HEIC — the case this whole ticket exists for", async () => {
		expect(await isStoredImageRenderable(ctxWith({ contentType: "image/heic" }), ID)).toBe(
			false,
		);
	});

	it("allows a normal stored image", async () => {
		expect(await isStoredImageRenderable(ctxWith({ contentType: "image/jpeg" }), ID)).toBe(
			true,
		);
	});

	it("FAILS OPEN when the content type is unknown", async () => {
		// Asymmetric costs: wrongly blocking this stops a real payment from
		// being recorded, while wrongly allowing it shows a broken image — the
		// status quo, not a regression. So an unknown type must pass.
		expect(await isStoredImageRenderable(ctxWith({}), ID)).toBe(true);
		expect(await isStoredImageRenderable(ctxWith({ contentType: "" }), ID)).toBe(true);
	});

	it("fails open when the id is malformed and the lookup THROWS", async () => {
		// `proofStorageId` is `v.string()`, so a crafted direct call can pass any
		// string, and `db.system.get` throws on a malformed one rather than
		// returning null. The fail-open promise has to cover that too — an
		// abuser getting a raw internal error instead of the buyer-facing
		// message helps nobody.
		const throwing = {
			db: {
				system: {
					get: async () => {
						throw new Error("Invalid storage ID");
					},
				},
			},
		};
		expect(await isStoredImageRenderable(throwing, ID)).toBe(true);
	});

	it("fails open on a missing storage row too", async () => {
		expect(await isStoredImageRenderable(ctxWith(null), ID)).toBe(true);
	});
});
