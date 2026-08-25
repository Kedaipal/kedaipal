import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BellOff, Check } from "lucide-react";
import { m } from "../../paraglide/messages";
import { HeroPhone } from "./hero-phone";
import { ctaPillClass, GuaranteeLine, Marquee, Sticker } from "./landing-ui";

const EASE = [0.22, 1, 0.36, 1] as const;

const staggerContainer = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const revealUp = {
	hidden: { opacity: 0, y: 28 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.65, ease: EASE },
	},
};

function getMarqueeItems(): string[] {
	// `String(...)` is load-bearing: paraglide compiles to untyped .js, so the
	// message fn's return type is inferred (allowJs + strict) and can degrade to
	// `any` purely because the surrounding program changed — which makes the
	// callbacks below implicit-any and breaks the build on an unrelated branch.
	return String(m.hero_marquee())
		.split("·")
		.map((item) => item.trim())
		.filter(Boolean);
}

const secondaryLinkClass =
	"inline-flex items-center gap-1 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

function TrustLine() {
	// See getMarqueeItems — pin the string rather than trust inferred JS types.
	const items = String(m.hero_trust()).split("·");
	return (
		<ul className="flex flex-wrap gap-x-4 gap-y-1.5">
			{items.map((item) => (
				<li
					key={item}
					className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80"
				>
					<Check className="size-3.5 text-accent" />
					{item.trim()}
				</li>
			))}
		</ul>
	);
}

function FloatingBubble({
	children,
	className,
	delay = 0,
}: {
	children: React.ReactNode;
	className?: string;
	delay?: number;
}) {
	const shouldReduceMotion = useReducedMotion();
	if (shouldReduceMotion) {
		return <div className={className}>{children}</div>;
	}
	return (
		<motion.div
			className={className}
			initial={{ opacity: 0, scale: 0.7, y: 14 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			transition={{ duration: 0.55, delay, ease: EASE }}
		>
			<motion.div
				animate={{ y: [0, -7, 0] }}
				transition={{
					duration: 4.5,
					repeat: Infinity,
					ease: "easeInOut",
					delay: delay + 0.4,
				}}
			>
				{children}
			</motion.div>
		</motion.div>
	);
}

function PhoneStage() {
	const shouldReduceMotion = useReducedMotion();

	const phone = <HeroPhone />;

	return (
		<div className="relative">
			{shouldReduceMotion ? (
				phone
			) : (
				<motion.div
					initial={{ opacity: 0, y: 24, rotate: 4 }}
					animate={{ opacity: 1, y: 0, rotate: 0 }}
					transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
				>
					{phone}
				</motion.div>
			)}

			{/* Missed order — the revenue the buried inbox already cost. */}
			<FloatingBubble
				delay={1.15}
				className="absolute -right-3 top-2 sm:-right-9"
			>
				<Sticker tone="destructive" rotate={4} className="text-[11px]">
					<BellOff className="size-3.5" />
					{m.hero_pain_missed()}
				</Sticker>
			</FloatingBubble>

			{/* The payment chase, in the seller's own words. */}
			<FloatingBubble
				delay={1.35}
				className="absolute -right-4 -bottom-3 sm:-right-12"
			>
				<div className="rotate-2 rounded-2xl rounded-tr-sm border border-amber-300 bg-amber-50 px-3 py-2 shadow-lg">
					<p className="text-[11px] font-bold text-slate-800">
						{m.hero_pain_chase()}
					</p>
					<p className="mt-0.5 text-[10px] font-semibold text-amber-700">
						{m.hero_pain_chase_sub()}
					</p>
				</div>
			</FloatingBubble>

			<FloatingBubble
				delay={1.5}
				className="absolute -left-3 bottom-8 sm:-left-8"
			>
				<Sticker tone="destructive" rotate={-3} className="text-[11px]">
					{m.problem_chat_unread()}
				</Sticker>
			</FloatingBubble>
		</div>
	);
}

export function Hero() {
	const { isSignedIn } = useAuth();
	const shouldReduceMotion = useReducedMotion();

	return (
		<section id="top" className="relative overflow-hidden bg-hero-mesh">
			<div className="relative mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-28 md:grid-cols-[1.05fr_0.95fr] md:gap-10 md:px-8 md:pb-28 md:pt-40">
				<motion.div
					className="flex flex-col justify-center gap-7"
					initial={shouldReduceMotion ? undefined : "hidden"}
					animate={shouldReduceMotion ? undefined : "visible"}
					variants={staggerContainer}
				>
					<motion.div variants={revealUp}>
						<Sticker tone="outline" rotate={-1.5}>
							{m.hero_badge()}
						</Sticker>
					</motion.div>

					<motion.h1
						variants={revealUp}
						className="tracking-display text-[2.75rem] font-bold leading-[0.98] sm:text-6xl md:text-7xl"
					>
						{m.hero_headline_part1()}{" "}
						<span className="kp-highlight text-accent">
							{m.hero_headline_part2()}
						</span>
					</motion.h1>

					<motion.p
						variants={revealUp}
						className="max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg"
					>
						{m.hero_subhead()}
					</motion.p>

					{/* Exactly one primary button on the page (86eye3p6z §C). The old
					    slug-claim form and the founding-spot pill are now text links in
					    their own sections, so the visitor is never asked to choose
					    between three different commitments. */}
					<motion.div variants={revealUp} className="flex flex-col gap-3">
						{isSignedIn ? (
							<>
								<Link to="/app" className={`${ctaPillClass("accent")} w-fit`}>
									{m.nav_go_to_dashboard()}
									<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
								</Link>
								<a href="#how" className={secondaryLinkClass}>
									{m.hero_cta_secondary()}
									<ArrowRight className="size-3.5" />
								</a>
							</>
						) : (
							<>
								<Link
									to="/sign-up/$"
									params={{ _splat: "" }}
									className={`${ctaPillClass("accent")} w-fit`}
								>
									{m.final_cta()}
									<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
								</Link>
								<GuaranteeLine className="max-w-md text-[13px] leading-relaxed text-muted-foreground" />
								<div className="flex flex-wrap gap-x-5 gap-y-2">
									<Link
										to="/sign-up/$"
										params={{ _splat: "" }}
										className={secondaryLinkClass}
									>
										{m.hero_cta_primary()}
									</Link>
									<a href="#how" className={secondaryLinkClass}>
										{m.hero_cta_secondary()}
										<ArrowRight className="size-3.5" />
									</a>
								</div>
							</>
						)}
					</motion.div>

					<motion.div variants={revealUp}>
						<TrustLine />
					</motion.div>
				</motion.div>

				<div className="flex items-center justify-center py-6 md:py-0">
					<PhoneStage />
				</div>
			</div>

			<Marquee items={getMarqueeItems()} className="relative" />
		</section>
	);
}
