import {
	animate,
	motion,
	useAnimationFrame,
	useMotionValue,
	useReducedMotion,
} from "framer-motion";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "Real sellers, real orders" — a Mobbin-style auto-scrolling showcase
 * (29 Aug, owner ask). Every card is a KIND of business drawn from the real
 * paying roster (prod Convex, via the MCP), deliberately anonymized — the
 * owner's pivot pulled customer names, logos and the paying/cohort badges
 * back off the page after briefly shipping them, so nothing here names a
 * brand, and the no-fabricated-quotes stance stands as ever. Six kinds ship
 * with photos; the remaining kind labels (`proof_kind_4/6/7/8`) stay in the
 * catalogs awaiting images (Higgsfield credits ran out mid-batch, 29 Aug).
 *
 * Interaction: the rail DRIFTS continuously (the track renders two copies
 * and the rendered offset wraps modulo one copy's width — the infinite
 * marquee pattern), pauses on hover and while dragging, and stays
 * hand-draggable (`drag="x"`, unbounded; the wrap absorbs any distance).
 * Arrow buttons remain the keyboard path. One FadeIn wraps the whole rail
 * (the house peeking-slide rule). Reduced motion kills the drift; drag and
 * buttons survive, since both are user-initiated.
 */

interface SellerCard {
	label: () => string;
	body: () => string;
	image: string;
}

const CARDS: SellerCard[] = [
	{ label: m.proof_kind_1, body: m.proof_kind_1_body, image: "seller-lekor" },
	{ label: m.proof_kind_12, body: m.proof_kind_12_body, image: "seller-live" },
	{ label: m.proof_kind_8, body: m.proof_kind_8_body, image: "seller-fashion" },
	{ label: m.proof_kind_2, body: m.proof_kind_2_body, image: "seller-tentwash" },
	{ label: m.proof_kind_4, body: m.proof_kind_4_body, image: "seller-dessert" },
	{ label: m.proof_kind_11, body: m.proof_kind_11_body, image: "seller-prints" },
	{ label: m.proof_kind_3, body: m.proof_kind_3_body, image: "seller-fish" },
	{ label: m.proof_kind_5, body: m.proof_kind_5_body, image: "seller-cake" },
	{ label: m.proof_kind_6, body: m.proof_kind_6_body, image: "seller-meat" },
	{ label: m.proof_kind_7, body: m.proof_kind_7_body, image: "seller-campsite" },
	{ label: m.proof_kind_9, body: m.proof_kind_9_body, image: "seller-fitness" },
	{ label: m.proof_kind_10, body: m.proof_kind_10_body, image: "seller-frozen" },
];

/** One arrow-press advances roughly one card (width + gap). */
const CARD_STEP = 330;
/** Idle drift speed, px per ms (~22px/s — the payment wall's unhurried pace). */
const DRIFT = 0.022;

function CardGroup({ hidden = false }: { hidden?: boolean }) {
	return (
		<div
			aria-hidden={hidden || undefined}
			className="flex shrink-0 gap-5 pr-5"
		>
			{CARDS.map((card) => (
				<article
					key={card.image}
					className="w-[280px] shrink-0 overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:ring-1 hover:ring-accent/25 motion-reduce:hover:translate-y-0 sm:w-[310px]"
				>
					<picture>
						<source
							srcSet={`/img/landing/${card.image}-640.avif`}
							type="image/avif"
						/>
						<img
							src={`/img/landing/${card.image}-640.webp`}
							alt=""
							width={640}
							height={478}
							loading="lazy"
							draggable={false}
							className="h-40 w-full select-none object-cover"
						/>
					</picture>
					<div className="p-5">
						<h3 className="text-lg font-semibold">{card.label()}</h3>
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
							{card.body()}
						</p>
					</div>
				</article>
			))}

			{/* The closer: why they switch — the navy stat card ends each loop. */}
			<article className="flex w-[280px] shrink-0 flex-col rounded-3xl bg-cta-mesh p-6 text-cta-mesh-foreground shadow-lg sm:w-[310px]">
				<p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-accent">
					<Star className="size-3.5 fill-accent" aria-hidden />
					{m.proof_stat_label()}
				</p>
				<h3
					className="mt-4 text-xl font-bold"
					style={{ letterSpacing: "-0.02em" }}
				>
					{m.proof_stat_heading()}
				</h3>
				<p className="mt-2 text-sm leading-relaxed text-cta-mesh-foreground/65">
					{m.proof_stat_body()}
				</p>
				<div className="mt-auto space-y-3 border-t border-white/10 pt-5">
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm text-cta-mesh-foreground/65">
							{m.proof_stat_1_label()}
						</span>
						<span className="text-base font-bold">{m.proof_stat_1_value()}</span>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm text-cta-mesh-foreground/65">
							{m.proof_stat_2_label()}
						</span>
						<span className="text-base font-bold">{m.proof_stat_2_value()}</span>
					</div>
				</div>
			</article>
		</div>
	);
}

