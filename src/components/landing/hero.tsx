import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bell, Check } from "lucide-react";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { Input } from "../ui/input";
import { ctaPillClass, Marquee, Sticker } from "./landing-ui";
import { ResponsiveImage } from "./responsive-image";

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
	return m
		.hero_marquee()
		.split("·")
		.map((item) => item.trim())
		.filter(Boolean);
}

function SlugClaimForm() {
	const [slug, setSlug] = useState("");
	return (
		<div className="flex flex-col gap-3">
			<div className="flex h-16 items-center overflow-hidden rounded-full border border-border bg-card shadow-md transition-all duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_4px_hsl(160_84%_39%_/_0.12)]">
				<span className="select-none whitespace-nowrap pl-5 text-sm font-semibold text-muted-foreground">
					kedaipal.com/
				</span>
				<Input
					type="text"
					value={slug}
					onChange={(e) =>
						setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
					}
					placeholder="yourstore"
					variant="bare"
					className="min-w-0 flex-1 py-3 pr-2 text-sm font-semibold placeholder:text-muted-foreground/40"
				/>
				<Link
					to="/sign-up/$"
					params={{ _splat: slug ? `?store=${slug}` : "" }}
					className="m-2 flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent/90 sm:px-6"
				>
					<span className="hidden sm:inline">{m.hero_cta_primary()}</span>
					<ArrowRight className="size-4" />
				</Link>
			</div>
			<a
				href="#how"
				className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
			>
				{m.hero_cta_secondary()}
				<ArrowRight className="size-4" />
			</a>
		</div>
	);
}

function TrustLine() {
	const items = m.hero_trust().split("·");
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
	float = true,
}: {
	children: React.ReactNode;
	className?: string;
	delay?: number;
	float?: boolean;
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
				animate={float ? { y: [0, -7, 0] } : undefined}
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

	const phone = (
		<div className="relative rotate-[2deg]">
			<ResponsiveImage
				name="whatsapp"
				alt={m.hero_phone_alt()}
				widths={[280, 560, 840]}
				sizes="(max-width: 768px) 250px, 300px"
				width={953}
				height={1912}
				priority
				className="h-auto w-[250px] [filter:drop-shadow(0_32px_48px_hsl(222_47%_11%_/_0.16))] md:w-[300px]"
			/>
		</div>
	);

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

			{/* Incoming order bubble */}
			<FloatingBubble
				delay={0.9}
				className="absolute -left-6 top-12 sm:-left-14"
			>
				<div className="w-44 -rotate-3 rounded-2xl rounded-tl-sm border border-border bg-card p-3 shadow-lg">
					<p className="text-[11px] font-bold text-foreground">ORD-0042</p>
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
						{m.hero_bubble_order_items()}
					</p>
					<p className="mt-1 text-[11px] font-bold text-accent">RM 76.00 ✓</p>
				</div>
			</FloatingBubble>

			{/* New order sticker */}
			<FloatingBubble
				delay={1.15}
				className="absolute -right-3 top-2 sm:-right-10"
			>
				<Sticker tone="accent" rotate={4} className="text-[11px]">
					<Bell className="size-3.5" />
					{m.hero_phone_badge()}
				</Sticker>
			</FloatingBubble>

			{/* Paid bubble — WhatsApp green */}
			<FloatingBubble
				delay={1.35}
				className="absolute -right-4 bottom-16 sm:-right-12"
			>
				<div className="rotate-2 rounded-2xl rounded-tr-sm border border-border bg-[#DCF8C6] px-3 py-2 shadow-lg">
					<p className="text-[11px] font-bold text-slate-800">
						{m.hero_bubble_paid_title()}
					</p>
					<p className="mt-0.5 text-[10px] font-semibold text-emerald-700">
						{m.hero_bubble_paid_sub()}
					</p>
				</div>
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

					<motion.div variants={revealUp}>
						{isSignedIn ? (
							<div className="flex flex-col gap-3 sm:flex-row">
								<Link to="/app" className={ctaPillClass("accent")}>
									{m.nav_go_to_dashboard()}
									<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
								</Link>
								<a href="#how" className={ctaPillClass("outline")}>
									{m.hero_cta_secondary()}
								</a>
							</div>
						) : (
							<SlugClaimForm />
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
