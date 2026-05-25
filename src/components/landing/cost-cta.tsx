import { Link } from "@tanstack/react-router";
import { ArrowRight, Calculator } from "lucide-react";
import { FadeIn } from "./fade-in";

export function CostCta() {
	return (
		<section aria-label="Cost calculator" className="border-b border-border/60">
			<div className="mx-auto max-w-6xl px-5 py-12 md:px-8 md:py-16">
				<FadeIn>
					<Link
						to="/cost"
						className="group flex w-full flex-col items-center gap-4 rounded-2xl border border-accent/30 bg-accent/5 px-6 py-8 text-center transition-colors hover:border-accent/60 hover:bg-accent/10 sm:flex-row sm:text-left md:px-10 md:py-10"
					>
						<div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
							<Calculator className="size-7" />
						</div>
						<div className="flex-1">
							<p className="text-xs font-semibold uppercase tracking-widest text-accent">
								Free calculator
							</p>
							<p className="mt-1 text-xl font-bold text-foreground md:text-2xl">
								Calculate what WhatsApp is costing you{" "}
								<ArrowRight className="inline size-5 align-middle transition-transform group-hover:translate-x-1" />
							</p>
							<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
								Missed orders + payment-chasing time, in ringgit. Takes 60
								seconds.
							</p>
						</div>
					</Link>
				</FadeIn>
			</div>
		</section>
	);
}
