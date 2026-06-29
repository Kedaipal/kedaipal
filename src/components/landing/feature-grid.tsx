import {
	BarChart3,
	BellRing,
	Boxes,
	ClipboardCheck,
	MessageCircle,
	Store,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

const HERO_FEATURES = [
	{
		icon: MessageCircle,
		title: () => m.feature_2_title(),
		body: () => m.feature_2_body(),
		dark: true,
		span: "lg:col-span-2",
	},
	{
		icon: Store,
		title: () => m.feature_1_title(),
		body: () => m.feature_1_body(),
		dark: false,
		span: "",
	},
	// "What you can sell" row — variants (wide, longer copy) + the custom-order
	// mockup gate, our strongest made-to-order differentiator. Placed mid-grid by
	// meaning, not appended last.
	{
		icon: Boxes,
		title: () => m.feature_8_title(),
		body: () => m.feature_8_body(),
		dark: false,
		span: "lg:col-span-2",
	},
	{
		icon: ClipboardCheck,
		title: () => m.feature_9_title(),
		body: () => m.feature_9_body(),
		dark: false,
		span: "",
	},
	{
		icon: BarChart3,
		title: () => m.feature_3_title(),
		body: () => m.feature_3_body(),
		dark: false,
		span: "",
	},
	{
		icon: BellRing,
		title: () => m.feature_7_title(),
		body: () => m.feature_7_body(),
		dark: false,
		span: "lg:col-span-2",
	},
];

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

				<div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
					{HERO_FEATURES.map((f, i) => (
						<FadeIn
							key={f.title()}
							delay={i * 0.08}
							className={cn("h-full", f.span)}
						>
							<div
								className={cn(
									"group h-full rounded-3xl border p-7 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl motion-reduce:hover:translate-y-0",
									f.dark
										? "border-primary bg-primary text-primary-foreground shadow-lg"
										: "border-border bg-card shadow-sm hover:ring-1 hover:ring-accent/25",
								)}
							>
								<div
									className={cn(
										"flex size-12 items-center justify-center rounded-2xl transition-colors duration-200",
										f.dark
											? "bg-accent text-accent-foreground"
											: "bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground",
									)}
								>
									<f.icon className="size-6" />
								</div>
								<h3 className="mt-5 text-xl font-semibold">{f.title()}</h3>
								<p
									className={cn(
										"mt-2 max-w-md text-sm leading-relaxed",
										f.dark
											? "text-primary-foreground/65"
											: "text-muted-foreground",
									)}
								>
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
