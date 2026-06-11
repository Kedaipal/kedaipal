import { Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { Eyebrow } from "./landing-ui";

export function Faq() {
	const [openIndex, setOpenIndex] = useState<number | null>(0);
	const [showAll, setShowAll] = useState(false);

	const primaryItems = [
		{ q: m.faq_q_1(), a: m.faq_a_1() },
		{ q: m.faq_q_9(), a: m.faq_a_9() },
		{ q: m.faq_q_3(), a: m.faq_a_3() },
		{ q: m.faq_q_7(), a: m.faq_a_7() },
		{ q: m.faq_q_8(), a: m.faq_a_8() },
	];

	const secondaryItems = [
		{ q: m.faq_q_2(), a: m.faq_a_2() },
		{ q: m.faq_q_4(), a: m.faq_a_4() },
		{ q: m.faq_q_5(), a: m.faq_a_5() },
		{ q: m.faq_q_6(), a: m.faq_a_6() },
		{ q: m.faq_q_10(), a: m.faq_a_10() },
	];

	const visibleItems = showAll
		? [...primaryItems, ...secondaryItems]
		: primaryItems;

	return (
		<section id="faq" aria-labelledby="faq-heading" className="bg-background">
			<div className="mx-auto max-w-3xl px-5 py-24 md:px-8 md:py-32">
				<div className="text-center">
					<Eyebrow className="justify-center">{m.faq_label()}</Eyebrow>
					<h2
						id="faq-heading"
						className="mt-4 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.faq_heading()}
					</h2>
				</div>
				<div className="mt-12 divide-y divide-border border-y border-border">
					{visibleItems.map((item, i) => {
						const isOpen = openIndex === i;
						const panelId = `faq-panel-${i}`;
						const buttonId = `faq-button-${i}`;
						return (
							<div key={item.q}>
								<button
									type="button"
									id={buttonId}
									aria-expanded={isOpen}
									aria-controls={panelId}
									onClick={() => setOpenIndex(isOpen ? null : i)}
									className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
								>
									<span className="text-base font-semibold md:text-lg">
										{item.q}
									</span>
									<span
										className={cn(
											"flex size-9 shrink-0 items-center justify-center rounded-full border transition-all duration-200 motion-reduce:transition-none",
											isOpen
												? "rotate-45 border-accent bg-accent text-accent-foreground"
												: "border-border text-muted-foreground",
										)}
									>
										<Plus className="size-4" />
									</span>
								</button>
								<section
									id={panelId}
									aria-labelledby={buttonId}
									hidden={!isOpen}
									className="pb-6 pr-12 text-sm leading-relaxed text-muted-foreground"
								>
									{item.a}
								</section>
							</div>
						);
					})}
				</div>
				<div className="mt-6 text-center">
					<button
						type="button"
						onClick={() => {
							setShowAll((v) => !v);
							if (showAll) setOpenIndex(null);
						}}
						className="text-sm font-medium text-accent underline-offset-4 hover:underline"
					>
						{showAll ? m.faq_see_less() : m.faq_see_all()}
					</button>
				</div>
			</div>
		</section>
	);
}
