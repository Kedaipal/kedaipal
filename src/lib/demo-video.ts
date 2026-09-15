/**
 * The landing demo clip, as data. Two cuts of ONE edit — the same five scenes
 * and the same soundtrack — framed for the two ways the section is actually
 * looked at:
 *
 * - `landscape` (16:9) for tablet and desktop, where the frame paints up to
 *   ~1000 CSS px wide (`max-w-5xl`).
 * - `portrait` (9:16) for phones. The old single 16:9 clip painted ~335×187 at
 *   375 px with a portrait phone centred in a mostly-empty canvas; a centre-crop
 *   was measured and rejected because the wide shots clipped (see
 *   `docs/landing-video-demo.md`). The fix was always a second cut of the
 *   source, not CSS — this is that cut, with its own captions above the phone.
 *
 * Both cuts carry the music bed, so the player owns a mute toggle; playback
 * still starts muted (autoplay policy) and the visitor opts in.
 *
 * `<source media="…">` inside `<video>` is not honoured by modern Chrome, so the
 * swap is done in JS off `PORTRAIT_MEDIA_QUERY` — `video-demo.tsx` reads it via
 * `useSyncExternalStore` and remounts the element on change.
 */

export type DemoVariant = "landscape" | "portrait";

export interface DemoVideoAssets {
	/** VP9 + Opus — first `<source>`, smallest. */
	webm: string;
	/** H.264 + AAC — Safari / fallback. */
	mp4: string;
	/** Frame 0 of this cut. Playback starts at 0, so any other frame would jump. */
	poster: string;
	width: number;
	height: number;
}

export const DEMO_VIDEO: Record<DemoVariant, DemoVideoAssets> = {
	landscape: {
		webm: "/video/kedaipal-demo.webm",
		mp4: "/video/kedaipal-demo.mp4",
		poster: "/img/landing/demo-poster.webp",
		width: 1280,
		height: 720,
	},
	portrait: {
		webm: "/video/kedaipal-demo-portrait.webm",
		mp4: "/video/kedaipal-demo-portrait.mp4",
		poster: "/img/landing/demo-poster-portrait.webp",
		width: 720,
		height: 1280,
	},
};

/**
 * Tailwind's `md` breakpoint is 768px; below it the landing is one column and
 * the phone-framed cut is the right one. Matches the CSS aspect switch on the
 * `<video>` (`aspect-[9/16] md:aspect-video`) so the box and the bytes agree.
 */
export const PORTRAIT_MEDIA_QUERY = "(max-width: 767px)";

export function demoVariantForViewport(portraitViewport: boolean): DemoVariant {
	return portraitViewport ? "portrait" : "landscape";
}

/**
 * Length of the landscape cut, for the `VideoObject` structured data on `/`.
 * ISO 8601 duration; whole seconds is what Google reads. 34.4 s: the master's
 * 0.5 s fade-in is trimmed so frame 0 (the poster) is the lit title card.
 */
export const DEMO_DURATION_ISO = "PT34S";
