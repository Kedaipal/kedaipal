import { CalendarCheck, ChefHat, Fish, QrCode, Star } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "Real sellers, real orders" proof bar. Replaces the old placeholder
 * testimonial section (dead code, never mounted) — instead of fabricated
 * quotes we don't have consent for yet, this proves the pattern with real
 * (unnamed) seller archetypes, one honest stat card, and — with K Frozen
 * Food's consent — one real named + logo'd customer. See
 * `messages/en.json` → `proof_*` for the copy and `proof_disclaimer` for the
 * no-fake-testimonials commitment.
 */
export function RealSellers() {
	const archetypes = [
		{
			icon: QrCode,
			label: m.proof_card_1_label(),
			heading: m.proof_card_1_heading(),
			body: m.proof_card_1_body(),
		},
		{
			icon: ChefHat,
			label: m.proof_card_2_label(),
			heading: m.proof_card_2_heading(),
			body: m.proof_card_2_body(),
		},
		{
			icon: Fish,
			label: m.proof_card_3_label(),
			heading: m.proof_card_3_heading(),
			body: m.proof_card_3_body(),
		},
		{
			icon: CalendarCheck,
			label: m.proof_card_4_label(),
			heading: m.proof_card_4_heading(),
			body: m.proof_card_4_body(),
		},
	];

	return (
		<section aria-labelledby="proof-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
					<div className="lg:max-w-xl">
						<Eyebrow>{m.proof_label()}</Eyebrow>
						<h2
							id="proof-heading"
							className="mt-4 text-3xl font-bold md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.proof_heading()}
						</h2>
					</div>
					<p className="text-base leading-relaxed text-muted-foreground md:text-lg lg:max-w-sm lg:pt-2 lg:text-right">
						{m.proof_sub()}
					</p>
				</div>

				<div className="mt-12 grid gap-5 md:mt-14 lg:grid-cols-3">
					<div className="grid gap-5 sm:grid-cols-2 lg:col-span-2">
						{archetypes.map((a, i) => (
							<FadeIn key={a.label} delay={i * 0.08} className="h-full">
								<div className="h-full rounded-3xl border border-border bg-card p-7 shadow-sm transition-shadow duration-200 hover:shadow-md">
									<div className="flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
										<a.icon className="size-6" />
									</div>
									<p className="mt-4 text-xs font-bold uppercase tracking-wider text-accent">
										{a.label}
									</p>
									<h3 className="mt-1 text-lg font-semibold">{a.heading}</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{a.body}
									</p>
								</div>
							</FadeIn>
						))}
					</div>

					<FadeIn delay={0.32}>
						<div className="flex h-full flex-col rounded-3xl bg-cta-mesh p-7 text-cta-mesh-foreground shadow-lg md:p-9">
							<p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-accent">
								<Star className="size-3.5 fill-accent" aria-hidden />
								{m.proof_stat_label()}
							</p>
							<h3
								className="mt-4 text-xl font-bold md:text-2xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.proof_stat_heading()}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-cta-mesh-foreground/65">
								{m.proof_stat_body()}
							</p>
							<div className="mt-6 space-y-3 border-t border-white/10 pt-5">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm text-cta-mesh-foreground/65">
										{m.proof_stat_1_label()}
									</span>
									<span className="text-base font-bold">
										{m.proof_stat_1_value()}
									</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm text-cta-mesh-foreground/65">
										{m.proof_stat_2_label()}
									</span>
									<span className="text-base font-bold">
										{m.proof_stat_2_value()}
									</span>
								</div>
							</div>
						</div>
					</FadeIn>
				</div>

				<FadeIn
					delay={0.4}
					className="mt-10 flex flex-col items-center gap-3 text-center md:mt-12"
				>
					<div className="inline-flex items-center gap-3 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-4 shadow-sm">
						<img
							src="/img/landing/k-frozen-food-logo.png"
							alt={m.proof_live_customer_alt()}
							width={40}
							height={40}
							loading="lazy"
							className="size-10 shrink-0 rounded-full object-cover"
						/>
						<div className="text-left">
							<p className="text-sm font-bold leading-tight">
								{m.proof_live_customer_name()}
							</p>
							<p className="text-xs leading-tight text-muted-foreground">
								{m.proof_live_customer_caption()}
							</p>
						</div>
					</div>
					<p className="max-w-xl text-xs text-muted-foreground">
						{m.proof_disclaimer()}
					</p>
				</FadeIn>
			</div>
		</section>
	);
}
