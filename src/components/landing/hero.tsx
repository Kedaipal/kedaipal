import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { HeroStage } from "./hero-stage";
import {
	CommissionBadge,
	ctaPillClass,
	DemoPill,
	GuaranteeLine,
	Marquee,
	StartFreeLink,
} from "./landing-ui";

/**
 * Hero (landing v2, z8r3fdegej): the locked 8 Sep 2026 tagline, one line,
 * one button, one text link — then the before/after stage, then the seller
 * kinds marquee. The pain stickers and the trust row left this section in
 * the design review ("the text on top is too much info, make it concise so
 * the animation takes half the viewport").
 *
 * Demo-first (z8r3fdtpub T1, 19 Oct 2026): the mint pill is **Book a demo
 * on WhatsApp** and "Start free — pay when you sell" is the text link under
 * it — every payer to date closed on a demo or a referral, so the page sells
 * the first order, not the account. The guarantee came back under the CTA
 * pair (it is what a demo promises), and the flat-fee badge (14 Oct) sits
 * above the headline. 86eye3p6z §C still holds: one KIND of accent pill on
 * the page, and it is this one.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

const staggerContainer = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const revealUp = {
	hidden: { opacity: 0, y: 24 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.6, ease: EASE },
	},
};

function getMarqueeItems(): string[] {
	// `String(...)` is load-bearing: paraglide compiles to untyped .js, so the
	// message fn's return type is inferred and can degrade to `any`.
	return String(m.hero_marquee())
		.split("·")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function Hero() {
	const { isSignedIn } = useAuth();
	const shouldReduceMotion = useReducedMotion();

	return (
		<section id="top" className="relative overflow-hidden bg-hero-mesh">
			<div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 pb-16 pt-24 text-center md:px-8 md:pb-24 md:pt-36">
				<motion.div
					className="flex max-w-3xl flex-col items-center gap-5"
					initial={shouldReduceMotion ? undefined : "hidden"}
					animate={shouldReduceMotion ? undefined : "visible"}
					variants={staggerContainer}
				>
					<motion.div variants={revealUp}>
						<CommissionBadge />
					</motion.div>
					{/* The tagline is two sentences; the design sets the first on its own
					    line and the highlighted second across two. A hard break, not a
					    width trick, so the split survives every locale's line lengths. */}
					<motion.h1
						variants={revealUp}
						className="tracking-display text-[2.5rem] font-bold leading-[1.04] sm:text-5xl md:text-6xl lg:text-[4.25rem]"
					>
						{m.hero_headline_part1()}
						<br />
						<span className="kp-highlight animate-kp-highlight-sweep text-accent">
							{m.hero_headline_part2()}
						</span>
					</motion.h1>

					<motion.p
						variants={revealUp}
						className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg"
					>
						{m.hero_subhead()}
					</motion.p>

					<motion.div
						variants={revealUp}
						className="mt-1 flex w-full flex-col items-center gap-3 sm:w-auto"
					>
						{isSignedIn ? (
							<Link
								to="/app"
								className={`${ctaPillClass("accent")} w-full sm:w-fit`}
							>
								{m.nav_go_to_dashboard()}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						) : (
							<>
								<DemoPill placement="hero" long className="w-full sm:w-fit" />
								<StartFreeLink placement="hero" />
								<GuaranteeLine className="mt-1 max-w-md text-left text-[13px] leading-relaxed text-muted-foreground" />
							</>
						)}
					</motion.div>
				</motion.div>

				{/* The stage starts inside the first viewport on desktop (design AC):
				    tight top margin, and the copy above is three short blocks. */}
				<div className="mt-10 w-full md:mt-12">
					<HeroStage />
				</div>
			</div>

			{/* The kinds of seller on the roster, as one strip — the design keeps it
			    under the stage as the bridge into the demo. */}
			<Marquee items={getMarqueeItems()} className="relative" />
		</section>
	);
}
