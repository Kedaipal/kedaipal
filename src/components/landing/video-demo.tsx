import { useReducedMotion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * The 30-second product demo, in the Mobbin slot: directly under the hero,
 * before any other section (29 Aug, owner ask — mobbin.com/mcp as the
 * reference). The page previously carried NO video at all; the product was
 * only ever shown as stylised CSS mockups, so a visitor never saw the real
 * app until they signed up. The clip walks the exact arc the page argues in
 * prose — buried chat → store link → storefront → cart → confirmation back in
 * WhatsApp → the orders dashboard — which is why it earns the slot ahead of
 * `RealSellers` and `ProblemStrip`: it IS the pitch, moving.
 *
 * The source has **no audio track** (silent, burned-in captions), so there is
 * deliberately no mute control — we don't render a control for a thing that
 * doesn't exist. The burned-in captions are English-only in every locale;
 * localised captions need a re-render of the source, so `demo_video_transcript`
 * carries the caption text for screen readers and translates with the page.
 *
 * Loading posture (the reason `preload="none"` is load-bearing): the poster is
 * an 8.7 KB WebP and the video is ~928 KB (WebM) / ~1.2 MB (MP4), so nothing
 * beyond the poster is fetched until the section actually enters the viewport
 * and playback starts. A visitor who bounces at the hero pays 8.7 KB.
 */

/**
 * The corner play/pause toggle. Dark translucent rather than a theme token:
 * it sits ON the video, whose own frames run from near-white (storefront) to
 * navy (title cards), so it needs contrast against both.
 */
const OVERLAY_BTN =
	"tap-target inline-flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40";

export function VideoDemo() {
	const shouldReduceMotion = useReducedMotion();
	const videoRef = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [progress, setProgress] = useState(0);
	/**
	 * True once the visitor has pressed pause themselves. Scrolling the section
	 * back into view must NOT override that — an autoplay that resurrects itself
	 * after an explicit pause is the single most annoying thing a hero video can
	 * do. Pressing play again clears it.
	 */
	const userPausedRef = useRef(false);
	/**
	 * Autoplay was refused (iOS Low Power Mode and some data-saver modes block
	 * even muted autoplay) or reduced motion is on. Either way the visitor gets
	 * an explicit, centred play button over the poster rather than a dead frame.
	 */
	const [needsGesture, setNeedsGesture] = useState(true);

	const toggle = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) {
			userPausedRef.current = false;
			void video.play().catch(() => setNeedsGesture(true));
		} else {
			userPausedRef.current = true;
			video.pause();
		}
	}, []);

	// Autoplay on entry, pause on exit. Reduced motion opts out of the autoplay
	// half entirely — the play button stays, so the demo is never unreachable.
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (shouldReduceMotion) return;

		const observer = new IntersectionObserver(
			(entries) => {
				// The LAST entry, never `entries[0]`. A fast scroll delivers several
				// crossings in one batch, and reading the first one made a batched
				// [exit, enter] land as "exit" — the demo then sat paused mid-clip
				// while fully on screen (caught in verification, 29 Aug).
				const entry = entries[entries.length - 1];
				if (entry?.isIntersecting) {
					if (userPausedRef.current) return;
					void video
						.play()
						.then(() => setNeedsGesture(false))
						.catch(() => setNeedsGesture(true));
				} else if (!video.paused) {
					video.pause();
				}
			},
			{ threshold: 0.25 },
		);
		observer.observe(video);
		return () => observer.disconnect();
	}, [shouldReduceMotion]);

	const onTimeUpdate = useCallback(() => {
		const video = videoRef.current;
		if (!video?.duration) return;
		setProgress(video.currentTime / video.duration);
	}, []);

	return (
		<section id="demo" aria-labelledby="demo-heading" className="bg-background">
			<div className="mx-auto max-w-5xl px-5 py-16 md:px-8 md:py-24">
				<FadeIn className="flex flex-col items-center gap-4 text-center">
					<Eyebrow>{m.demo_video_eyebrow()}</Eyebrow>
					<h2
						id="demo-heading"
						className="max-w-2xl text-3xl font-bold leading-[1.1] md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.demo_video_heading()}
					</h2>
					<p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
						{m.demo_video_sub()}
					</p>
				</FadeIn>

				<FadeIn delay={0.12}>
					<figure className="m-0 mt-10 md:mt-14">
						<div className="relative overflow-hidden rounded-2xl border border-border/70 bg-primary shadow-2xl shadow-primary/20 md:rounded-3xl">
							{/* `aspect-video` + `w-full` reserve the box before a single
							    byte of video arrives, so the section never shifts. */}
							<video
								ref={videoRef}
								className="block aspect-video w-full cursor-pointer object-cover"
								poster="/img/landing/demo-poster.webp"
								preload="none"
								muted
								playsInline
								// A looping clip is continuous motion; reduced motion gets a
								// single play that ends on the closing card.
								loop={!shouldReduceMotion}
								aria-label={m.demo_video_label()}
								onClick={toggle}
								onPlay={() => {
									setPlaying(true);
									setNeedsGesture(false);
								}}
								onPause={() => setPlaying(false)}
								onEnded={() => setProgress(1)}
								onTimeUpdate={onTimeUpdate}
							>
								{/* VP9 first — 928 KB vs 1.2 MB for the H.264 fallback on
								    this content. Both are re-encodes of the 21.5 MB master
								    in 10_Assets; see docs/landing-video-demo.md. */}
								<source src="/video/kedaipal-demo.webm" type="video/webm" />
								<source src="/video/kedaipal-demo.mp4" type="video/mp4" />
							</video>

							{/* The captions are burned into the pixels, so this is the only
							    machine-readable copy of what the demo says. */}
							<p className="sr-only">{m.demo_video_transcript()}</p>

							{/* Autoplay refused, or reduced motion — one unmissable target. */}
							{needsGesture && !playing ? (
								<button
									type="button"
									onClick={toggle}
									aria-label={m.demo_video_play()}
									className="absolute inset-0 flex items-center justify-center bg-primary/25 transition-colors hover:bg-primary/35"
								>
									<span className="inline-flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl transition-transform hover:scale-105 motion-reduce:hover:scale-100">
										<Play className="size-6 translate-x-0.5 fill-current" />
									</span>
								</button>
							) : null}

							{/* Always-visible toggle — a control the visitor has to hover to
							    discover is a hidden control (CLAUDE.md § discoverability). */}
							{!needsGesture || playing ? (
								<button
									type="button"
									onClick={toggle}
									aria-label={
										playing ? m.demo_video_pause() : m.demo_video_play()
									}
									className={cn(OVERLAY_BTN, "absolute bottom-4 right-4")}
								>
									{playing ? (
										<Pause className="size-4 fill-current" />
									) : (
										<Play className="size-4 translate-x-px fill-current" />
									)}
								</button>
							) : null}

							<div
								aria-hidden
								className="absolute inset-x-0 bottom-0 h-1 bg-white/15"
							>
								<div
									className="h-full bg-accent"
									style={{ width: `${Math.min(progress, 1) * 100}%` }}
								/>
							</div>
						</div>

						<figcaption className="mt-4 text-center text-sm text-muted-foreground">
							{m.demo_video_caption()}
						</figcaption>
					</figure>
				</FadeIn>
			</div>
		</section>
	);
}
