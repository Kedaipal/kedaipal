import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BellOff, Check } from "lucide-react";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { HeroDevice } from "./hero-device";
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
	"inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

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

	const phone = <HeroDevice />;

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

			{/* The two universal pains float OUTSIDE the phone — the storefront
			    on-screen is the after, the stickers are the before. Trimmed from
			    three to two when the screen flipped from the buried inbox to the
			    storefront (29 Aug): each sticker now maps 1:1 to a pain the page
			    promises to fix, and the calmer stage matches the Aave-style
			    single-device reference this layout follows. */}
			<FloatingBubble
				delay={1.15}
				className="absolute -left-8 top-28 hidden md:block lg:-left-16"
			>
				<Sticker tone="destructive" rotate={-4} className="text-[11px]">
					<BellOff className="size-3.5" />
					{m.hero_pain_missed()}
				</Sticker>
			</FloatingBubble>

			{/* The payment chase, in the seller's own words. */}
			<FloatingBubble
				delay={1.35}
				className="absolute -right-4 bottom-16 hidden md:block lg:-right-12"
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
		</div>
	);
}

export function Hero() {
	const { isSignedIn } = useAuth();
	const shouldReduceMotion = useReducedMotion();
	const supportWa = useSupportWaNumber();

	return (
		<section id="top" className="relative overflow-hidden bg-hero-mesh">
			{/* Mobile-only colour blobs (29 Aug, owner: the mobile first screen read
			    bland — all the visual energy sat below the fold with the phone).
			    Desktop's first screen already has the device, so md hides them. */}
			<div
				aria-hidden
				className="pointer-events-none absolute -top-16 right-[-12%] size-64 rounded-full bg-accent/15 blur-3xl md:hidden"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute left-[-18%] top-72 size-56 rounded-full bg-primary/10 blur-3xl md:hidden"
			/>
			<div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-24 md:grid-cols-[1.05fr_0.95fr] md:gap-10 md:px-8 md:pb-28 md:pt-40">
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

					{/* Mobile-only pain cluster: on md+ these two stickers float around
					    the phone (PhoneStage), which sits below the fold on a 375px
					    screen — so mobile gets them up here where the first impression
					    happens, and PhoneStage's copies hide below md. */}
					<div className="-mt-1 flex flex-wrap items-center gap-2.5 md:hidden">
						<FloatingBubble delay={1.0} className="">
							<Sticker tone="destructive" rotate={-3} className="text-[11px]">
								<BellOff className="size-3.5" />
								{m.hero_pain_missed()}
							</Sticker>
						</FloatingBubble>
						<FloatingBubble delay={1.25} className="">
							<span className="inline-flex rotate-2 rounded-2xl rounded-tr-sm border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-slate-800 shadow-md">
								{m.hero_pain_chase()}
							</span>
						</FloatingBubble>
					</div>

					<motion.h1
						variants={revealUp}
						className="tracking-display text-[2.75rem] font-bold leading-[0.98] sm:text-6xl md:text-7xl"
					>
						{m.hero_headline_part1()}{" "}
						<span className="kp-highlight animate-kp-highlight-sweep text-accent">
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
					    between three different commitments.

					    "Book a demo" rides beside it as an OUTLINE pill — the same
					    two-up the closing CTA uses, so the mint pill is still the only
					    primary. It moved here when the nav's right cluster was cut back
					    to three controls (owner, 29 Aug): a demo is a real intent for a
					    seller who wants a person before a trial, and it should be
					    answerable above the fold rather than only after scrolling the
					    whole page. Signed-in sellers don't see it — they're already
					    customers.

					    The row/stack breakpoints zig-zag on purpose: the hero is one
					    column until `md`, so two pills fit side by side at `sm`, but at
					    `md` the grid splits and the text column narrows to roughly 370px
					    — too tight for both, which wrapped EACH pill's label onto two
					    lines. So it stacks again through `md` and only returns to a row
					    at `lg`. No `whitespace-nowrap`: `final_cta` is 29 characters in
					    Malay and would overflow a 320px screen.

					    Both pills are `w-full` on a phone and `sm:w-fit` above it —
					    the hero CTA is the page's main thumb target, so it takes the
					    full column there, but a full-bleed pill on a desktop-width
					    column would read as a banner, not a button. */}
					<motion.div variants={revealUp} className="flex flex-col gap-3">
						{isSignedIn ? (
							<>
								<Link
									to="/app"
									className={`${ctaPillClass("accent")} w-full sm:w-fit`}
								>
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
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center md:flex-col md:items-start lg:flex-row lg:items-center">
									<Link
										to="/sign-up/$"
										params={{ _splat: "" }}
										className={`${ctaPillClass("accent")} w-full sm:w-fit`}
									>
										{m.final_cta()}
										<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
									</Link>
									<a
										href={buildWaContactLink(m.demo_wa_message(), supportWa)}
										target="_blank"
										rel="noopener noreferrer"
										className={`${ctaPillClass("outline")} w-full sm:w-fit`}
									>
										<WhatsAppIcon className="size-4" />
										{m.book_demo_cta()}
									</a>
								</div>
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
