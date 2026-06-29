import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { ctaPillClass, Eyebrow } from "./landing-ui";

export function SetupStrip() {
	const { isSignedIn } = useAuth();
	const steps = [
		{ title: m.setup_step_1_title(), body: m.setup_step_1_body() },
		{ title: m.setup_step_2_title(), body: m.setup_step_2_body() },
		{ title: m.setup_step_3_title(), body: m.setup_step_3_body() },
	];
	return (
		<section aria-labelledby="setup-heading" className="bg-muted/30">
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<Eyebrow className="justify-center">{m.setup_label()}</Eyebrow>
					<h2
						id="setup-heading"
						className="mt-4 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.setup_heading()}
					</h2>
					<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
						{m.setup_sub()}
					</p>
				</div>

				<div className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
					{/* Dashed connector across all three steps */}
					<div
						aria-hidden
						className="absolute left-0 right-0 top-6 hidden border-t-2 border-dashed border-accent/30 md:block"
					/>
					{steps.map((s, i) => (
						<FadeIn key={s.title} delay={i * 0.1}>
							<div className="relative flex flex-col gap-4">
								<div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-foreground ring-8 ring-muted/80">
									{i + 1}
								</div>
								<h3 className="text-xl font-semibold">{s.title}</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{s.body}
								</p>
							</div>
						</FadeIn>
					))}
				</div>

				<div className="mt-14 flex justify-center">
					{isSignedIn ? (
						<Link to="/app" className={ctaPillClass("accent")}>
							{m.nav_go_to_dashboard()}
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					) : (
						<Link
							to="/sign-up/$"
							params={{ _splat: "" }}
							className={ctaPillClass("accent")}
						>
							{m.setup_cta()}
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					)}
				</div>
			</div>
		</section>
	);
}
