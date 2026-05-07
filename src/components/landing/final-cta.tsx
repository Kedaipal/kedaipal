import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";

export function FinalCta() {
	const { isSignedIn } = useAuth();
	return (
		<section
			aria-labelledby="final-cta-heading"
			className="relative overflow-hidden border-b border-border/60 bg-cta-mesh text-primary-foreground"
		>
			{/* Decorative ring behind the CTA */}
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.04]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-1/2 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
			/>

			<div className="relative mx-auto max-w-4xl px-5 py-28 text-center md:px-8 md:py-40">
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
					<Button
						asChild
						size="lg"
						className="h-13 bg-accent px-8 text-base font-semibold text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent/90"
					>
						{isSignedIn ? (
							<Link to="/app">
								{m.nav_go_to_dashboard()}
								<ArrowRight />
							</Link>
						) : (
							<Link to="/sign-up/$" params={{ _splat: "" }}>
								{m.final_cta()}
								<ArrowRight />
							</Link>
						)}
					</Button>
				</div>
			</div>
		</section>
	);
}
