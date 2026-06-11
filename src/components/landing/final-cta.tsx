import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { ctaPillClass } from "./landing-ui";

export function FinalCta() {
	const { isSignedIn } = useAuth();
	return (
		<section
			aria-labelledby="final-cta-heading"
			className="relative overflow-hidden bg-cta-mesh text-primary-foreground"
		>
			{/* Decorative rings behind the CTA */}
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.04]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-1/2 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
			/>

			<div className="relative mx-auto max-w-4xl px-5 py-28 text-center md:px-8 md:py-40">
				<FadeIn>
					<h2
						id="final-cta-heading"
						className="text-4xl font-bold md:text-6xl"
						style={{ letterSpacing: "-0.03em" }}
					>
						{m.final_heading()}
					</h2>
					<p className="mx-auto mt-5 max-w-xl text-lg text-primary-foreground/65">
						{m.final_sub()}
					</p>
					<div className="mt-10 flex justify-center">
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
								{m.final_cta()}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						)}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
