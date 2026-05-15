import { MessageCircle, Package, Store } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";

export function ProblemStrip() {
	const problems = [
		{
			icon: MessageCircle,
			title: m.problem_1_title(),
			body: m.problem_1_body(),
		},
		{
			icon: Package,
			title: m.problem_2_title(),
			body: m.problem_2_body(),
		},
		{
			icon: Store,
			title: m.problem_3_title(),
			body: m.problem_3_body(),
		},
	];

	return (
		<section
			aria-labelledby="problem-heading"
			className="border-b border-border/60 bg-problem-warm"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<h2
					id="problem-heading"
					className="mx-auto max-w-2xl text-center text-3xl font-bold md:text-5xl"
					style={{ letterSpacing: "-0.02em" }}
				>
					{m.problem_heading()}
				</h2>

				<div className="mt-16 divide-y divide-border/60">
					{problems.map((p, i) => (
						<FadeIn key={p.title} delay={i * 0.1}>
							<div className="relative flex gap-6 py-10 md:gap-10 md:py-12">
								<span
									aria-hidden
									className="pointer-events-none absolute right-0 top-4 select-none text-[7rem] font-black leading-none text-foreground/[0.04] md:text-[9rem]"
								>
									{String(i + 1).padStart(2, "0")}
								</span>
								<div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive md:size-14">
									<p.icon className="size-5 md:size-6" />
								</div>
								<div className="relative flex-1">
									<span className="text-xs font-bold uppercase tracking-widest text-destructive/50">
										{String(i + 1).padStart(2, "0")}
									</span>
									<h3 className="mt-1 text-xl font-bold md:text-2xl">
										{p.title}
									</h3>
									<p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
										{p.body}
									</p>
								</div>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}
