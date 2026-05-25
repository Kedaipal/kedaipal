import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "../ui/button";
import { FadeIn } from "./fade-in";

const TOTAL_SPOTS = 10;
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
							Founding members lock in the lowest price that will ever exist,
							get direct influence over the product roadmap, and become part of
							the origin story of the order hub built for Malaysian F&amp;B
							sellers.
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
						<span className="font-bold text-foreground">{remaining}</span> of{" "}
						{TOTAL_SPOTS} founding spots still open
					</p>
				</FadeIn>

				<FadeIn delay={0.15}>
					<div className="mt-10 grid gap-5 sm:grid-cols-3">
						{[
							{
								label: "Locked-in pricing",
								body: "Pay the founder rate forever — the lowest price that will ever exist for Kedaipal.",
							},
							{
								label: "Direct product input",
								body: "Your workflow shapes the roadmap. Founding members get a direct line to the builder.",
							},
							{
								label: "Origin story",
								body: "Your business is featured as a Kedaipal founding seller — the ones who were here first.",
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
									Apply for a founding spot
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
