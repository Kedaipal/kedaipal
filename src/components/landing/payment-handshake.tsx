import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "The payment handshake" — the landing section for universal pain #2
 * (chasing "dah transfer" screenshots). Left: claim + proof bullets.
 * Right: the flow ACTED OUT on loop (29 Aug, owner: the static pile was
 * bland): typing dots → the buyer's "dah transfer" bubble → the seller's
 * claim card (badge pulsing amber while it waits) → a simulated tap on
 * Confirm → the receipt springs in. Hold, clear, repeat.
 *
 * Loop guards are the house pattern (problem-strip.tsx): beats only advance
 * on a visible tab with the mock in view — AnimatePresence accumulates
 * never-unmounted nodes if exits can't run their frames — and reduced
 * motion renders the full stack statically (the pre-animation design).
 * The mock column has a FIXED height so beats never shift the page layout
 * (the buried-chats lesson). Mock stays decorative (`aria-hidden`); the
 * copy column carries the content.
 */

/** Beat durations, ms: typing → bubble → card → tap → receipt hold → clear. */
const BEATS = [900, 1100, 1400, 900, 3000, 450];

function useHandshakeBeat(active: boolean): number {
	const [beat, setBeat] = useState(0);

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		let id: ReturnType<typeof setTimeout>;
		// A hidden tab freezes the story rather than advancing it unseen — but
		// it must WAKE when the tab returns, so the frozen branch re-arms a
		// short retry instead of setting identical state (which would never
		// re-run this effect and would kill the loop permanently).
		const arm = (delay: number) => {
			id = setTimeout(() => {
				if (cancelled) return;
				if (document.visibilityState === "visible") {
					setBeat((b) => (b + 1) % BEATS.length);
				} else {
					arm(1000);
				}
			}, delay);
		};
		arm(BEATS[beat]);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [active, beat]);

	return beat;
}

function TypingDots() {
	return (
		<motion.div
			initial={{ opacity: 0, y: 10, scale: 0.9 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, scale: 0.9 }}
			transition={{ type: "spring", stiffness: 380, damping: 26 }}
			className="flex max-w-[280px] items-center gap-1.5 self-end rounded-2xl rounded-tr-sm bg-[#DCF8C6] px-4 py-3.5 shadow-md"
		>
			{[0, 1, 2].map((i) => (
				<motion.span
					key={i}
					animate={{ y: [0, -4, 0] }}
					transition={{
						duration: 0.9,
						repeat: Infinity,
						delay: i * 0.15,
						ease: "easeInOut",
					}}
					className="size-1.5 rounded-full bg-slate-500/70"
				/>
			))}
		</motion.div>
	);
}

const springIn = {
	initial: { opacity: 0, y: 14, scale: 0.94 },
	animate: { opacity: 1, y: 0, scale: 1 },
	exit: { opacity: 0, scale: 0.96 },
	transition: { type: "spring" as const, stiffness: 320, damping: 26 },
};

