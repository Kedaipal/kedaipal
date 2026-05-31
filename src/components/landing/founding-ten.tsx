import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "../ui/button";
import { FadeIn } from "./fade-in";

const TOTAL_SPOTS = 10;
// Hardcoded to 0 until the 86expn2qg billing build ships the live
// `api.foundingTen.spotsTaken` query. When that lands, swap this constant
// for a useQuery call — three render sites (this block, the pricing-teaser
// Pro pill, the pricing-page banner) read off the same source.
const SPOTS_TAKEN = 0;

const SPOTS = Array.from({ length: TOTAL_SPOTS }, (_, i) => ({
	n: i + 1,
	taken: i < SPOTS_TAKEN,
}));

export function FoundingTen() {
	const { isSignedIn } = useAuth();
	const remaining = TOTAL_SPOTS - SPOTS_TAKEN;

	return (
		<section
			aria-labelledby="founding-ten-heading"
			className="border-b border-border/60 bg-accent/[0.03]"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<FadeIn>
					<div className="mx-auto max-w-2xl text-center">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
							<Star className="size-3 fill-accent" />
							Founding 10
						</span>
						<h2
							id="founding-ten-heading"
							className="mt-4 text-3xl font-bold tracking-tight md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							The first 10 businesses that build Kedaipal with us.
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground">
							First 10 paying Pro retailers lock in{" "}
							<span className="font-semibold text-foreground">
								30% off for life — RM 104/mo Pro forever
							</span>{" "}
							— plus a Founding Member badge, direct input on the roadmap, and
							white-glove onboarding. When the 10 spots are gone, they&apos;re
							gone.
						</p>
					</div>
				</FadeIn>

				<FadeIn delay={0.1}>
					<div className="mt-12 grid grid-cols-5 gap-3 sm:grid-cols-10">
						{SPOTS.map(({ n, taken }) => (
							<div
								key={n}
								className={`flex aspect-square flex-col items-center justify-center rounded-2xl border text-xs font-bold transition-colors ${
									taken
										? "border-accent/40 bg-accent/10 text-accent"
										: "border-border/60 bg-card text-muted-foreground/40"
								}`}
								aria-label={taken ? `Spot ${n} — taken` : `Spot ${n} — open`}
							>
								{taken ? (
									<span className="text-lg">✓</span>
								) : (
									<span>{n}</span>
								)}
							</div>
						))}
					</div>
					<p className="mt-4 text-center text-sm font-medium text-muted-foreground">
						<span className="font-bold text-foreground">
							{remaining} of {TOTAL_SPOTS}
						</span>{" "}
						Founding spots open — RM 104/mo Pro forever
					</p>
				</FadeIn>

				<FadeIn delay={0.15}>
					<div className="mt-10 grid gap-5 sm:grid-cols-3">
						{[
							{
								label: "Locked-in price forever",
								body: "RM 104/mo Pro — 30% off the standard rate, for as long as you stay subscribed. No renewals, no price hikes.",
							},
							{
								label: "Direct line to the founder",
								body: "WhatsApp group with Arif. Roadmap input, feature requests, bugs — straight to the builder, no support queue.",
							},
							{
								label: "Founding Member badge",
								body: "Your business listed as a Kedaipal founding seller. The ones who were here on day one.",
							},
						].map((item) => (
							<div
								key={item.label}
								className="rounded-2xl border border-border bg-card p-5"
							>
								<p className="text-sm font-bold text-foreground">{item.label}</p>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
									{item.body}
								</p>
							</div>
						))}
					</div>
				</FadeIn>

				<FadeIn delay={0.2}>
					<div className="mt-10 flex justify-center">
						<Button asChild size="lg" className="h-12 px-8 text-base">
							{isSignedIn ? (
								<Link to="/app">
									Go to dashboard
									<ArrowRight className="ml-2 size-4" />
								</Link>
							) : (
								<Link to="/sign-up/$" params={{ _splat: "" }}>
									Claim a Founding 10 spot
									<ArrowRight className="ml-2 size-4" />
								</Link>
							)}
						</Button>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
