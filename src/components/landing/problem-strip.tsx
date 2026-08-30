import {
	AnimatePresence,
	motion,
	useInView,
	useReducedMotion,
} from "framer-motion";
import { TrendingDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { carouselSlideClass, carouselTrackClass } from "./landing-ui";

/**
 * The pain section, sharpened (29 Aug, owner ask): the buried-chats pile is
 * now a LIVE loop — money messages (an order request, a "dah transfer")
 * arrive highlighted in mint, then visibly sink and fade as everyday chat
 * piles on top, exactly the mechanic `problem_1_body` describes. The
 * "47 unread" stamp pulses with every arrival. Each numbered card also
 * carries a `Cost:` stamp naming the loss in one line — no new numeric
 * claims, each stamp restates its own card's body (the 20-minutes figure
 * already lives in `problem_2_body`).
 *
 * Reduced motion: the loop never starts and the pile renders as the static
 * four-bubble stack (the pre-animation design); the stamps and cards are
 * static always — continuous motion is confined to the decorative pile.
 */

type ChatKind = "noise" | "order" | "payment";

interface ChatStep {
	text: () => string;
	kind: ChatKind;
}

/** One cycle of the inbox: two money messages drowning among four noise
 * chats — roughly the ratio the pain narrative needs (money exists, but
 * never on top). */
const STEPS: ChatStep[] = [
	{ text: m.problem_chat_1, kind: "noise" },
	{ text: m.problem_chat_2, kind: "order" },
	{ text: m.problem_chat_5, kind: "noise" },
	{ text: m.problem_chat_6, kind: "noise" },
	{ text: m.problem_chat_3, kind: "payment" },
	{ text: m.problem_chat_4, kind: "noise" },
];

const WINDOW = 4;
const TICK_MS = 1600;
/** The unread counter starts here and climbs by one per arriving message —
 * capped for display at "99+" so a long-lingering visitor sees a WhatsApp-
 * style overflow, never an absurd four-digit count. */
const UNREAD_START = 47;
const UNREAD_CAP = 99;

/** "{n}" for the unread stamp at a given tick (tick starts at WINDOW-1, so
 * the first paint reads exactly UNREAD_START). Exported for the unit test —
 * the loop only runs on a visible, in-viewport page, which no headless
 * check can observe. */
export function unreadCount(tick: number): string {
	const count = UNREAD_START + (tick - (WINDOW - 1));
	return count < UNREAD_CAP ? String(count) : `${UNREAD_CAP}+`;
}

function stepAt(index: number): ChatStep {
	return STEPS[((index % STEPS.length) + STEPS.length) % STEPS.length];
}

/** Older = more buried: newest bubble is fully opaque, the one about to
 * fall off the top is nearly gone. */
const OPACITY_BY_AGE = [1, 0.7, 0.45, 0.22];

function ChatBubble({
	step,
	age,
	index,
	animated,
}: {
	step: ChatStep;
	age: number;
	index: number;
	animated: boolean;
}) {
	const money = step.kind !== "noise";
	const body = (
		<div className="rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 shadow-lg">
			{money ? (
				<span className="mb-1 inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-emphasis">
					{step.kind === "order"
						? m.problem_chat_order_tag()
						: m.problem_chat_payment_tag()}
				</span>
			) : null}
			<p className="text-sm font-medium text-slate-800">{step.text()}</p>
		</div>
	);

	if (!animated) {
		return (
			<div
				className="mb-2"
				style={{
					opacity: OPACITY_BY_AGE[age],
					transform: `rotate(${index % 2 === 0 ? -1.5 : 1.5}deg)`,
				}}
			>
				{body}
			</div>
		);
	}

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 18, scale: 0.96 }}
			animate={{
				opacity: OPACITY_BY_AGE[age],
				y: 0,
				scale: 1,
				rotate: index % 2 === 0 ? -1.5 : 1.5,
			}}
			exit={{ opacity: 0, height: 0, marginBottom: 0 }}
			transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
			className="mb-2 overflow-hidden"
		>
			{body}
		</motion.div>
	);
}

/** The pile of "buried" chats — the pain made visible, and now audible-ish:
 * it keeps happening while you watch. Decorative (`aria-hidden`). */
