// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the order-owned-image rule (ClickUp 86eypxght).
 *
 * The resize proxy re-serves images as `public, max-age=1y, immutable` on
 * Cloudflare's edge. That is correct for catalog photos and wrong for the blobs
 * `convex/lib/orderBlobs.ts` calls order-owned — the buyer's reference photo,
 * their payment-proof screenshot, the seller's mockup(s) — plus delivery POD
 * photos, which show a buyer's doorstep.
 *
 * Those have an explicit erase contract: the admin hard delete and the
 * account-deletion cascade both free them, and both are documented as
 * PERMANENT. A public edge copy would outlive that delete by up to a year,
 * still fetchable by anyone holding the URL — silently breaking a promise
 * already shipped. So they render with `sensitive`, which keeps them on their
 * original Convex URL (and its `private` caching).
 *
 * A prop is easy to forget on a NEW render of the same image, and prose in a
 * doc does not fail a build. This pins it: any AppImage/ZoomableImage whose
 * `alt` identifies one of those images must carry the flag.
 *
 * Matching on `alt` rather than the src expression is deliberate — the src is
 * usually a loop variable (`url`) that carries no meaning, while the alt text
 * is exactly the human description of what the image IS, which is the thing
 * the rule is actually about.
 */

const SRC_DIR = join(import.meta.dirname, "..");

/**
 * Alt text that identifies an order-owned image. Substring match, so
 * `alt={`Your mockup ${i + 1}`}` is caught alongside the plain string form.
 */
const ORDER_OWNED_ALT = [
	"Proof of delivery",
	"Payment receipt",
	"Customer reference photo",
	"Your mockup",
	"Current mockup",
];

function tsxFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "paraglide") continue;
			out.push(...tsxFiles(full));
		} else if (
			entry.name.endsWith(".tsx") &&
			!entry.name.endsWith(".test.tsx")
		) {
			out.push(full);
		}
	}
	return out;
}

/** Every self-closing <AppImage …/> or <ZoomableImage …/> element in a file. */
function imageElements(source: string): string[] {
	return source.match(/<(?:AppImage|ZoomableImage)\b[\s\S]*?\/>/g) ?? [];
}

describe("order-owned images are never served through the resize proxy", () => {
	test("every render of one carries `sensitive`", () => {
		const offenders: string[] = [];
		let checked = 0;

		for (const file of tsxFiles(SRC_DIR)) {
			const source = readFileSync(file, "utf8");
			for (const el of imageElements(source)) {
				const alt = ORDER_OWNED_ALT.find((a) => el.includes(a));
				if (!alt) continue;
				checked++;
				if (!/\bsensitive\b/.test(el)) {
					offenders.push(`${relative(SRC_DIR, file)} — "${alt}"`);
				}
			}
		}

		// If this drops to 0 the matcher has silently stopped finding anything
		// (an alt was reworded, the elements stopped being self-closing) and the
		// test would pass while enforcing nothing.
		expect(checked).toBeGreaterThanOrEqual(6);
		expect(offenders).toEqual([]);
	});
});
