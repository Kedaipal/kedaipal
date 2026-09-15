import { useReducedMotion } from "framer-motion";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	DEMO_VIDEO,
	type DemoVariant,
	demoVariantForViewport,
	PORTRAIT_MEDIA_QUERY,
} from "../../lib/demo-video";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * The 35-second product demo, in the Mobbin slot: directly under the hero,
 * before any other section (29 Aug, owner ask — mobbin.com/mcp as the
 * reference). Five kinds of sellers — a custom cake, frozen food, a live sale,
 * a booking, an apparel order — each taking an order through one storefront
 * link instead of a WhatsApp back-and-forth, bookended by "One link. Every
 * order." title cards. It IS the pitch, moving, which is why it sits ahead of
 * every prose section.
 *
 * Two cuts of the one edit (13 Sep): a phone-framed 9:16 for a phone held
 * upright and a 16:9 for everything else — md+, and a phone turned sideways,
 * where a 9:16 box would be taller than the screen — chosen off
 * `PORTRAIT_MEDIA_QUERY` and swapped by remounting the `<video>` (a `<source>`
 * list can't change in place, and `<source media>` isn't honoured). The
 * player's per-element state (playing, progress, autoplay verdict) is reset
 * with it; the visitor's own choices (sound on, an explicit pause) survive.
 * Before hydration the variant is unknown, so the element renders with no
 * poster and no sources inside the same navy box — the box's aspect is pure
 * CSS, so nothing shifts when the right cut arrives. That costs the poster a
 * few hundred ms after hydration and buys zero CLS and no landscape-poster
 * flash on a phone; the section is below the fold, so it is never the LCP
 * element.
 *
 * The clip carries a music bed (no speech — the captions are burned in), so
 * there IS a mute control now. Playback still starts muted: that is what
 * autoplay policy allows, and a landing page that starts making noise is the
 * one thing worse than one that autoplays. The visitor opts in with one tap.
 * The captions are English in every locale; `demo_video_transcript` is the
 * machine-readable copy and translates with the page.
 *
 * Loading posture (the reason `preload="none"` is load-bearing): the poster is
 * a 17 KB (16:9) or 22 KB (9:16) WebP and nothing beyond it is fetched until
 * the section enters the viewport and playback starts. A visitor who bounces
 * at the hero pays one poster.
 */

/**
 * The corner controls. Dark translucent rather than a theme token: they sit ON
 * the video, whose frames run from near-white (storefront) to navy (title
 * cards), so they need contrast against both.
 */
const OVERLAY_BTN =
	"tap-target inline-flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40";

