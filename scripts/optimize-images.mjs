// Build-time image optimizer for landing-page assets.
//
// Reads source PNGs from `assets/landing/` and emits responsive AVIF + WebP
// variants into `public/img/landing/`. Transparency (alpha) is preserved.
//
// Usage: pnpm optimize:images
//
// To add a new asset: drop the source file in `assets/landing/`, add an entry
// to ASSETS below, and re-run. Widths larger than the source are skipped.

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(root, "assets/landing");
const OUT_DIR = path.join(root, "public/img/landing");

/** @type {{ src: string; name: string; widths: number[] }[]} */
const ASSETS = [
	// Product tiles inside the hero's phone mockup (phone-screen-mockup.tsx).
	// Higgsfield-generated (marketing_studio_image, 29 Aug 2026) in one
	// consistent set: cream ground, soft window light, mint linen accent —
	// the brand palette in photographic form. Sources stored at 640px (the
	// tiles render ~115 CSS px wide; 320w output covers ~2.8× DPR).
	{ src: "product-kek-batik.png", name: "product-kek-batik", widths: [320] },
	{ src: "product-sambal.png", name: "product-sambal", widths: [320] },
	{ src: "product-kuih-raya.png", name: "product-kuih-raya", widths: [320] },
	{ src: "product-pau.png", name: "product-pau", widths: [320] },
	{ src: "product-brownies.png", name: "product-brownies", widths: [320] },
	{ src: "product-ayam-percik.png", name: "product-ayam-percik", widths: [320] },
	// Seller-showcase cards (real-sellers.tsx) — same Higgsfield pipeline in
	// documentary style, mint accent carried through (stall cloth, wash
	// bucket, apron, box labels). Cards render ~300 CSS px wide → 640w ≈ 2×.
	{ src: "seller-lekor.png", name: "seller-lekor", widths: [640] },
	{ src: "seller-tentwash.png", name: "seller-tentwash", widths: [640] },
	{ src: "seller-cake.png", name: "seller-cake", widths: [640] },
	{ src: "seller-frozen.png", name: "seller-frozen", widths: [640] },
	{ src: "seller-fish.png", name: "seller-fish", widths: [640] },
	{ src: "seller-fitness.png", name: "seller-fitness", widths: [640] },
	{ src: "seller-fashion.png", name: "seller-fashion", widths: [640] },
	{ src: "seller-prints.png", name: "seller-prints", widths: [640] },
	{ src: "seller-dessert.png", name: "seller-dessert", widths: [640] },
	{ src: "seller-meat.png", name: "seller-meat", widths: [640] },
	{ src: "seller-campsite.png", name: "seller-campsite", widths: [640] },
	{ src: "seller-live.png", name: "seller-live", widths: [640] },
	// How-it-works step backdrops (how-it-works.tsx) — the CSS mockups float
	// over these in a layered collage. Same documentary/mint pipeline.
	{ src: "how-share.png", name: "how-share", widths: [640] },
	{ src: "how-browse.png", name: "how-browse", widths: [640] },
	{ src: "how-close.png", name: "how-close", widths: [640] },
	{ src: "how-run.png", name: "how-run", widths: [640] },
];

// AVIF: visually-lossless for UI mockups at this quality; effort trades CPU for size.
const AVIF_OPTIONS = { quality: 55, effort: 4 };
// WebP: fallback for the rare browser without AVIF support.
const WEBP_OPTIONS = { quality: 78 };

async function fileSizeKb(filePath) {
	const { size } = await stat(filePath);
	return Math.round(size / 1024);
}

async function generate(asset) {
	const input = path.join(SRC_DIR, asset.src);
	const meta = await sharp(input).metadata();
	const sourceWidth = meta.width ?? Number.POSITIVE_INFINITY;

	for (const width of asset.widths) {
		if (width > sourceWidth) {
			console.warn(
				`  ! skip ${asset.name}@${width}w (source is only ${sourceWidth}w)`,
			);
			continue;
		}

		const resized = sharp(input).resize({ width, withoutEnlargement: true });
		const avifPath = path.join(OUT_DIR, `${asset.name}-${width}.avif`);
		const webpPath = path.join(OUT_DIR, `${asset.name}-${width}.webp`);

		await resized.clone().avif(AVIF_OPTIONS).toFile(avifPath);
		await resized.clone().webp(WEBP_OPTIONS).toFile(webpPath);

		console.log(
			`  ✓ ${asset.name}@${width}w  avif ${await fileSizeKb(avifPath)}KB  webp ${await fileSizeKb(webpPath)}KB`,
		);
	}
}

async function run() {
	await mkdir(OUT_DIR, { recursive: true });
	console.log(`Optimizing ${ASSETS.length} asset(s) -> ${path.relative(root, OUT_DIR)}/`);
	for (const asset of ASSETS) {
		console.log(`\n${asset.src}:`);
		await generate(asset);
	}
	console.log("\nDone.");
}

run().catch((error) => {
	console.error("Image optimization failed:", error);
	process.exit(1);
});
