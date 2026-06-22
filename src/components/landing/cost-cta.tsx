import { Link } from "@tanstack/react-router";
import { ArrowRight, Calculator } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";

/** Ticket-style banner linking to the cost calculator. */
export function CostCta() {
	return (
		<section aria-label={m.costcta_aria()} className="bg-background">
			<div className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-20">
				<FadeIn>
					<Link
						to="/cost"
						className="kp-ticket-border group relative flex w-full flex-col items-center gap-5 rounded-3xl bg-card px-6 py-9 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/50 hover:shadow-xl sm:flex-row sm:text-left md:px-10"
					>
						{/* Ticket punch holes */}
						<span
							aria-hidden
							className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full border-r-2 border-dashed border-foreground/20 bg-background"
						/>
						<span
							aria-hidden
							className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full border-l-2 border-dashed border-foreground/20 bg-background"
						/>

						<div className="flex size-16 shrink-0 -rotate-3 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-md transition-transform duration-200 group-hover:rotate-3">
							<Calculator className="size-8" />
						</div>
						<div className="flex-1">
							<p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
								{m.costcta_label()}
							</p>
							<p
								className="mt-1.5 text-2xl font-bold text-foreground md:text-3xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.costcta_heading_1()}{" "}
								<span className="text-destructive">
									{m.costcta_heading_2()}
								</span>{" "}
								<ArrowRight className="inline size-6 align-middle transition-transform group-hover:translate-x-1.5" />
							</p>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{m.costcta_sub()}
							</p>
						</div>
					</Link>
				</FadeIn>
			</div>
		</section>
	);
}
