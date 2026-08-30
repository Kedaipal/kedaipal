import { motion, useReducedMotion } from "framer-motion";
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
import { carouselSlideClass, carouselTrackClass, Eyebrow } from "./landing-ui";

interface HowStep {
	label: string;
	heading: string;
	body: string;
	tags: string[];
	mockup: ReactNode;
	/** Photo backdrop (how-* asset) the mockup floats over. */
	image: string;
}

function getHowSteps(): HowStep[] {
	return [
		{
			label: m.how_step_1_label(),
			heading: m.how_step_1_heading(),
			body: m.how_step_1_body(),
			tags: [m.how_step_1_tag_1(), m.how_step_1_tag_2(), m.how_step_1_tag_3()],
			mockup: <ShareMockup />,
			image: "how-share",
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
			image: "how-browse",
		},
		{
			label: m.how_step_3_label(),
			heading: m.how_step_3_heading(),
			body: m.how_step_3_body(),
			tags: [],
			mockup: <CloseMockup />,
			image: "how-close",
		},
		{
			label: m.how_step_4_label(),
			heading: m.how_step_4_heading(),
			body: m.how_step_4_body(),
			tags: [],
			mockup: <RunMockup />,
			image: "how-run",
		},
	];
}

/**
 * Static vertical timeline on md+ — all four steps render simultaneously in
 * normal document flow. No click interaction, no active/inactive state, no
 * `?step=` URL param: this replaced a click-to-reveal stepper that didn't
 * match the reference design (see git history on this file for the old
 * pattern). Motion is scroll-reveal only, via `FadeIn`.
 *
 * On MOBILE the steps are a horizontal snap carousel instead (each slide =
 * number + copy + mockup): stacked, four steps with full-height mockups ran
 * ~4 screens. The numbered circles + the next slide's peek carry the
 * "there's more" affordance; the dashed timeline connector is a vertical
 * device, so it only exists at md+.
 */
export function HowItWorks() {
	const steps = getHowSteps();
	const shouldReduceMotion = useReducedMotion();

	return (
		<section
			id="how"
			aria-labelledby="how-heading"
			className="border-y border-border bg-muted/30"
		>
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

				<FadeIn className="mt-16 md:mt-20">
					<div className={carouselTrackClass("md:block")}>
						{steps.map((step, i) => {
							const stepNum = i + 1;
							const isLast = stepNum === steps.length;
							return (
								<div
									key={step.label}
									className={carouselSlideClass("flex gap-4 md:gap-8")}
								>
									<div className="flex flex-col items-center">
										<div
											aria-hidden
											className={cn(
												"flex size-10 shrink-0 items-center justify-center rounded-full font-heading text-base font-extrabold md:size-14 md:text-lg",
												isLast
													? "bg-accent text-accent-foreground shadow-lg shadow-accent/40"
													: "bg-primary text-accent shadow-lg shadow-primary/25",
											)}
										>
											{isLast ? (
												<Check className="size-4 md:size-5" />
											) : (
												stepNum
											)}
										</div>
										{!isLast && (
											/* The connector DRAWS itself as the step scrolls into
											   view — md-only, so it never touches the mobile
											   carousel's peeking-slide constraint. */
											<motion.div
												aria-hidden
												initial={
													shouldReduceMotion ? false : { scaleY: 0 }
												}
												whileInView={{ scaleY: 1 }}
												viewport={{ once: true, margin: "-80px" }}
												transition={{ duration: 0.8, ease: "easeOut" }}
												style={{ originY: 0 }}
												className="mt-2 hidden w-0 flex-1 border-l-2 border-dashed border-border md:block"
											/>
										)}
									</div>

									<div className={cn("min-w-0 flex-1", !isLast && "md:pb-20")}>
										<span className="sr-only">
											{m.how_step_of({ step: stepNum, total: steps.length })}
										</span>
										<div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start md:gap-10">
											<div className="min-w-0 md:pt-1.5">
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
																className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80"
															>
																{tag}
															</span>
														))}
													</div>
												)}
											</div>
											{/* Layered collage: photo backdrop (slow Ken Burns
											    push-in inside its own clip) with the CSS mockup
											    floating over its lower edge. */}
											<div className="min-w-0 px-1 py-2">
												<div
													aria-hidden
													className="-rotate-1 overflow-hidden rounded-3xl shadow-lg"
												>
													<picture>
														<source
															srcSet={`/img/landing/${step.image}-640.avif`}
															type="image/avif"
														/>
														<img
															src={`/img/landing/${step.image}-640.webp`}
															alt=""
															width={640}
															height={478}
															loading="lazy"
															className="h-36 w-full animate-kp-kenburns object-cover md:h-44"
														/>
													</picture>
												</div>
												<div className="relative z-10 -mt-12 md:-mt-14">
													{step.mockup}
												</div>
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
