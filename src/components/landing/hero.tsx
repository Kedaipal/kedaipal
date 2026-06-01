import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bell, Sparkles } from "lucide-react";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ResponsiveImage } from "./responsive-image";

const staggerContainer = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const EASE = [0.22, 1, 0.36, 1] as const;

const revealUp = {
	hidden: { opacity: 0, y: 24 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.6, ease: EASE },
	},
};

function PhoneMockupContent() {
	return (
		<div className="relative">
			<ResponsiveImage
				name="whatsapp"
				alt={m.hero_phone_alt()}
				widths={[280, 560, 840]}
				sizes="(max-width: 768px) 260px, 300px"
				width={953}
				height={1912}
				priority
				className="h-auto w-[260px] md:w-[300px] [filter:drop-shadow(0_32px_48px_hsl(222_47%_11%_/_0.14))]"
			/>
			<div className="absolute -right-4 top-24 hidden rounded-xl border border-border bg-card px-3 py-2 shadow-lg md:block motion-reduce:transform-none">
				<div className="flex items-center gap-2">
					<Bell className="size-4 text-accent" />
					<span className="text-xs font-semibold">{m.hero_phone_badge()}</span>
				</div>
			</div>
		</div>
	);
}

function PhoneMockup() {
	const shouldReduceMotion = useReducedMotion();

	if (shouldReduceMotion) {
		return <PhoneMockupContent />;
	}

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.96, y: 16 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
		>
			<motion.div
				animate={{ y: [0, -8, 0] }}
				transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
			>
				<PhoneMockupContent />
			</motion.div>
		</motion.div>
	);
}

export function Hero() {
	const { isSignedIn } = useAuth();
	const [slug, setSlug] = useState("");
	const shouldReduceMotion = useReducedMotion();

	return (
		<section id="top" className="relative overflow-hidden bg-hero-mesh">
			<div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 md:grid-cols-2 md:gap-16 md:px-8 md:py-36 md:pb-32">
				<motion.div
					className="flex flex-col justify-center gap-7"
					initial={shouldReduceMotion ? undefined : "hidden"}
					animate={shouldReduceMotion ? undefined : "visible"}
					variants={staggerContainer}
				>
					<motion.span
						variants={revealUp}
						className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent"
					>
						<Sparkles className="size-3" />
						{m.hero_badge()}
					</motion.span>

					<motion.h1
						variants={revealUp}
						className="text-4xl font-bold leading-[0.95] md:text-7xl"
						style={{ letterSpacing: "-0.04em" }}
					>
						{m.hero_headline_part1()}{" "}
						<span className="text-accent">{m.hero_headline_part2()}</span>
					</motion.h1>

					<motion.p
						variants={revealUp}
						className="max-w-lg text-lg leading-relaxed text-muted-foreground"
					>
						{m.hero_subhead()}
					</motion.p>

					<motion.div variants={revealUp} className="flex flex-col gap-3">
						{isSignedIn ? (
							<div className="flex flex-col gap-3 sm:flex-row">
								<Button asChild size="lg" className="h-12 px-6 text-base">
									<Link to="/app">
										{m.nav_go_to_dashboard()}
										<ArrowRight />
									</Link>
								</Button>
								<Button
									asChild
									variant="outline"
									size="lg"
									className="h-12 px-6 text-base"
								>
									<a href="#how">{m.hero_cta_secondary()}</a>
								</Button>
							</div>
						) : (
							<>
								<div className="flex h-14 items-center overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_3px_hsl(160_84%_39%_/_0.12)]">
									<span className="select-none whitespace-nowrap pl-4 text-sm font-medium text-muted-foreground">
										kedaipal.com/
									</span>
									<Input
										type="text"
										value={slug}
										onChange={(e) =>
											setSlug(
												e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
											)
										}
										placeholder="yourstore"
										variant="bare"
										className="min-w-0 flex-1 py-3 pr-2 text-sm font-medium placeholder:text-muted-foreground/40"
									/>
									<Button
										asChild
										size="sm"
										className="m-1.5 shrink-0 px-3 sm:px-5"
									>
										<Link
											to="/sign-up/$"
											params={{ _splat: slug ? `?store=${slug}` : "" }}
										>
											<span className="hidden sm:inline">Claim this store</span>
											<ArrowRight className="sm:hidden" />
										</Link>
									</Button>
								</div>
								<Button
									asChild
									variant="ghost"
									className="h-auto self-start px-0 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-transparent"
								>
									<a href="#how">
										{m.hero_cta_secondary()}{" "}
										<ArrowRight className="ml-1 size-4" />
									</a>
								</Button>
							</>
						)}
					</motion.div>

					<motion.p
						variants={revealUp}
						className="text-xs text-muted-foreground/60"
					>
						{m.hero_trust()}
					</motion.p>
				</motion.div>

				<div className="flex items-center justify-center">
					<PhoneMockup />
				</div>
			</div>
		</section>
	);
}
