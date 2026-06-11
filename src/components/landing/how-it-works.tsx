import { useNavigate, useSearch } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, MessageCircle, ShoppingCart, Store } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { Eyebrow } from "./landing-ui";
import { ResponsiveImage } from "./responsive-image";

function StepPreviewImage({ step, alt }: { step: number; alt: string }) {
	return (
		<ResponsiveImage
			name={`how-step-${step}`}
			alt={alt}
			widths={[400, 800]}
			sizes="(max-width: 768px) 90vw, 400px"
			width={800}
			height={500}
			className="mx-auto h-auto w-full max-w-[400px] rounded-2xl shadow-lg"
		/>
	);
}

function getHowStepDetails() {
	return [
		{
			heading: m.how_detail_1_heading(),
			description: m.how_detail_1_desc(),
			preview: <StepPreviewImage step={1} alt={m.how_detail_1_desc()} />,
		},
		{
			heading: m.how_detail_2_heading(),
			description: m.how_detail_2_desc(),
			preview: <StepPreviewImage step={2} alt={m.how_detail_2_visual_alt()} />,
		},
		{
			heading: m.how_detail_3_heading(),
			description: m.how_detail_3_desc(),
			preview: <StepPreviewImage step={3} alt={m.how_detail_3_desc()} />,
		},
		{
			heading: m.how_detail_4_heading(),
			description: m.how_detail_4_desc(),
			preview: <StepPreviewImage step={4} alt={m.how_detail_4_desc()} />,
		},
	];
}

export function HowItWorks() {
	const { step } = useSearch({ from: "/" });
	const navigate = useNavigate({ from: "/" });
	const shouldReduceMotion = useReducedMotion();
	const activeStep = step ?? 1;
	const howStepDetails = getHowStepDetails();

	const steps = [
		{ icon: MessageCircle, title: m.how_1_title(), body: m.how_1_body() },
		{ icon: Store, title: m.how_2_title(), body: m.how_2_body() },
		{ icon: ShoppingCart, title: m.how_3_title(), body: m.how_3_body() },
		{ icon: Bell, title: m.how_4_title(), body: m.how_4_body() },
	];

	function handleStepClick(stepNum: number) {
		navigate({
			search: (prev) => ({
				...prev,
				step: activeStep === stepNum ? undefined : stepNum,
			}),
			replace: true,
			resetScroll: false,
		});
	}

	const detail = howStepDetails[activeStep - 1];

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

				<div className="mt-16 grid gap-4 md:grid-cols-4">
					{steps.map((s, i) => {
						const stepNum = i + 1;
						const isActive = activeStep === stepNum;
						return (
							<button
								key={s.title}
								type="button"
								onClick={() => handleStepClick(stepNum)}
								aria-pressed={isActive}
								aria-label={`${m.how_step_label({ step: stepNum })}: ${s.title}`}
								className={cn(
									"relative flex h-full w-full flex-col rounded-3xl border p-5 text-left transition-all duration-200",
									"hover:-translate-y-1 hover:border-accent/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:hover:translate-y-0",
									isActive
										? "border-accent bg-primary text-primary-foreground shadow-xl"
										: "border-border bg-card shadow-sm",
								)}
							>
								<div
									className={cn(
										"flex size-12 items-center justify-center rounded-2xl transition-colors",
										isActive
											? "bg-accent text-accent-foreground"
											: "bg-accent/10 text-accent",
									)}
								>
									<s.icon className="size-6" />
								</div>
								<div className="mt-4 flex items-center gap-2">
									<span
										className={cn(
											"text-xs font-bold",
											isActive ? "text-accent" : "text-muted-foreground",
										)}
									>
										0{stepNum}
									</span>
									<div
										className={cn(
											"h-px flex-1",
											isActive ? "bg-accent/40" : "bg-border",
										)}
									/>
								</div>
								<h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
								<p
									className={cn(
										"mt-2 text-sm",
										isActive
											? "text-primary-foreground/70"
											: "text-muted-foreground",
									)}
								>
									{s.body}
								</p>
								{isActive && (
									<div className="absolute bottom-3 right-3 size-2 rounded-full bg-accent" />
								)}
							</button>
						);
					})}
				</div>

				{detail && (
					<div className="mt-6 overflow-hidden rounded-3xl border border-accent/20 bg-card shadow-md">
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={activeStep}
								initial={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
								animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
								exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
								transition={{ duration: 0.25, ease: "easeOut" }}
								className="grid gap-0 md:grid-cols-2"
							>
								<div className="flex flex-col justify-center gap-4 p-8">
									<span className="text-xs font-bold uppercase tracking-widest text-accent">
										{m.how_step_of({ step: activeStep, total: 4 })}
									</span>
									<h3
										className="text-2xl font-bold"
										style={{ letterSpacing: "-0.02em" }}
									>
										{detail.heading}
									</h3>
									<p className="text-base leading-relaxed text-muted-foreground">
										{detail.description}
									</p>
								</div>
								<div className="flex items-center justify-center border-t border-border/60 bg-muted/30 p-8 md:border-l md:border-t-0">
									{detail.preview}
								</div>
							</motion.div>
						</AnimatePresence>
					</div>
				)}
			</div>
		</section>
	);
}
