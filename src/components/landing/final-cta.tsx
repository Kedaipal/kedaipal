import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { FadeIn } from "./fade-in";
import { ctaPillClass, GuaranteeLine } from "./landing-ui";

// Outline-on-navy — never the filled/accent pill, which stays reserved for
// the ONE primary CTA per page (86eye3p6z §C).
const demoLinkClass =
	"group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border-2 border-white/20 px-7 text-base font-semibold text-cta-mesh-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/5 active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20";

export function FinalCta() {
	const { isSignedIn } = useAuth();
	const supportWa = useSupportWaNumber();
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

			<div className="relative mx-auto max-w-4xl px-5 py-28 text-center md:px-8 md:py-40">
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
						{isSignedIn ? (
							<Link to="/app" className={ctaPillClass("accent")}>
								{m.nav_go_to_dashboard()}
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</Link>
						) : (
							<>
								<div className="flex flex-col items-center gap-3 sm:flex-row">
									<Link
										to="/sign-up/$"
										params={{ _splat: "" }}
										className={ctaPillClass("accent")}
									>
										{m.final_cta()}
										<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
									</Link>
									<a
										href={buildWaContactLink(m.demo_wa_message(), supportWa)}
										target="_blank"
										rel="noopener noreferrer"
										className={demoLinkClass}
									>
										<WhatsAppIcon className="size-4" />
										{m.book_demo_cta()}
									</a>
								</div>
								<GuaranteeLine className="max-w-md text-[13px] leading-relaxed text-cta-mesh-foreground/60" />
							</>
						)}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
