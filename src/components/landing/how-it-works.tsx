import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import {
	BrowseMockup,
	CloseMockup,
	RunMockup,
	ShareMockup,
} from "./how-it-works-mockups";
import { Eyebrow } from "./landing-ui";

interface HowStep {
	label: string;
	heading: string;
	body: string;
	tags: string[];
	mockup: ReactNode;
}

function getHowSteps(): HowStep[] {
	return [
		{
			label: m.how_step_1_label(),
			heading: m.how_step_1_heading(),
			body: m.how_step_1_body(),
			tags: [m.how_step_1_tag_1(), m.how_step_1_tag_2(), m.how_step_1_tag_3()],
			mockup: <ShareMockup />,
		},
		{
			label: m.how_step_2_label(),
			heading: m.how_step_2_heading(),
			body: m.how_step_2_body(),
			tags: [
				m.how_step_2_tag_1(),
				m.how_step_2_tag_2(),
				m.how_step_2_tag_3(),
				m.how_step_2_tag_4(),
			],
			mockup: <BrowseMockup />,
		},
		{
			label: m.how_step_3_label(),
			heading: m.how_step_3_heading(),
			body: m.how_step_3_body(),
			tags: [],
			mockup: <CloseMockup />,
		},
		{
			label: m.how_step_4_label(),
			heading: m.how_step_4_heading(),
			body: m.how_step_4_body(),
			tags: [],
			mockup: <RunMockup />,
		},
	];
}

/**
 * Static vertical timeline — all four steps render simultaneously in normal
 * document flow. No click interaction, no active/inactive state, no
 * `?step=` URL param: this replaced a click-to-reveal stepper that didn't
 * match the reference design (see git history on this file for the old
 * pattern). Motion is scroll-reveal only, via `FadeIn`.
 */
export function HowItWorks() {
	const steps = getHowSteps();

	return (
		<section id="how" aria-labelledby="how-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<Eyebrow className="justify-center">{m.how_label()}</Eyebrow>
					<h2
						id="how-heading"
						className="mt-4 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.how_heading()}
					</h2>
					<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
						{m.how_sub()}
					</p>
				</div>

				<div className="mt-16 md:mt-20">
					{steps.map((step, i) => {
						const stepNum = i + 1;
						const isLast = stepNum === steps.length;
						return (
							<FadeIn
								key={step.label}
								delay={i * 0.06}
								className="flex gap-4 md:gap-8"
							>
								<div className="flex flex-col items-center">
									<div
										aria-hidden
										className={cn(
											"flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold md:size-12 md:text-base",
											isLast
												? "bg-accent text-accent-foreground"
												: "bg-primary text-primary-foreground",
										)}
									>
										{isLast ? <Check className="size-4 md:size-5" /> : stepNum}
									</div>
									{!isLast && (
										<div
											aria-hidden
											className="mt-2 w-0 flex-1 border-l-2 border-dashed border-border"
										/>
									)}
								</div>

								<div
									className={cn("min-w-0 flex-1", !isLast && "pb-14 md:pb-20")}
								>
									<span className="sr-only">
										{m.how_step_of({ step: stepNum, total: steps.length })}
									</span>
									<div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-center md:gap-10">
										<div className="min-w-0">
											<p className="text-xs font-bold uppercase tracking-widest text-accent">
												{step.label}
											</p>
											<h3
												className="mt-2 text-xl font-bold md:text-2xl"
												style={{ letterSpacing: "-0.02em" }}
											>
												{step.heading}
											</h3>
											<p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
												{step.body}
											</p>
											{step.tags.length > 0 && (
												<div className="mt-4 flex flex-wrap gap-2">
													{step.tags.map((tag) => (
														<span
															key={tag}
															className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
														>
															{tag}
														</span>
													))}
												</div>
											)}
										</div>
										<div className="min-w-0 overflow-hidden rounded-3xl border border-border bg-muted/30 p-6 shadow-sm md:p-8">
											{step.mockup}
										</div>
									</div>
								</div>
							</FadeIn>
						);
					})}
				</div>
			</div>
		</section>
	);
}
