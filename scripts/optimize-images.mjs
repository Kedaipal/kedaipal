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
	{ src: "whatsapp.png", name: "whatsapp", widths: [280, 560, 840] },
	{ src: "storefront.png", name: "storefront", widths: [280, 560, 840] },
	{ src: "how-step-1.jpeg", name: "how-step-1", widths: [400, 800] },
	{ src: "how-step-2.png", name: "how-step-2", widths: [400, 800] },
	{ src: "how-step-3.png", name: "how-step-3", widths: [400, 800] },
	{ src: "how-step-4.png", name: "how-step-4", widths: [400, 800] },
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
