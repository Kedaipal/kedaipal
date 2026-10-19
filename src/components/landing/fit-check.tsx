import { Check, X } from "lucide-react";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { trackDemoCta } from "../../lib/ga-events";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { FadeIn } from "./fade-in";
import { ctaPillClass, Eyebrow } from "./landing-ui";

/**
 * "Is Kedaipal for you?" (z8r3fdtpub T2, 19 Oct 2026): the three ICP gates
 * locked in the 20 Sep focus retrospective, in plain words, right before the
 * price — so a hobby seller or a one-off event vendor self-selects out before
 * a demo is booked, and a seller who clears all three reads the price as
 * theirs. The "not yet for you" row is the filter; keep it honest and short.
 *
 * Gate wording rule: the RM2,000 floor is never softened (`fit-check.test`).
 * The unsure get a WhatsApp door — an OUTLINE link, not the accent pill,
 * which stays the demo ask (`DemoPill`).
 */
export function FitCheck() {
	const supportWa = useSupportWaNumber();
	const gates = [
		[m.fit_gate_1_title(), m.fit_gate_1_body()],
		[m.fit_gate_2_title(), m.fit_gate_2_body()],
		[m.fit_gate_3_title(), m.fit_gate_3_body()],
	] as const;

	return (
		<section
			id="fit"
			aria-labelledby="fit-heading"
			className="border-t border-border bg-muted/30"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<FadeIn>
					<div className="text-center">
						<Eyebrow className="justify-center">{m.fit_label()}</Eyebrow>
						<h2
							id="fit-heading"
							className="mx-auto mt-4 max-w-3xl text-3xl font-bold leading-[1.08] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.fit_heading()}
						</h2>
					</div>
				</FadeIn>

				<div className="mt-10 grid gap-4 md:mt-12 md:grid-cols-3 md:gap-5">
					{gates.map(([title, body], i) => (
						<FadeIn key={title} delay={i * 0.08}>
							<div className="flex h-full flex-col gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
								<span className="flex size-10 items-center justify-center rounded-full bg-accent/15 text-accent-emphasis">
									<Check className="size-5" strokeWidth={2.75} />
								</span>
								<h3 className="font-heading text-xl font-extrabold leading-tight">
									{title}
								</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{body}
								</p>
							</div>
						</FadeIn>
					))}
				</div>

				<FadeIn delay={0.25}>
					<div className="mt-8 flex flex-col gap-5 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
						<p className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
							<X
								aria-hidden
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
							/>
							<span>
								<strong className="font-semibold text-foreground">
									{m.fit_not_label()}
								</strong>{" "}
								{m.fit_not_body()}
							</span>
						</p>
						<a
							href={buildWaContactLink(m.fit_wa_message(), supportWa)}
							target="_blank"
							rel="noopener noreferrer"
							onClick={() => trackDemoCta("fit")}
							className={`${ctaPillClass("outline")} min-h-11 shrink-0 px-5 text-sm`}
						>
							<WhatsAppIcon className="size-4 text-[#25D366]" />
							{m.fit_cta()}
						</a>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
