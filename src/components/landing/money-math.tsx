import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "The money math" (ClickUp 86eye3p6z §A) — the cost context a visitor needs
 * BEFORE they meet RM79/149/299, mounted directly above the pricing teaser.
 *
 * This is a POSITIONING claim, not a savings claim, and the copy is written to
 * stay on the right side of that line. A seller's WhatsApp orders already cost
 * them 0%, so Kedaipal is an added cost on those orders — the page may say "we
 * never take a cut at any volume", it may NOT say "save RM900 vs Shopee".
 * Shopee leads (a marketplace, like us) rather than GrabFood, whose 15–22% also
 * buys a rider fleet we don't provide. `mm_note` carries that caveat in full.
 *
 * The calculator lives at the EXISTING `/cost` page rather than a second `/kira`
 * route — `/cost` already runs the exact formula (`src/lib/calculator.ts`), is
 * SSR'd, localised and shareable via prefill params, so a parallel page would be
 * two things to keep in sync for zero gain.
 */

/**
 * Published 2026 rates (verified on the ticket). `pct` is the TOP of each
 * published range and only drives bar width — the visible label is the honest
 * range. Shopee is "up to ~20%", never a flat "20%": its commission is
 * category-based and the 5.5% Free Shipping slice is opt-in.
 */
const MARKETPLACE_RATES = [
	{ id: "shopee", name: "Shopee", pct: 20, rate: () => m.mm_rate_shopee() },
	{ id: "grabfood", name: "GrabFood", pct: 22, rate: () => "15–22%" },
	{ id: "foodpanda", name: "foodpanda", pct: 20, rate: () => "12–20%" },
] as const;

const MAX_PCT = 22;

export function MoneyMath() {
	return (
		<section
			id="money-math"
			aria-labelledby="money-math-heading"
			className="bg-background"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
					<FadeIn>
						<div>
							<Eyebrow>{m.mm_label()}</Eyebrow>
							<h2
								id="money-math-heading"
								className="mt-4 text-3xl font-bold leading-[1.08] md:text-5xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.mm_heading()}
							</h2>
							<p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">
								{m.mm_line2_pre()}{" "}
								<strong className="font-bold text-accent-emphasis">
									{m.mm_line2_zero()}
								</strong>{" "}
								{m.mm_line2_post()}
							</p>
							<p
								className="mt-3 text-xl font-bold md:text-2xl"
								style={{ letterSpacing: "-0.01em" }}
							>
								{m.mm_line3()}
							</p>
							<div className="mt-7">
								{/* A text link, not a button — the page has exactly one
								    primary CTA and it is "Start 14-day free trial". */}
								<Link
									to="/cost"
									className="group inline-flex items-center gap-1.5 text-base font-semibold text-accent underline-offset-4 hover:underline"
								>
									{m.mm_cta()}
									<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
								</Link>
								<p className="mt-1.5 text-xs text-muted-foreground">
									{m.mm_cta_note()}
								</p>
							</div>
						</div>
					</FadeIn>

					<FadeIn delay={0.1}>
						<div className="rounded-3xl border border-border bg-card p-6 shadow-lg md:p-8">
							<p className="text-sm font-semibold text-muted-foreground">
								{m.mm_line1()}
							</p>
							<div className="mt-5 flex flex-col gap-3">
								{MARKETPLACE_RATES.map((row) => (
									<div
										key={row.id}
										className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]"
									>
										<span className="text-[13px] font-semibold">
											{row.name}
										</span>
										<div className="relative h-9 overflow-hidden rounded-full bg-muted">
											<span
												className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-destructive/10 pr-3.5 text-[13px] font-bold text-red-700 dark:text-red-300"
												style={{ width: `${(row.pct / MAX_PCT) * 100}%` }}
											>
												{row.rate()}
											</span>
										</div>
									</div>
								))}
								<div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
									<span className="text-[13px] font-extrabold text-accent-emphasis">
										Kedaipal
									</span>
									<div className="flex h-9 items-center gap-3 overflow-hidden rounded-full bg-muted">
										<span className="flex h-9 min-w-16 items-center justify-center rounded-full bg-accent px-4 text-sm font-extrabold text-accent-foreground">
											0%
										</span>
										<span className="truncate text-xs font-semibold text-accent-emphasis">
											{m.mm_bar_kedaipal_value()}
										</span>
									</div>
								</div>
							</div>
							<p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
								{m.mm_note()}
							</p>
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

/**
 * One-line variant for `/pricing`, where the tier cards are already the focus —
 * the same rates, no chart, sitting between the hero and the cards so the
 * numbers below arrive with context.
 */
export function MoneyMathRow() {
	return (
		<section aria-label={m.mm_label()} className="bg-background">
			<div className="mx-auto max-w-6xl px-5 md:px-8">
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-7 gap-y-3 rounded-3xl border border-border bg-card px-6 py-5 shadow-sm">
					{MARKETPLACE_RATES.map((row) => (
						<span
							key={row.id}
							className="text-[13px] font-semibold text-muted-foreground"
						>
							{row.name}{" "}
							<strong className="font-bold text-red-700 dark:text-red-300">
								{row.rate()}
							</strong>
						</span>
					))}
					<span
						aria-hidden
						className="hidden h-5 w-px bg-border sm:inline-block"
					/>
					<span className="inline-flex items-center gap-2 text-[13px] font-bold">
						Kedaipal
						<span className="rounded-full bg-accent px-3 py-0.5 text-[13px] font-extrabold text-accent-foreground">
							0%
						</span>
						<span className="font-semibold text-accent-emphasis">
							{m.mm_bar_kedaipal_value()}
						</span>
					</span>
					<Link
						to="/cost"
						className="text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
					>
						{m.mm_cta()} →
					</Link>
				</div>
			</div>
		</section>
	);
}
