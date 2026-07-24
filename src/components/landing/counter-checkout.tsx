import { Check } from "lucide-react";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { FadeIn } from "./fade-in";
import { Eyebrow, QrPattern, Sticker } from "./landing-ui";

/**
 * "Counter checkout" — the landing section for pain #3 (the stall and the
 * chat don't talk). Left: a rendered CSS mock of the printable counter QR
 * poster. Right: claim + proof bullets. Mirrors the real poster feature
 * (`/app/poster`), so the section doubles as feature discovery.
 */
export function CounterCheckout() {
	const points = [
		m.counterqr_point_1(),
		m.counterqr_point_2(),
		m.counterqr_point_3(),
	];

	return (
		<section aria-labelledby="counterqr-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				<div className="grid items-center gap-12 md:grid-cols-[0.9fr_1.1fr] md:gap-16 lg:gap-20">
					<FadeIn className="order-2 md:order-1">
						<div aria-hidden="true" className="flex justify-center">
							<div className="relative">
								<div className="w-64 -rotate-2 rounded-3xl border-2 border-dashed border-foreground/20 bg-card p-7 text-center shadow-xl">
									<AppImage
										src="/logo-3.svg"
										alt=""
										aspect="mx-auto h-6 w-auto"
										fill={false}
									/>
									<QrPattern className="mx-auto mt-5 size-36" />
									<p className="mt-5 font-heading text-[15px] font-bold">
										{m.counterqr_poster_scan()}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										kedaipal.com/k-frozen-food
									</p>
								</div>
								<Sticker
									tone="primary"
									rotate={3}
									className="absolute -right-5 -top-3.5 text-[11px]"
								>
									{m.counterqr_poster_badge()}
								</Sticker>
							</div>
						</div>
					</FadeIn>

					<FadeIn delay={0.1} className="order-1 md:order-2">
						<Eyebrow>{m.counterqr_label()}</Eyebrow>
						<h2
							id="counterqr-heading"
							className="mt-4 text-3xl font-bold leading-[1.08] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.counterqr_heading()}
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
							{m.counterqr_body()}
						</p>
						<ul className="mt-7 space-y-3.5">
							{points.map((point) => (
								<li
									key={point}
									className="flex gap-3 text-[15px] leading-relaxed text-foreground/80"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-accent" />
									{point}
								</li>
							))}
						</ul>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