function BuriedChats() {
	const shouldReduceMotion = useReducedMotion();
	const containerRef = useRef<HTMLDivElement>(null);
	const inView = useInView(containerRef, { margin: "-10% 0px" });
	const [tick, setTick] = useState(WINDOW - 1);

	// Tick only while the tab is visible AND the pile is on screen. Exit
	// animations need animation frames to finish, so ticking in a hidden tab
	// makes AnimatePresence accumulate never-unmounted bubbles without bound
	// (found live, 29 Aug: 40 bubbles in the DOM after a minute backgrounded).
	useEffect(() => {
		if (shouldReduceMotion || !inView) return;
		const id = setInterval(() => {
			if (document.visibilityState === "visible") setTick((t) => t + 1);
		}, TICK_MS);
		return () => clearInterval(id);
	}, [shouldReduceMotion, inView]);

	// Newest at the bottom, like a real chat — the money messages get pushed
	// UP toward the fade and out of sight.
	const indices = Array.from(
		{ length: WINDOW },
		(_, i) => tick - (WINDOW - 1) + i,
	).filter((i) => i >= 0);

	return (
		<div
			ref={containerRef}
			aria-hidden
			className="relative mx-auto w-full max-w-xs select-none"
		>
			{/* Fixed-height, bottom-anchored window: bubbles scroll INSIDE this
			    frame (older ones fade out through the top mask) so the pile never
			    changes the section's height — entering/exiting bubbles were
			    shifting the whole page layout (owner-caught, 29 Aug). */}
			<div
				className="flex h-[264px] flex-col justify-end overflow-hidden"
				style={{
					maskImage:
						"linear-gradient(to bottom, transparent, black 22%)",
					WebkitMaskImage:
						"linear-gradient(to bottom, transparent, black 22%)",
				}}
			>
				<AnimatePresence initial={false}>
					{indices.map((i) => (
						<ChatBubble
							key={i}
							step={stepAt(i)}
							age={indices.length - 1 - (i - indices[0])}
							index={i}
							animated={!shouldReduceMotion}
						/>
					))}
				</AnimatePresence>
			</div>
			{/* Pulses on every arrival — and the count climbs with it, one per
			    message, because that's what the counter does in real life. */}
			<motion.div
				key={shouldReduceMotion ? "static" : tick}
				initial={shouldReduceMotion ? false : { scale: 1.18 }}
				animate={{ scale: 1 }}
				transition={{ duration: 0.35, ease: "easeOut" }}
				className="absolute -bottom-3 -right-2 rotate-3 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-destructive-foreground shadow-lg"
			>
				{m.problem_chat_unread({ n: unreadCount(tick) })}
			</motion.div>
		</div>
	);
}

export function ProblemStrip() {
	const problems = [
		{ title: m.problem_1_title(), body: m.problem_1_body(), loss: m.problem_1_loss() },
		{ title: m.problem_2_title(), body: m.problem_2_body(), loss: m.problem_2_loss() },
		{ title: m.problem_3_title(), body: m.problem_3_body(), loss: m.problem_3_loss() },
	];

	return (
		<section
			aria-labelledby="problem-heading"
			className="bg-cta-mesh text-cta-mesh-foreground"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				<div className="grid items-center gap-12 md:grid-cols-[1.2fr_0.8fr] md:gap-16">
					<FadeIn>
						<h2
							id="problem-heading"
							className="text-3xl font-bold leading-[1.1] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.problem_heading()}
						</h2>
					</FadeIn>
					<FadeIn delay={0.15}>
						<BuriedChats />
					</FadeIn>
				</div>

				{/* Mobile: snap carousel of individually-bordered cards. md+: the
				    original joined grid (parent border + gap-px showing the hairline
				    ground through), so each card sheds its own border there. */}
				<FadeIn className="mt-16 md:mt-20">
					<div
						className={carouselTrackClass(
							"md:grid md:grid-cols-3 md:gap-px md:overflow-hidden md:rounded-3xl md:border md:border-white/10 md:bg-white/10",
						)}
					>
						{problems.map((p, i) => (
							<div key={p.title} className={carouselSlideClass("md:h-full")}>
								<div className="group relative h-full overflow-hidden rounded-3xl border border-white/10 bg-primary p-7 text-primary-foreground transition-colors duration-200 hover:bg-primary/90 md:rounded-none md:border-0 md:p-9">
									<span className="inline-block text-5xl font-black leading-none text-destructive/80 transition-transform duration-200 group-hover:scale-110 motion-reduce:group-hover:scale-100 md:text-6xl">
										{String(i + 1).padStart(2, "0")}
									</span>
									<h3 className="mt-4 text-lg font-bold md:text-xl">
										{p.title}
									</h3>
									<p className="mt-3 text-sm leading-relaxed text-primary-foreground/60">
										{p.body}
									</p>
									{/* The loss, stamped in one line — restates the card's own
									    body, never a new claim. */}
									<p className="mt-5 inline-flex -rotate-1 items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/15 px-2.5 py-1.5 text-xs font-bold text-red-300">
										<TrendingDown className="size-3.5" aria-hidden />
										{p.loss}
									</p>
								</div>
							</div>
						))}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