function subscribeToViewport(onChange: () => void): () => void {
	const query = window.matchMedia(PORTRAIT_MEDIA_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function readViewportVariant(): DemoVariant {
	return demoVariantForViewport(
		window.matchMedia(PORTRAIT_MEDIA_QUERY).matches,
	);
}

/**
 * Which cut to serve — `null` until the client can measure the viewport. The
 * server snapshot is deliberately `null` rather than a guess: guessing
 * landscape would paint the wrong poster into a phone's 9:16 box for a frame
 * and then swap it, which reads as a glitch on the one section that is
 * supposed to look polished.
 */
function useDemoVariant(): DemoVariant | null {
	return useSyncExternalStore(
		subscribeToViewport,
		readViewportVariant,
		() => null,
	);
}

export function VideoDemo() {
	const shouldReduceMotion = useReducedMotion();
	const variant = useDemoVariant();
	const assets = variant ? DEMO_VIDEO[variant] : null;
	const videoRef = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(true);
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
	/**
	 * Whether the frame is currently on screen, as the observer last saw it.
	 * Read by the visibility handler below, which has no entry of its own.
	 */
	const inViewRef = useRef(false);

	// The <video> is keyed on `variant`, so a cut change mounts a fresh, paused
	// element — but it fires no `pause` event on the way out, and this state
	// would otherwise keep describing the old one: `playing` stuck true hides
	// the centred play button and labels the corner control "Pause" over a
	// stopped clip, in exactly the case (an unmuted remount that iOS refuses to
	// autoplay) the button exists for. Reset during render, the way React
	// resets state on a prop change; `muted` and `userPausedRef` are the
	// visitor's choices and deliberately survive.
	const [mountedVariant, setMountedVariant] = useState(variant);
	if (variant !== mountedVariant) {
		setMountedVariant(variant);
		setPlaying(false);
		setProgress(0);
		setNeedsGesture(true);
	}

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

	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		// Write the property, not just state: `muted` is what the browser reads,
		// and an unmute is a user gesture, which is the only time it's allowed.
		video.muted = !video.muted;
		setMuted(video.muted);
	}, []);

	// Autoplay on entry, pause on exit. Reduced motion opts out of the autoplay
	// half entirely — the play button stays, so the demo is never unreachable.
	// Re-armed on `variant`: the element remounts when the cut changes.
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !variant) return;
		if (shouldReduceMotion) return;

		// One autoplay attempt. A refusal with sound ON (the visitor unmuted,
		// then the element remounted on a rotation — iOS won't autoplay an
		// unmuted element without a gesture) is retried muted: the demo keeps
		// moving and the mute control shows sound is off, which beats a
		// stopped frame. A muted refusal (Low Power Mode, data saver) is the
		// real "needs a tap" and gets the centred button.
		const autoplay = () => {
			void video
				.play()
				.then(() => setNeedsGesture(false))
				.catch(() => {
					if (video.muted) {
						setNeedsGesture(true);
						return;
					}
					video.muted = true;
					setMuted(true);
					void video
						.play()
						.then(() => setNeedsGesture(false))
						.catch(() => setNeedsGesture(true));
				});
		};

		const observer = new IntersectionObserver(
			(entries) => {
				// The LAST entry, never `entries[0]`. A fast scroll delivers several
				// crossings in one batch, and reading the first one made a batched
				// [exit, enter] land as "exit" — the demo then sat paused mid-clip
				// while fully on screen (caught in verification, 29 Aug).
				const entry = entries[entries.length - 1];
				inViewRef.current = Boolean(entry?.isIntersecting);
				if (entry?.isIntersecting) {
					if (userPausedRef.current) return;
					autoplay();
				} else if (!video.paused) {
					video.pause();
				}
			},
			{ threshold: 0.25 },
		);
		observer.observe(video);

		// A page opened in a background tab gets its intersection callback while
		// the document is hidden: `play()` resolves and the clip never advances,
		// and nothing fires again when the tab is finally fronted — the visitor
		// sees the poster with a Play button where the loop should be running.
		// Re-arm on visibility, with the same guards the observer applies.
		const onVisibility = () => {
			if (document.visibilityState !== "visible") return;
			if (!inViewRef.current || userPausedRef.current || !video.paused) return;
			autoplay();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [shouldReduceMotion, variant]);

	const onTimeUpdate = useCallback(() => {
		const video = videoRef.current;
		if (!video?.duration) return;
		setProgress(video.currentTime / video.duration);
	}, []);

	const controlsVisible = !needsGesture || playing;

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
						{/* A phone held upright gets the 9:16 cut in a 9:16 box capped at
						    24rem wide (so the frame stays inside one screen); everything
						    else — md+, and a phone turned sideways — gets the 16:9 at
						    full width. `max-md:portrait:` is PORTRAIT_MEDIA_QUERY in CSS,
						    so the box and the bytes agree; CSS owns the ratio so the box
						    is reserved before hydration and the variant swap changes
						    bytes, never geometry. */}
						<div className="relative mx-auto overflow-hidden rounded-2xl border border-border/70 bg-primary shadow-2xl shadow-primary/20 max-md:portrait:max-w-[24rem] md:rounded-3xl">
							<video
								// Remount on cut change: a <video>'s <source> list is read once.
								key={variant ?? "pending"}
								ref={videoRef}
								className="block aspect-video w-full cursor-pointer object-cover max-md:portrait:aspect-[9/16]"
								poster={assets?.poster}
								preload="none"
								muted={muted}
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
								onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
							>
								{assets ? (
									<>
										{/* VP9+Opus first — smaller than the H.264+AAC fallback
										    on this content. Both are re-encodes of the masters in
										    10_Assets; see docs/landing-video-demo.md. */}
										<source src={assets.webm} type="video/webm" />
										<source src={assets.mp4} type="video/mp4" />
									</>
								) : null}
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

							{/* Always-visible controls — a control the visitor has to hover to
							    discover is a hidden control (CLAUDE.md § discoverability).
							    Mute sits left of play/pause: it is the newer, less expected
							    control, and the thumb lands on play/pause in the corner it
							    has always been in. */}
							{controlsVisible ? (
								<div className="absolute bottom-4 right-4 flex items-center gap-2">
									<button
										type="button"
										onClick={toggleMute}
										// The name says the action ("Unmute…" / "Mute…"), like its
										// play/pause sibling — no `aria-pressed` on top, which would
										// announce the state twice.
										aria-label={
											muted ? m.demo_video_unmute() : m.demo_video_mute()
										}
										className={OVERLAY_BTN}
									>
										{muted ? (
											<VolumeX className="size-4" />
										) : (
											<Volume2 className="size-4" />
										)}
									</button>
									<button
										type="button"
										onClick={toggle}
										aria-label={
											playing ? m.demo_video_pause() : m.demo_video_play()
										}
										className={OVERLAY_BTN}
									>
										{playing ? (
											<Pause className="size-4 fill-current" />
										) : (
											<Play className="size-4 translate-x-px fill-current" />
										)}
									</button>
								</div>
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
