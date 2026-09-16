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
 *
 * The size and duration checks read the shipped files' own headers — a table
 * compared against itself would stay green through a re-export at any size
 * (review, PR #274). The WebM renditions are re-encodes of the same command
 * and get the existence check only; the MP4 is what the `VideoObject` points
 * at and what Safari plays, so it is the one measured.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

interface Pixels {
	width: number;
	height: number;
}

/** Canvas size from a WebP's RIFF header — the simple (`VP8 `), lossless
 *  (`VP8L`) and extended (`VP8X`) layouts, which is every form libwebp writes. */
function webpPixels(buf: Buffer): Pixels {
	expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
	expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
	const chunk = buf.toString("ascii", 12, 16);
	if (chunk === "VP8 ") {
		// 3-byte frame tag + 3-byte start code, then 14-bit width and height.
		return {
			width: buf.readUInt16LE(26) & 0x3fff,
			height: buf.readUInt16LE(28) & 0x3fff,
		};
	}
	if (chunk === "VP8L") {
		const bits = buf.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") {
		return {
			width: buf.readUIntLE(24, 3) + 1,
			height: buf.readUIntLE(27, 3) + 1,
		};
	}
	throw new Error(`unrecognised WebP chunk "${chunk}"`);
}

interface Mp4Box {
	type: string;
	/** First byte of the box body. */
	body: number;
	/** One past the last byte of the box. */
	end: number;
}

function* mp4Boxes(buf: Buffer, start: number, end: number): Generator<Mp4Box> {
	let at = start;
	while (at + 8 <= end) {
		let size = buf.readUInt32BE(at);
		let header = 8;
		if (size === 1) {
			size = Number(buf.readBigUInt64BE(at + 8));
			header = 16;
		} else if (size === 0) {
			size = end - at;
		}
		yield {
			type: buf.toString("ascii", at + 4, at + 8),
			body: at + header,
			end: at + size,
		};
		at += size;
	}
}

function mp4Box(buf: Buffer, start: number, end: number, type: string): Mp4Box {
	for (const box of mp4Boxes(buf, start, end))
		if (box.type === type) return box;
	throw new Error(`no "${type}" box in [${start}, ${end})`);
}

/**
 * Duration from `moov/mvhd` and the video track's size from its `moov/trak/tkhd`
 * (16.16 fixed point; the audio track's reads 0×0). Both boxes exist in
 * versions 0 and 1, which differ only in 64-bit timestamps ahead of the fields
 * read here.
 */
function mp4Info(buf: Buffer): Pixels & { seconds: number } {
	const moov = mp4Box(buf, 0, buf.length, "moov");
	const mvhd = mp4Box(buf, moov.body, moov.end, "mvhd");
	const v1 = buf[mvhd.body] === 1;
	const timescale = buf.readUInt32BE(mvhd.body + (v1 ? 20 : 12));
	const duration = v1
		? Number(buf.readBigUInt64BE(mvhd.body + 24))
		: buf.readUInt32BE(mvhd.body + 16);
	for (const trak of mp4Boxes(buf, moov.body, moov.end)) {
		if (trak.type !== "trak") continue;
		const tkhd = mp4Box(buf, trak.body, trak.end, "tkhd");
		const at = tkhd.body + (buf[tkhd.body] === 1 ? 88 : 76);
		const width = buf.readUInt32BE(at) / 0x10000;
		const height = buf.readUInt32BE(at + 4) / 0x10000;
		if (width > 0 && height > 0)
			return { width, height, seconds: duration / timescale };
	}
	throw new Error("no video track with a size");
}

function readPublic(path: string): Buffer {
	return readFileSync(join(PUBLIC_DIR, path));
}

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

	it("declares the pixel size each poster actually is", () => {
		for (const [variant, assets] of Object.entries(DEMO_VIDEO)) {
			expect(
				webpPixels(readPublic(assets.poster)),
				`${variant} poster`,
			).toEqual({
				width: assets.width,
				height: assets.height,
			});
		}
	});

	it("declares the pixel size each MP4 actually is", () => {
		for (const [variant, assets] of Object.entries(DEMO_VIDEO)) {
			const { width, height } = mp4Info(readPublic(assets.mp4));
			expect({ width, height }, `${variant} mp4`).toEqual({
				width: assets.width,
				height: assets.height,
			});
		}
	});

	it("keeps each cut's poster and video on the same aspect", () => {
		// The `<video>` box is CSS-driven (`aspect-video`, `max-md:portrait:
		// aspect-[9/16]`); a cut whose intrinsic ratio disagreed with its slot
		// would letterbox. The sizes are checked against the files above.
		expect(
			DEMO_VIDEO.landscape.width / DEMO_VIDEO.landscape.height,
		).toBeCloseTo(16 / 9, 2);
		expect(DEMO_VIDEO.portrait.width / DEMO_VIDEO.portrait.height).toBeCloseTo(
			9 / 16,
			2,
		);
	});

	it("serves the portrait cut only to a phone held upright", () => {
		// Width alone would hand a sideways phone (667×375) a 9:16 box ~1.8×
		// taller than its screen; orientation is part of the rule, and the CSS
		// (`max-md:portrait:`) says the same thing.
		expect(PORTRAIT_MEDIA_QUERY).toBe(
			"(max-width: 767px) and (orientation: portrait)",
		);
		expect(demoVariantForViewport(true)).toBe("portrait");
		expect(demoVariantForViewport(false)).toBe("landscape");
	});

	it("declares the landscape MP4's real length, in whole seconds", () => {
		// Google reads whole seconds; the file is the source of truth, so a
		// re-export at a new length fails here instead of in a crawler.
		const { seconds } = mp4Info(readPublic(DEMO_VIDEO.landscape.mp4));
		expect(DEMO_DURATION_ISO).toBe(`PT${Math.round(seconds)}S`);
	});
});

describe("landing demo copy", () => {
	it("carries every burned-in caption beat in the English transcript", () => {
		const transcript = readCatalog("en").demo_video_transcript ?? "";
		const dropped = CAPTION_BEATS.filter((beat) => !transcript.includes(beat));
		expect(
			dropped,
			`missing from demo_video_transcript:\n${dropped.join("\n")}`,
		).toEqual([]);
	});

	it("names the mute control in every locale", () => {
		// The clip now has a soundtrack; a control the screen reader can't name
		// is a hidden control (CLAUDE.md § discoverability).
		for (const locale of ["en", "ms", "zh"]) {
			const catalog = readCatalog(locale);
			expect(catalog.demo_video_mute, `${locale} demo_video_mute`).toBeTruthy();
			expect(
				catalog.demo_video_unmute,
				`${locale} demo_video_unmute`,
			).toBeTruthy();
			expect(catalog.demo_video_mute).not.toBe(catalog.demo_video_unmute);
		}
	});

	it("no longer calls the clip silent or thirty seconds long", () => {
		// Both were true of the previous cut and are exactly the kind of copy
		// that survives a re-record unnoticed.
		const catalog = readCatalog("en");
		for (const key of Object.keys(catalog).filter((k) =>
			k.startsWith("demo_video_"),
		)) {
			expect(catalog[key], key).not.toMatch(
				/\bsilent\b|30-second|No sound needed/i,
			);
		}
	});
});
