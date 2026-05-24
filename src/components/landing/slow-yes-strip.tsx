import { Bell, Bookmark, History } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";

export function SlowYesStrip() {
	const items = [
		{
			icon: Bookmark,
			title: m.slow_yes_1_title(),
			body: m.slow_yes_1_body(),
			status: m.slow_yes_1_status(),
		},
		{
			icon: History,
			title: m.slow_yes_2_title(),
			body: m.slow_yes_2_body(),
			status: m.slow_yes_2_status(),
		},
		{
			icon: Bell,
			title: m.slow_yes_3_title(),
			body: m.slow_yes_3_body(),
			status: m.slow_yes_3_status(),
		},
	];
	return (
		<section
			aria-labelledby="slow-yes-heading"
			className="border-b border-border/60"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<p className="text-xs font-semibold uppercase tracking-widest text-accent">
						{m.slow_yes_eyebrow()}
					</p>
					<h2
						id="slow-yes-heading"
						className="mt-3 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.slow_yes_heading()}
					</h2>
					<p className="mt-4 text-lg leading-relaxed text-muted-foreground">
						{m.slow_yes_sub()}
					</p>
				</div>
				<div className="mt-14 grid gap-5 md:grid-cols-3">
					{items.map((item, i) => (
						<FadeIn key={item.title} delay={i * 0.08} className="h-full">
							<div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-7 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:ring-1 hover:ring-accent/30 motion-reduce:hover:translate-y-0">
								<div className="flex size-11 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground">
									<item.icon className="size-5" />
								</div>
								<h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
								<p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
									{item.body}
								</p>
								<div className="mt-5 flex items-center gap-1.5">
									<span className="size-1.5 rounded-full bg-accent" />
									<span className="text-xs font-medium text-accent">
										{item.status}
									</span>
								</div>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}
