import { Link } from "@tanstack/react-router";
import {
	animate,
	motion,
	useAnimationFrame,
	useMotionValue,
	useReducedMotion,
} from "framer-motion";
import { ArrowLeft, ArrowRight, Store } from "lucide-react";
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
 * brand, and the no-fabricated-quotes stance stands as ever. Five cards, the
 * five kinds in the demo video (19 Oct 2026, truth fix 8); the navy "why
 * they switch" closer with its founder metrics went the same day (fix 9) —
 * "Ad spend RM 0" means nothing to a seller. A named seller quote waits on
 * the seller.
 *
 * Interaction: the rail DRIFTS continuously (the track renders two copies
 * and the rendered offset wraps modulo one copy's width — the infinite
 * marquee pattern), pauses on hover and while dragging, and stays
 * hand-draggable (`drag="x"`, unbounded; the wrap absorbs any distance).
 * Arrow buttons remain the keyboard path. One FadeIn wraps the whole rail
 * (the house peeking-slide rule). Reduced motion kills the drift; drag and
 * buttons survive, since both are user-initiated.
 *
 * The "10+ paying sellers" count chip came off on 15 Oct 2026 (Arif's call on
 * the enhancement canvas, artboard 7): a hand-typed number that nothing kept
 * true. In its place the section states the benefit the directory IS — every
 * store is listed free on /stores, with showcases above the list — beside the
 * "Browse their stores" door, since that is where a visitor meets it.
 */

interface SellerCard {
	label: () => string;
	body: () => string;
	image: string;
}

/**
 * The five kinds in the demo video (`demo_video_heading` promises five), in
 * its order: a custom cake, frozen food, a live sale, a booking, apparel.
 * Twelve cards under that heading was truth fix 8 (z8r3fdhj8p); the surplus
 * kinds' copy left the catalogs with them.
 */
const CARDS: SellerCard[] = [
	{ label: m.proof_kind_5, body: m.proof_kind_5_body, image: "seller-cake" },
	{
		label: m.proof_kind_10,
		body: m.proof_kind_10_body,
		image: "seller-frozen",
	},
	{ label: m.proof_kind_12, body: m.proof_kind_12_body, image: "seller-live" },
	{
		label: m.proof_kind_7,
		body: m.proof_kind_7_body,
		image: "seller-campsite",
	},
	{ label: m.proof_kind_8, body: m.proof_kind_8_body, image: "seller-fashion" },
];

/** One arrow-press advances roughly one card (width + gap). */
const CARD_STEP = 330;
/** Idle drift speed, px per ms (~22px/s — the payment wall's unhurried pace). */
const DRIFT = 0.022;

function CardGroup({ hidden = false }: { hidden?: boolean }) {
	return (
		<div
			aria-hidden={hidden || undefined}
			data-testid="seller-cards"
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
		<section
			id="proof"
			aria-labelledby="proof-heading"
			className="bg-background"
		>
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
					</div>
					<div className="flex flex-col gap-4 lg:max-w-sm lg:items-end">
						<p className="text-base leading-relaxed text-muted-foreground md:text-lg lg:text-right">
							{m.proof_sub()}
						</p>
						{/* The proof's own next step: these are real stores, so let a
						    visitor walk into them (z8r3fdkmyp). The landing's one
						    buyer-shaped door — on the proof, not in the hero, which
						    stays the seller's pitch. */}
						<Link
							to="/stores"
							className="group inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-accent-emphasis underline-offset-4 hover:underline lg:self-end"
						>
							{m.proof_browse_stores()}
							<ArrowRight
								aria-hidden
								className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
							/>
						</Link>
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
					{/* The directory, said as what it does for the seller: a free
					    listing on /stores plus the showcases above it, nothing to sign
					    up for, one switch in Settings → Store to leave. A caption
					    under the rail of stores it is about — the header keeps its
					    two-column balance (heading left; paragraph, link, arrows
					    right). Two earlier placements were rejected on sight (Arif,
					    15 Oct): a boxed card in the right column stretched it and left
					    the heading dangling, and a three-line paragraph under the
					    heading read as a legal footnote. */}
					<p className="mt-6 flex max-w-2xl items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
						<Store
							aria-hidden
							className="mt-1 size-4 shrink-0 text-accent-emphasis"
						/>
						<span>
							<strong className="font-semibold text-foreground">
								{m.proof_directory_strong()}
							</strong>{" "}
							{m.proof_directory_body()}
						</span>
					</p>
				</FadeIn>
			</div>
		</section>
	);
}