export function RealSellers() {
	const shouldReduceMotion = useReducedMotion();
	const firstGroupRef = useRef<HTMLDivElement>(null);
	const pausedRef = useRef(false);
	const x = useMotionValue(0);
	const loopWidthRef = useRef(0);

	useEffect(() => {
		function measure() {
			const group = firstGroupRef.current;
			if (!group) return;
			loopWidthRef.current = group.offsetWidth;
		}
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);

	// Drift + wrap. `x` is the value framer's drag gesture writes to, so the
	// wrap adjusts x ITSELF by exactly one copy-width whenever it leaves
	// [-loopWidth, 0] — the two copies are identical, so the jump is
	// invisible, and it works mid-drag, mid-fling and mid-nudge alike.
	useAnimationFrame((_, delta) => {
		const loopWidth = loopWidthRef.current;
		if (!loopWidth) return;
		if (!pausedRef.current && !shouldReduceMotion) {
			x.set(x.get() - delta * DRIFT);
		}
		const value = x.get();
		if (value <= -loopWidth) x.set(value + loopWidth);
		else if (value > 0) x.set(value - loopWidth);
	});

	const nudge = useCallback(
		(direction: 1 | -1) => {
			animate(x, x.get() - direction * CARD_STEP, {
				type: "spring",
				stiffness: 300,
				damping: 34,
				...(shouldReduceMotion ? { duration: 0 } : {}),
			});
		},
		[x, shouldReduceMotion],
	);

	return (
		<section aria-labelledby="proof-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
					<div className="lg:max-w-xl">
						<Eyebrow>{m.proof_label()}</Eyebrow>
						<h2
							id="proof-heading"
							className="mt-4 text-3xl font-bold md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.proof_heading()}
						</h2>
						{/* The trust anchor that replaced Founding 10 (86eye4wtb) — a real
						    live count now that we're past that stage, not a spots-remaining
						    countdown. */}
						<div className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent/5 px-5 py-3">
							<span className="font-heading text-3xl font-extrabold text-accent md:text-4xl">
								{m.proof_customer_count_number()}
							</span>
							<span className="text-sm font-semibold text-foreground/80 md:text-base">
								{m.proof_customer_count_label()}
							</span>
						</div>
					</div>
					<div className="flex flex-col gap-4 lg:max-w-sm lg:items-end">
						<p className="text-base leading-relaxed text-muted-foreground md:text-lg lg:text-right">
							{m.proof_sub()}
						</p>
						<div className="hidden gap-2 md:flex">
							<button
								type="button"
								onClick={() => nudge(-1)}
								aria-label={m.proof_rail_prev()}
								className="tap-target flex items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-foreground/25 hover:bg-muted"
							>
								<ArrowLeft className="size-4" />
							</button>
							<button
								type="button"
								onClick={() => nudge(1)}
								aria-label={m.proof_rail_next()}
								className="tap-target flex items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-foreground/25 hover:bg-muted"
							>
								<ArrowRight className="size-4" />
							</button>
						</div>
					</div>
				</div>

				<FadeIn className="mt-12 md:mt-14">
					{/* Full-bleed drift viewport — cards slide under the screen edge, the
					    track is grabbable anywhere (`touch-action: pan-y` keeps vertical
					    page scroll working mid-rail), and hover holds the drift so a
					    reader is never chasing a moving card. */}
					<div className="-mx-5 overflow-hidden px-5 md:-mx-8 md:px-8">
						<motion.div
							drag="x"
							dragTransition={{ power: 0.3, timeConstant: 200 }}
							onDragStart={() => {
								pausedRef.current = true;
							}}
							onDragEnd={() => {
								pausedRef.current = false;
							}}
							onHoverStart={() => {
								pausedRef.current = true;
							}}
							onHoverEnd={() => {
								pausedRef.current = false;
							}}
							style={{ x, touchAction: "pan-y" }}
							className="flex w-max cursor-grab active:cursor-grabbing"
						>
							<div ref={firstGroupRef} className="flex shrink-0">
								<CardGroup />
							</div>
							<CardGroup hidden />
						</motion.div>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
