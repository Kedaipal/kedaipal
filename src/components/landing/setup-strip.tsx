import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";

export function SetupStrip() {
	const { isSignedIn } = useAuth();
	const steps = [
		{ title: m.setup_step_1_title(), body: m.setup_step_1_body() },
		{ title: m.setup_step_2_title(), body: m.setup_step_2_body() },
		{ title: m.setup_step_3_title(), body: m.setup_step_3_body() },
	];
	return (
		<section
			aria-labelledby="setup-heading"
			className="border-b border-border/60"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<p className="text-xs font-semibold uppercase tracking-widest text-accent">
						{m.setup_label()}
					</p>
					<h2
						id="setup-heading"
						className="mt-3 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.setup_heading()}
					</h2>
					<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
						{m.setup_sub()}
					</p>
				</div>
				<div className="relative mt-14 grid gap-8 md:grid-cols-3">
					{steps.map((s, i) => (
						<div key={s.title} className="flex flex-col gap-5">
							<div className="flex items-center gap-3">
								<div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-foreground ring-4 ring-accent/15">
									{i + 1}
								</div>
								{i < steps.length - 1 && (
									<div className="hidden h-px flex-1 bg-gradient-to-r from-accent/30 to-accent/10 md:block" />
								)}
							</div>
							<h3 className="text-xl font-semibold">{s.title}</h3>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{s.body}
							</p>
						</div>
					))}
				</div>
				<div className="mt-14 flex justify-center">
					<Button asChild size="lg" className="h-12 px-8 text-base">
						{isSignedIn ? (
							<Link to="/app">
								{m.nav_go_to_dashboard()}
								<ArrowRight />
							</Link>
						) : (
							<Link to="/sign-up/$" params={{ _splat: "" }}>
								{m.setup_cta()}
								<ArrowRight />
							</Link>
						)}
					</Button>
				</div>
			</div>
		</section>
	);
}
