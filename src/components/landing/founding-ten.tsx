import { ArrowRight, Star } from "lucide-react";
import { buildWaContactLink } from "../../lib/contact";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { ctaPillClass, Sticker } from "./landing-ui";

const TOTAL_SPOTS = 10;
const SPOTS_TAKEN = 0;

const SPOTS = Array.from({ length: TOTAL_SPOTS }, (_, i) => ({
	n: i + 1,
	taken: i < SPOTS_TAKEN,
}));

export function FoundingTen() {
	const remaining = TOTAL_SPOTS - SPOTS_TAKEN;

	const perks = [
		{ label: m.founding_perk_1_label(), body: m.founding_perk_1_body() },
		{ label: m.founding_perk_2_label(), body: m.founding_perk_2_body() },
		{ label: m.founding_perk_3_label(), body: m.founding_perk_3_body() },
	];

	return (
		<section aria-labelledby="founding-ten-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<FadeIn>
					{/* Membership-card panel */}
					<div className="relative overflow-hidden rounded-[2rem] bg-cta-mesh px-6 py-14 text-primary-foreground shadow-2xl md:px-14 md:py-20">
						{/* Decorative rings */}
						<div
							aria-hidden
							className="pointer-events-none absolute -right-24 -top-24 size-[300px] rounded-full border border-white/[0.06]"
						/>
						<div
							aria-hidden
							className="pointer-events-none absolute -bottom-32 -left-16 size-[360px] rounded-full border border-white/[0.05]"
						/>

						<div className="relative mx-auto max-w-2xl text-center">
							<Sticker tone="accent" rotate={-1.5}>
								<Star className="size-3 fill-current" />
								{m.founding_label()}
							</Sticker>
							<h2
								id="founding-ten-heading"
								className="mt-5 text-3xl font-bold tracking-tight md:text-4xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.founding_heading()}
							</h2>
							<p className="mt-4 text-base leading-relaxed text-primary-foreground/65">
								{m.founding_sub()}
							</p>
						</div>

						<div className="relative mt-12 grid grid-cols-5 gap-2.5 sm:grid-cols-10 sm:gap-3">
							{SPOTS.map(({ n, taken }) => (
								<div
									key={n}
									className={cn(
										"flex aspect-square flex-col items-center justify-center rounded-2xl border-2 text-sm font-bold transition-colors",
										taken
											? "border-accent bg-accent/20 text-accent"
											: "border-dashed border-white/20 text-white/40",
									)}
								>
									<span className="sr-only">
										{taken
											? m.founding_spot_taken({ n })
											: m.founding_spot_open({ n })}
									</span>
									{taken ? (
										<span aria-hidden className="text-lg">
											✓
										</span>
									) : (
										<span aria-hidden>{n}</span>
									)}
								</div>
							))}
						</div>
						<p className="relative mt-4 text-center text-sm font-medium text-primary-foreground/60">
							{m.founding_remaining({ remaining, total: TOTAL_SPOTS })}
						</p>

						<div className="relative mt-10 grid gap-4 sm:grid-cols-3">
							{perks.map((item) => (
								<div
									key={item.label}
									className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm"
								>
									<p className="text-sm font-bold">{item.label}</p>
									<p className="mt-1.5 text-sm leading-relaxed text-primary-foreground/60">
										{item.body}
									</p>
								</div>
							))}
						</div>

						<div className="relative mt-10 flex justify-center">
							{/* Applying for a founding spot is a conversation, not a signup —
							    open a WhatsApp chat with a prefilled message. */}
							<a
								href={buildWaContactLink(m.founding_wa_message())}
								target="_blank"
								rel="noopener noreferrer"
								className={ctaPillClass("accent")}
							>
								{m.founding_cta()}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</a>
						</div>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
