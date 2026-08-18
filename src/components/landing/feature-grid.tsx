import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { carouselSlideClass, carouselTrackClass, Eyebrow } from "./landing-ui";

/**
 * Features bento — every card pairs its claim with a small rendered
 * CSS mock of the real surface (no icons, no rasters), matching the
 * how-it-works mockup philosophy. Mocks are decorative (`aria-hidden`).
 *
 * Layout: 3-column bento tiling as [2+1], [1+2], [1+1+1] — the design's
 * source order kept, with the inbox card at span-1 (mock stacked below
 * text) so the grid tiles without holes. On mobile the seven cards are a
 * snap carousel, not a stack — stacked they alone ran ~4 screens tall.
 * One FadeIn wraps the whole track (per-card stagger died with the
 * carousel; see `carouselTrackClass` for why slides can't self-FadeIn).
 */

/** Tiny QR square for the counter-checkout card. */
function MiniQr() {
	return (
		<span className="grid size-10 shrink-0 grid-cols-4 grid-rows-4 gap-0.5 rounded-md bg-foreground p-1">
			{Array.from({ length: 16 }).map((_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: static decorative grid, never reorders
					key={i}
					className={cn(
						"rounded-[1px]",
						i % 3 === 0 || i % 5 === 0 ? "bg-background" : "bg-transparent",
					)}
				/>
			))}
		</span>
	);
}

function CardShell({
	children,
	dark = false,
	span = false,
}: {
	children: React.ReactNode;
	dark?: boolean;
	span?: boolean;
}) {
	return (
		<div className={carouselSlideClass(cn("h-full", span && "lg:col-span-2"))}>
			<div
				className={cn(
					"flex h-full flex-col rounded-3xl border p-7 transition-all duration-200 motion-reduce:hover:translate-y-0",
					dark
						? "border-transparent bg-cta-mesh text-cta-mesh-foreground shadow-lg"
						: "border-border bg-card shadow-sm hover:-translate-y-1 hover:shadow-xl hover:ring-1 hover:ring-accent/25",
				)}
			>
				{children}
			</div>
		</div>
	);
}

