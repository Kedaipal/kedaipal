// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The live flash-sale card heartbeat (`kp-flash-glow`, z8r3fdudm2) has two
 * properties a later keyframe tweak can break without anything else noticing,
 * because jsdom never runs a CSS animation:
 *
 * 1. OUTWARD ONLY. The halo's spread never shrinks inside a cycle. A
 *    there-and-back keyframe (0 → 10px → 0) reads as the ring being sucked
 *    back into the card.
 * 2. THE RING SURVIVES. An animation owns the whole `box-shadow`, and
 *    Tailwind's `ring-2` IS a box-shadow, so every keyframe has to repaint the
 *    2px ring itself or the card loses it for as long as the sale runs.
 *
 * Plus the seam: the halo is fully transparent at both ends, so the loop
 * restart can't be seen.
 */

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");

type Layer = { spread: number; alpha: number };
type Frame = { at: number; ring: Layer; halo: Layer };

function glowFrames(): Frame[] {
	const block = css.match(/@keyframes kp-flash-glow \{([\s\S]*?)\n\}/);
	if (!block) throw new Error("kp-flash-glow keyframes not found");
	const frames: Frame[] = [];
	for (const m of block[1].matchAll(/([\d%,\s]+)\{([^}]*)\}/g)) {
		const layers = [
			...m[2].matchAll(
				/0 0 0 (\d+(?:\.\d+)?)px color-mix\(in oklab, var\(--accent\) (\d+)%, transparent\)/g,
			),
		].map(([, spread, alpha]) => ({
			spread: Number(spread),
			alpha: Number(alpha),
		}));
		expect(layers, `frame "${m[1].trim()}" paints ring + halo`).toHaveLength(2);
		for (const at of m[1].split(",")) {
			frames.push({
				at: Number.parseFloat(at),
				ring: layers[0],
				halo: layers[1],
			});
		}
	}
	return frames.sort((a, b) => a.at - b.at);
}

describe("kp-flash-glow keyframes", () => {
	const frames = glowFrames();

	test("cover the whole cycle", () => {
		expect(frames[0].at).toBe(0);
		expect(frames.at(-1)?.at).toBe(100);
	});

	test("the halo only ever travels outward", () => {
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].halo.spread).toBeGreaterThanOrEqual(
				frames[i - 1].halo.spread,
			);
		}
	});

	test("every frame repaints the ring-2 ring-accent/35 the element carries", () => {
		for (const f of frames) {
			expect(f.ring).toEqual({ spread: 2, alpha: 35 });
		}
	});

	test("the halo is invisible at both ends, so the restart has no seam", () => {
		expect(frames[0].halo.alpha).toBe(0);
		expect(frames.at(-1)?.halo.alpha).toBe(0);
	});
});
