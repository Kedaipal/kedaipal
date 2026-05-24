import { BarChart3, BellRing, MessageCircle, Store } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";

const HERO_FEATURES = [
	{
		icon: MessageCircle,
		title: () => m.feature_2_title(),
		body: () => m.feature_2_body(),
	},
	{
		icon: Store,
		title: () => m.feature_1_title(),
		body: () => m.feature_1_body(),
	},
	{
		icon: BarChart3,
		title: () => m.feature_3_title(),
		body: () => m.feature_3_body(),
	},
	{
		icon: BellRing,
		title: () => m.feature_7_title(),
		body: () => m.feature_7_body(),
	},
];

export function FeatureGrid() {
	return (
		<section
			id="features"
			aria-labelledby="features-heading"
			className="border-b border-border/60 bg-muted/20"
			style={{
				backgroundImage:
					"radial-gradient(ellipse 100% 80% at 50% 50%, hsl(160 84% 39% / 0.04), transparent)",
			}}
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<p className="text-xs font-semibold uppercase tracking-widest text-accent">
						{m.features_label()}
					</p>
					<h2
						id="features-heading"
						className="mt-3 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.features_heading()}
					</h2>
					<p className="mt-4 text-lg leading-relaxed text-muted-foreground">
						{m.features_sub()}
					</p>
				</div>
				<div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
					{HERO_FEATURES.map((f, i) => (
						<FadeIn key={f.title()} delay={i * 0.08}>
							<div className="group h-full rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:ring-1 hover:ring-accent/25 motion-reduce:hover:translate-y-0">
								<div className="flex size-11 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground">
									<f.icon className="size-5" />
								</div>
								<h3 className="mt-4 text-lg font-semibold">{f.title()}</h3>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
									{f.body()}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
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
