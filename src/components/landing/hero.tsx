import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bell, Sparkles, Store } from "lucide-react";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";

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
		<div className="relative" role="img" aria-label={m.hero_phone_alt()}>
			<div className="relative h-[560px] w-[280px] rounded-[2.5rem] border-8 border-foreground/90 bg-foreground [filter:drop-shadow(0_32px_48px_hsl(222_47%_11%_/_0.14))]">
				<div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-foreground" />
				<div className="relative flex h-full w-full flex-col overflow-hidden rounded-[2rem] bg-[#ECE5DD]">
					<div className="flex items-center gap-3 bg-[#128C7E] px-4 py-3 pt-8 text-white">
						<div className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
							K
						</div>
						<div className="flex-1">
							<p className="text-sm font-semibold">{m.phone_store_name()}</p>
							<p className="text-[10px] text-white/80">
								{m.phone_store_status()}
							</p>
						</div>
					</div>
					<div className="flex flex-1 flex-col gap-2 p-3">
						<div className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 text-xs text-slate-800 shadow-sm">
							{m.phone_chat_1()}
						</div>
						<div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2 text-xs text-slate-800 shadow-sm">
							{m.phone_chat_2()}
						</div>
						<div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-white px-3 py-2 shadow-sm">
							<div className="flex items-center gap-2 border-b border-slate-200 pb-2">
								<div className="flex size-8 items-center justify-center rounded bg-accent/20">
									<Store className="size-4 text-accent" />
								</div>
								<div className="flex-1">
									<p className="text-[11px] font-semibold text-slate-800">
										{m.phone_store_name()}
									</p>
									<p className="text-[9px] text-slate-500">
										{m.phone_store_url()}
									</p>
								</div>
							</div>
							<p className="pt-2 text-[10px] font-semibold text-accent">
								{m.phone_store_cta()}
							</p>
						</div>
						<div className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 text-xs text-slate-800 shadow-sm">
							{m.phone_chat_3()}
						</div>
						<div className="max-w-[90%] self-end rounded-xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2 shadow-sm">
							<p className="text-[11px] font-bold text-slate-800">
								{m.phone_order_id()}
							</p>
							<div className="mt-1 space-y-0.5 text-[10px] text-slate-700">
								<p>• {m.phone_order_item()}</p>
								<p>• {m.phone_order_total()}</p>
							</div>
							<p className="mt-1 text-[9px] font-semibold text-[#128C7E]">
								{m.phone_order_status()}
							</p>
						</div>
					</div>
				</div>
			</div>
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
									<input
										type="text"
										value={slug}
										onChange={(e) =>
											setSlug(
												e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
											)
										}
										placeholder="yourstore"
										className="min-w-0 flex-1 bg-transparent py-3 pr-2 text-sm font-medium outline-none placeholder:text-muted-foreground/40"
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
