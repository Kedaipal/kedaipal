import { describe, expect, it } from "vitest";
import type { ProductFormDraft } from "../components/forms/product-form";
import { draftFingerprint, isDraftDirty } from "./product-form-dirty";

const base: ProductFormDraft = {
	name: "Kuih lapis",
	description: "",
	hidden: false,
	kind: "physical",
	capacityPerNight: "1",
	categoryIds: [],
	images: [
		{ id: "s1", url: "https://cdn/s1" },
		{ id: "s2", url: "https://cdn/s2" },
	],
	editor: { options: [], rows: [], customLine: null },
	minQuantity: "",
	minNoticeDays: "",
	prepMinutes: "",
	pickupNote: "",
};

describe("isDraftDirty — the photo cases z8r3fdtk82 was filed for", () => {
	it("an untouched draft is clean", () => {
		expect(isDraftDirty(base, { ...base })).toBe(false);
	});

	it("adding a photo, and nothing else, is a change", () => {
		expect(
			isDraftDirty(base, {
				...base,
				images: [...base.images, { id: "s3", url: "blob:local" }],
			}),
		).toBe(true);
	});

	it("removing a photo is a change", () => {
		expect(
			isDraftDirty(base, { ...base, images: base.images.slice(0, 1) }),
		).toBe(true);
	});

	it("reordering photos is a change (the first one is the storefront cover)", () => {
		expect(
			isDraftDirty(base, { ...base, images: [...base.images].reverse() }),
		).toBe(true);
	});

	it("the same photo with a different preview URL is NOT a change", () => {
		// Just uploaded = blob: preview; reloaded = storage URL. Same stored id.
		expect(
			isDraftDirty(base, {
				...base,
				images: base.images.map((i) => ({ ...i, url: `blob:${i.id}` })),
			}),
		).toBe(false);
	});

	it("still sees an ordinary field change", () => {
		expect(isDraftDirty(base, { ...base, name: "Kuih lapis pandan" })).toBe(
			true,
		);
	});

	it("ignores variant-row preview URLs but not their stored image ids", () => {
		const row = {
			optionValues: ["S"],
			price: "5",
			stock: "1",
			sku: "",
			active: true,
			requiresProof: false,
			imageStorageIds: ["v1"],
			imageUrl: "https://cdn/v1",
		};
		const a = {
			...base,
			editor: { options: [], rows: [row], customLine: null },
		} as unknown as ProductFormDraft;
		const blobPreview = {
			...base,
			editor: {
				options: [],
				rows: [{ ...row, imageUrl: "blob:v1" }],
				customLine: null,
			},
		} as unknown as ProductFormDraft;
		const newPhoto = {
			...base,
			editor: {
				options: [],
				rows: [{ ...row, imageStorageIds: ["v2"] }],
				customLine: null,
			},
		} as unknown as ProductFormDraft;
		expect(draftFingerprint(a)).toBe(draftFingerprint(blobPreview));
		expect(isDraftDirty(a, newPhoto)).toBe(true);
	});
});