export function FeatureGrid() {
	return (
		<section
			id="features"
			aria-labelledby="features-heading"
			className="bg-background"
			style={{
				backgroundImage:
					"radial-gradient(ellipse 100% 80% at 50% 50%, hsl(160 84% 39% / 0.04), transparent)",
			}}
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<Eyebrow className="justify-center">{m.features_label()}</Eyebrow>
					<h2
						id="features-heading"
						className="mt-4 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.features_heading()}
					</h2>
					<p className="mt-4 text-lg leading-relaxed text-muted-foreground">
						{m.features_sub()}
					</p>
				</div>

				<FadeIn className="mt-14">
					<div
						className={carouselTrackClass(
							"md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3",
						)}
					>
						{/* Payment handshake & receipts — the dark hero card */}
						<CardShell dark span>
							<div className="grid h-full items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
								<div>
									<h3 className="text-xl font-semibold">
										{m.bento_handshake_title()}
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-cta-mesh-foreground/65">
										{m.bento_handshake_body()}
									</p>
								</div>
								<div
									aria-hidden="true"
									className="rounded-2xl bg-white p-3.5 text-slate-900 shadow-xl"
								>
									<div className="flex items-center justify-between gap-2">
										<p className="text-xs font-bold">ORD-0042 · RM 76.00</p>
										<span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
											{m.handshake_card_badge()}
										</span>
									</div>
								{/* flex-wrap: at carousel-slide width the two labels don't fit
									    one line, and a fixed-height pill clips wrapped text — let
									    the row break to two full-width pills instead. */}
									<div className="mt-2.5 flex flex-wrap gap-1.5">
										<span className="flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-full bg-accent px-3 text-[11.5px] font-bold text-accent-foreground">
											{m.handshake_card_confirm()}
										</span>
										<span className="flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 px-3 text-[11.5px] font-semibold text-slate-500">
											{m.handshake_card_decline()}
										</span>
									</div>
								</div>
							</div>
						</CardShell>

						{/* Counter checkout */}
						<CardShell>
							<h3 className="text-xl font-semibold">
								{m.bento_counter_title()}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.bento_counter_body()}
							</p>
							<div
								aria-hidden="true"
								className="mt-auto flex items-center gap-3 pt-4"
							>
								<MiniQr />
								<span className="text-[12.5px] font-semibold text-foreground/80">
									{m.bento_counter_chip()}{" "}
									<span className="font-mono font-bold text-accent-emphasis">
										K7
									</span>
								</span>
							</div>
						</CardShell>

						{/* Hosted storefront */}
						<CardShell>
							<h3 className="text-xl font-semibold">
								{m.bento_storefront_title()}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.bento_storefront_body()}
							</p>
							<div aria-hidden="true" className="mt-auto pt-4">
								<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3.5 py-2 text-[12.5px] font-semibold text-foreground/80">
									<span className="text-accent">●</span> kedaipal.com/
									<strong className="font-bold text-accent-emphasis">
										k-frozen-food
									</strong>
								</span>
							</div>
						</CardShell>

						{/* Built for made-to-order */}
						<CardShell span>
							<div className="grid h-full items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
								<div>
									<h3 className="text-xl font-semibold">
										{m.bento_mto_title()}
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{m.bento_mto_body()}
									</p>
								</div>
								<div aria-hidden="true" className="flex flex-col gap-2">
									<span className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-[12.5px] font-semibold text-foreground/80">
										{m.bento_mto_row_date()}
										<span className="text-accent-emphasis">Sat 25 Jul</span>
									</span>
									<span className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-[12.5px] font-semibold text-foreground/80">
										{m.bento_mto_row_mockup()}
										<span className="text-accent-emphasis">
											{m.bento_mto_row_mockup_value()}
										</span>
									</span>
									<span className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-[12.5px] font-semibold text-foreground/80">
										{m.bento_mto_row_min()}
										<span className="text-muted-foreground">
											{m.bento_mto_row_min_value()}
										</span>
									</span>
								</div>
							</div>
						</CardShell>

						{/* Variants */}
						<CardShell>
							<h3 className="text-xl font-semibold">
								{m.bento_variants_title()}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.bento_variants_body()}
							</p>
							<div
								aria-hidden="true"
								className="mt-auto flex flex-wrap gap-1.5 pt-4"
							>
								<span className="rounded-full border-2 border-foreground px-3 py-1 text-xs font-bold">
									500g
								</span>
								<span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground/80">
									1kg
								</span>
								<span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground/50 line-through">
									2kg
								</span>
							</div>
						</CardShell>

						{/* Delivery & pickup */}
						<CardShell>
							<h3 className="text-xl font-semibold">
								{m.bento_delivery_title()}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.bento_delivery_body()}
							</p>
							<div
								aria-hidden="true"
								className="mt-auto flex flex-wrap gap-1.5 pt-4"
							>
								<span className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent-emphasis">
									{m.bento_delivery_chip_free()}
								</span>
								<span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-foreground/80">
									{m.bento_delivery_chip_rider()}
								</span>
							</div>
						</CardShell>

						{/* Order inbox + customer memory */}
						<CardShell>
							<h3 className="text-xl font-semibold">{m.bento_inbox_title()}</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.bento_inbox_body()}
							</p>
							<div
								aria-hidden="true"
								className="mt-auto rounded-2xl border border-border p-3.5 shadow-sm"
							>
								<div className="flex items-center gap-2.5">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 font-heading text-xs font-extrabold text-accent-emphasis">
										AR
									</span>
									<div className="min-w-0">
										<p className="truncate text-[13px] font-bold">
											Aisyah Rahim
										</p>
										<p className="truncate text-[11.5px] text-muted-foreground">
											{m.bento_inbox_stats()}
										</p>
									</div>
								</div>
								<p className="mt-2.5 truncate rounded-lg bg-muted/70 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
									{m.bento_inbox_note()}
								</p>
							</div>
						</CardShell>
					</div>
				</FadeIn>

				<p className="mt-8 text-center">
					<a
						href="#pricing"
						className="text-sm font-medium text-accent underline-offset-4 hover:underline"
					>
						{m.features_full_list()}
					</a>
				</p>
			</div>
		</section>
	);
}
