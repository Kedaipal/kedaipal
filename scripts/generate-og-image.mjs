// Generates the social-share OG image (1200×630) at public/og-image.png.
//
// Usage: node scripts/generate-og-image.mjs
//
// Composites the dark-background brand lockup (logo-dark.svg) over a navy +
// mint-glow canvas with the hero headline. Re-run after changing the
// headline or brand assets.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public/og-image.png");

const WIDTH = 1200;
const HEIGHT = 630;

const background = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="115%" r="95%">
      <stop offset="0%" stop-color="#10B981" stop-opacity="0.38"/>
      <stop offset="55%" stop-color="#10B981" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#10B981" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0F172A"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <circle cx="1050" cy="80" r="260" fill="none" stroke="#FFFFFF" stroke-opacity="0.05" stroke-width="2"/>
  <circle cx="1050" cy="80" r="180" fill="none" stroke="#FFFFFF" stroke-opacity="0.07" stroke-width="2"/>
  <text x="80" y="330" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="bold" fill="#FFFFFF" letter-spacing="-2">Stop losing orders</text>
  <text x="80" y="420" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="bold" fill="#34D399" letter-spacing="-2">buried in WhatsApp chat.</text>
  <text x="80" y="500" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#94A3B8">Storefront + order pipeline for sellers on WhatsApp</text>
  <text x="80" y="566" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF">kedaipal.com</text>
</svg>`;

async function run() {
	const logoSvg = await readFile(path.join(root, "public/logo-dark.svg"));
	// Wordmark is ~359×77 — render at 300px wide for the dark canvas.
	const logo = await sharp(logoSvg).resize({ width: 300 }).png().toBuffer();

	const png = await sharp(Buffer.from(background))
		.composite([{ input: logo, left: 80, top: 100 }])
		.png({ compressionLevel: 9 })
		.toBuffer();

	await writeFile(OUT, png);
	console.log(`✓ ${path.relative(root, OUT)} (${Math.round(png.length / 1024)}KB)`);
}

run().catch((error) => {
	console.error("OG image generation failed:", error);
	process.exit(1);
});
