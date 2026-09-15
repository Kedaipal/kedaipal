import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEMO_DURATION_ISO,
	DEMO_VIDEO,
	demoVariantForViewport,
	PORTRAIT_MEDIA_QUERY,
} from "./demo-video";

/**
 * Guards the landing demo's asset table. The failure modes it exists for are
 * all silent in the browser: a `<source>` that 404s just falls through to the
 * poster, a stale transcript reads fine to a sighted reviewer, and a cut whose
 * duration drifted from the structured data is only ever caught by a crawler.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

/**
 * The caption beats burned into the pixels, in order. `demo_video_transcript`
 * is the only machine-readable copy of them, so it must carry every one — a
 * transcript describing a clip that no longer exists is worse than none
 * (`docs/landing-video-demo.md`).
 */
const CAPTION_BEATS = [
	"One link. Every order, out of the chat.",
	"Custom orders lost in 40 messages?",
	"Sizes, flavours, lead time — picked, not asked.",
	"Sold out but still taking orders?",
	"Live stock. It stops when you're out.",
	"“Mine!” in the comments, then chaos?",
	"One link in the live. Orders, not screenshots.",
	"Booking by back-and-forth?",
	"Pick a slot. Confirmed.",
	"Which colour, which size, which one?",
	"Variants sorted. Order lands in WhatsApp.",
	"One link. Every order, in Kedaipal.",
];

function readCatalog(locale: string): Record<string, string> {
	return JSON.parse(
		readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
	) as Record<string, string>;
}

describe("landing demo video assets", () => {
	it("ships every referenced file for both cuts", () => {
		const missing: string[] = [];
		for (const [variant, assets] of Object.entries(DEMO_VIDEO)) {
			for (const key of ["webm", "mp4", "poster"] as const) {
				if (!existsSync(join(PUBLIC_DIR, assets[key])))
					missing.push(`${variant}.${key}: ${assets[key]}`);
			}
		}
		expect(missing, missing.join("\n")).toEqual([]);
	});

	it("keeps each cut's poster and video on the same aspect", () => {
		// The `<video>` box is CSS-driven (`aspect-[9/16] md:aspect-video`); a
		// cut whose intrinsic ratio disagreed with its slot would letterbox.
		expect(DEMO_VIDEO.landscape.width / DEMO_VIDEO.landscape.height).toBeCloseTo(
			16 / 9,
			2,
		);
		expect(DEMO_VIDEO.portrait.width / DEMO_VIDEO.portrait.height).toBeCloseTo(
			9 / 16,
			2,
		);
	});

	it("serves the portrait cut below Tailwind's md breakpoint", () => {
		expect(PORTRAIT_MEDIA_QUERY).toBe("(max-width: 767px)");
		expect(demoVariantForViewport(true)).toBe("portrait");
		expect(demoVariantForViewport(false)).toBe("landscape");
	});

	it("declares a whole-second ISO duration for the structured data", () => {
		expect(DEMO_DURATION_ISO).toMatch(/^PT\d+S$/);
	});
});

describe("landing demo copy", () => {
	it("carries every burned-in caption beat in the English transcript", () => {
		const transcript = readCatalog("en").demo_video_transcript ?? "";
		const dropped = CAPTION_BEATS.filter((beat) => !transcript.includes(beat));
		expect(dropped, `missing from demo_video_transcript:\n${dropped.join("\n")}`).toEqual(
			[],
		);
	});

	it("names the mute control in every locale", () => {
		// The clip now has a soundtrack; a control the screen reader can't name
		// is a hidden control (CLAUDE.md § discoverability).
		for (const locale of ["en", "ms", "zh"]) {
			const catalog = readCatalog(locale);
			expect(catalog.demo_video_mute, `${locale} demo_video_mute`).toBeTruthy();
			expect(catalog.demo_video_unmute, `${locale} demo_video_unmute`).toBeTruthy();
			expect(catalog.demo_video_mute).not.toBe(catalog.demo_video_unmute);
		}
	});

	it("no longer calls the clip silent or thirty seconds long", () => {
		// Both were true of the previous cut and are exactly the kind of copy
		// that survives a re-record unnoticed.
		const catalog = readCatalog("en");
		for (const key of Object.keys(catalog).filter((k) => k.startsWith("demo_video_"))) {
			expect(catalog[key], key).not.toMatch(/\bsilent\b|30-second|No sound needed/i);
		}
	});
});
