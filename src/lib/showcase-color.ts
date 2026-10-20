/**
 * The `custom` showcase look (z8r3fdr6mv): the admin picks a colour on a
 * wheel, and this turns it into the theme's variables.
 *
 * The admin picks the HUE; we pick the SHADE. Every showcase look is a dark
 * ground under white text and an accent-coloured "See all", so the wheel can
 * never be allowed to choose lightness: a raw pale yellow would put the title
 * on a ground it can't be read on. In OKLCH, lightness is perceptual, so
 * pinning `L` pins contrast whatever the hue — a yellow and a blue at the
 * same `L` read equally dark, which HSL can't promise. Chroma is capped too,
 * so a neon pick lands as a rich colour rather than a vibrating one.
 *
 * Pure, so the shade rules are unit-tested; no dependency — the sRGB → OKLab
 * matrices are Björn Ottosson's published ones.
 */

export type Oklch = { l: number; c: number; h: number };

export function hexToOklch(hex: string): Oklch {
	const n = Number.parseInt(hex.slice(1), 16);
	const toLinear = (v: number) => {
		const x = v / 255;
		return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	const r = toLinear((n >> 16) & 255);
	const g = toLinear((n >> 8) & 255);
	const b = toLinear(n & 255);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const c = Math.sqrt(A * A + B * B);
	const h = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c, h: h < 0 ? h + 360 : h };
}

function oklch(l: number, c: number, h: number): string {
	return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/** The pinned shades: the ground's two stops sit where every curated theme
 * sits (≈ 20–35% lightness), the accent where their accents sit. */
export const CUSTOM_SHADES = {
	groundA: { l: 0.24, cMax: 0.08 },
	groundB: { l: 0.36, cMax: 0.13 },
	accent: { l: 0.86, cMax: 0.15 },
	accentFg: { l: 0.24, cMax: 0.08 },
} as const;

/**
 * The CSS variables for a custom colour — set inline on the element that
 * carries the `kp-showcase kp-showcase-custom` class. A near-grey pick has
 * almost no chroma, so its palette comes out neutral: that is the honest
 * reading of a grey, not a bug.
 */
export function customShowcasePalette(hex: string): Record<string, string> {
	const { c, h } = hexToOklch(hex);
	const shade = (s: { l: number; cMax: number }) =>
		oklch(s.l, Math.min(c, s.cMax), h);
	return {
		"--sc-a": shade(CUSTOM_SHADES.groundA),
		"--sc-b": shade(CUSTOM_SHADES.groundB),
		"--sc-accent": shade(CUSTOM_SHADES.accent),
		"--sc-accent-fg": shade(CUSTOM_SHADES.accentFg),
	};
}

/** `#abc` / `ABCDEF` / `#AbCdEf` → `#aabbcc`; anything else → undefined. The
 * hex box accepts the short form while typing; the server takes only six. */
export function normalizeHex(input: string): string | undefined {
	const raw = input.trim().replace(/^#/, "").toLowerCase();
	if (/^[0-9a-f]{3}$/.test(raw))
		return `#${raw
			.split("")
			.map((ch) => ch + ch)
			.join("")}`;
	return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : undefined;
}
