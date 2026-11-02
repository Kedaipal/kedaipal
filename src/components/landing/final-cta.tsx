import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAuthState } from "../../hooks/useAuthState";
import { m } from "../../paraglide/messages";
import { Skeleton } from "../ui/skeleton";
import { FadeIn } from "./fade-in";
import {
	AuthCtaPlaceholder,
	ctaPillClass,
	DemoPill,
	GuaranteeLine,
	StartFreeLink,
} from "./landing-ui";

/**
 * The close mirrors the hero (demo-first, z8r3fdtpub T1): the mint demo pill,
 * "Start free" as a text link under it, then the guarantee — the sentence a
 * demo actually promises.
 */
export function FinalCta() {
	const auth = useAuthState();
	return (
		<section
			aria-labelledby="final-cta-heading"
			className="relative overflow-hidden bg-cta-mesh text-cta-mesh-foreground"
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

			<div
				id="final"
				className="relative mx-auto max-w-4xl px-5 py-28 text-center md:px-8 md:py-40"
			>
				<FadeIn>
					<h2
						id="final-cta-heading"
						className="text-4xl font-bold md:text-6xl"
						style={{ letterSpacing: "-0.03em" }}
					>
						{m.final_heading()}
					</h2>
					<p className="mx-auto mt-5 max-w-xl text-lg text-cta-mesh-foreground/65">
						{m.final_sub()}
					</p>
					<div className="mt-10 flex flex-col items-center gap-3.5">
						{auth === "loading" ? (
							// On the navy mesh `bg-muted` would glare — the placeholder
							// takes the section's own foreground at low alpha.
							<AuthCtaPlaceholder className="flex w-full flex-col items-center gap-3.5">
								<Skeleton className="h-[52px] w-full max-w-80 rounded-full bg-cta-mesh-foreground/10" />
								<div className="flex min-h-11 items-center">
									<Skeleton className="h-4 w-56 bg-cta-mesh-foreground/10" />
								</div>
								<Skeleton className="h-4 w-full max-w-md bg-cta-mesh-foreground/10" />
							</AuthCtaPlaceholder>
						) : auth === "signed-in" ? (
							<Link to="/app" className={ctaPillClass("accent")}>
								{m.nav_go_to_dashboard()}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						) : (
							<>
								<DemoPill placement="final" long />
								<StartFreeLink
									placement="final-cta"
									className="text-cta-mesh-foreground/85 hover:text-cta-mesh-foreground"
								/>
								<GuaranteeLine className="max-w-md text-[13px] leading-relaxed text-cta-mesh-foreground/60" />
							</>
						)}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