function HandshakePlay() {
	const shouldReduceMotion = useReducedMotion();
	const stageRef = useRef<HTMLDivElement>(null);
	const inView = useInView(stageRef, { margin: "-10% 0px" });
	const beat = useHandshakeBeat(!shouldReduceMotion && inView);

	// Reduced motion: the full story as a still — every element visible.
	const showTyping = shouldReduceMotion ? false : beat === 0;
	const showBubble = shouldReduceMotion || (beat >= 1 && beat <= 4);
	const showCard = shouldReduceMotion || (beat >= 2 && beat <= 4);
	const tapping = !shouldReduceMotion && beat === 3;
	const confirmed = shouldReduceMotion || beat === 4;

	return (
		<div
			ref={stageRef}
			aria-hidden="true"
			className="mx-auto flex h-[350px] w-full max-w-sm flex-col justify-start gap-3"
		>
			<AnimatePresence mode="popLayout">
				{showTyping && <TypingDots key="typing" />}

				{showBubble && (
					<motion.div
						key="bubble"
						{...springIn}
						className="max-w-[280px] rotate-1 self-end rounded-2xl rounded-tr-sm bg-[#DCF8C6] px-4 py-3 shadow-md"
					>
						<p className="text-sm font-medium text-slate-800">
							{m.handshake_chat_paid()}
						</p>
						<p className="mt-1 text-right text-[10px] text-slate-500">
							8:41 PM ✓✓
						</p>
					</motion.div>
				)}

				{showCard && (
					<motion.div
						key="card"
						{...springIn}
						className="-rotate-1 rounded-2xl border border-border bg-card p-5 shadow-xl"
					>
						<div className="flex items-center justify-between gap-2">
							<p className="text-[13px] font-bold">ORD-0042 · RM 76.00</p>
							{/* Pulses while it waits for the seller — settles once tapped. */}
							<motion.span
								animate={
									confirmed || shouldReduceMotion
										? { opacity: 1 }
										: { opacity: [1, 0.55, 1] }
								}
								transition={
									confirmed || shouldReduceMotion
										? { duration: 0.2 }
										: { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
								}
								className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
							>
								{m.handshake_card_badge()}
							</motion.span>
						</div>
						<p className="mt-2.5 text-[13px] text-muted-foreground">
							{m.handshake_card_method()}
						</p>
						<div className="mt-3.5 flex gap-2">
							<motion.span
								animate={tapping ? { scale: [1, 0.93, 1] } : { scale: 1 }}
								transition={{ duration: 0.45, ease: "easeOut" }}
								className="relative flex h-10 flex-1 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground"
							>
								{/* The simulated tap — a ring blooming off the button. */}
								{tapping && (
									<motion.span
										initial={{ scale: 0.5, opacity: 0.6 }}
										animate={{ scale: 1.5, opacity: 0 }}
										transition={{ duration: 0.6, ease: "easeOut" }}
										className="absolute inset-0 rounded-full border-2 border-accent"
									/>
								)}
								{m.handshake_card_confirm()}
							</motion.span>
							<span className="flex h-10 items-center justify-center rounded-full border border-border px-4 text-[13px] font-semibold text-muted-foreground">
								{m.handshake_card_decline()}
							</span>
						</div>
					</motion.div>
				)}

				{confirmed && (
					<motion.div
						key="receipt"
						{...springIn}
						className="max-w-[300px] rotate-[0.5deg] rounded-2xl rounded-tl-sm border border-accent/30 bg-card px-4 py-3 shadow-md"
					>
						<p className="text-[13px] font-semibold">
							{m.handshake_chat_received()}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{m.handshake_chat_receipt()}
						</p>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function PaymentHandshake() {
	const points = [
		m.handshake_point_1(),
		m.handshake_point_2(),
		m.handshake_point_3(),
	];

	return (
		<section aria-labelledby="handshake-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				<div className="grid items-center gap-12 md:grid-cols-2 md:gap-16 lg:gap-20">
					<FadeIn>
						<Eyebrow>{m.handshake_label()}</Eyebrow>
						<h2
							id="handshake-heading"
							className="mt-4 text-3xl font-bold leading-[1.08] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.handshake_heading()}
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
							{m.handshake_body_1()}{" "}
							<strong className="font-semibold text-foreground">
								{m.handshake_body_strong()}
							</strong>{" "}
							{m.handshake_body_2()}
						</p>
						<ul className="mt-7 space-y-3.5">
							{points.map((point) => (
								<li
									key={point}
									className="flex gap-3 text-[15px] leading-relaxed text-foreground/80"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-accent" />
									{point}
								</li>
							))}
						</ul>
						<p className="mt-6 text-[13px] text-muted-foreground">
							{m.handshake_note()}
						</p>
					</FadeIn>

					<FadeIn delay={0.15}>
						<HandshakePlay />
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
