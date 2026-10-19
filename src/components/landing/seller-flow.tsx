import { motion, useInView, useReducedMotion } from "framer-motion";
import { BellOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BILLING_CURRENCY_FOR_COUNTRY } from "../../../convex/lib/plans";
import { useTimeline } from "../../hooks/useBeatLoop";
import { useLandingRegionContext } from "../../hooks/useLandingRegion";
import { couriersFor, hasParcelCouriers, mockQuotes } from "../../lib/couriers";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { CourierCatalogue, DispatchCard } from "./delivery";
import { FadeIn } from "./fade-in";
import { AfterPhone } from "./hero-stage";
import { Eyebrow, RegionToggle } from "./landing-ui";
import { PayNowPanes } from "./pay-now";
import { HandshakePanes } from "./payment-handshake";
import {
	type FlowPhase,
	firstStepOf,
	lastStepOf,
	stepAt,
	TIMELINE_HOLDS,
} from "./seller-flow-timeline";

/**
 * The seller-flow walkthrough (z8r3fdtpub T3, 19 Oct 2026): the order's
 * life, acted out on the real UI in four steps — it lands in the inbox, the
 * buyer pays online and the order confirms itself, a "dah transfer" becomes
 * a matched payment for the buyers who still transfer, the courier is booked
 * from the order. It replaces the Payment Handshake and Delivery SECTIONS (their mocks
 * moved in here; `landing-v2.md`): fourteen screens of text had become two
 * long sections a reader scrolled past, and the ask on this page is a demo,
 * so the page's job is to show the product moving, not to describe it.
 *
 * One clock (`useTimeline` over `seller-flow-timeline.ts`) drives all three
 * mocks, so a click on a step jumps the story there and the auto-advance
 * resumes; hovering the frame pauses it (a reader is looking, and the bubble
 * says so). The frame cross-fades phases — all three stay mounted in one
 * grid cell so the tallest sets the height and a swap never reflows the
 * page — and the mocks inside keep their own CSS beats. Reduced motion renders each phase's
 * LAST beat as a still, never advances by itself, and the step buttons still
 * page through. The frame mounts its mocks only once near the viewport (a
 * story playing three screens above the reader is wasted paint) and is
 * decorative (`aria-hidden`): the step copy carries the content.
 *
 * Region: the page's one `LandingRegionProvider`. Singapore has no parcel
 * lane live, so phase 03's step copy, card, catalogue and note all switch to
 * the rider-only story (`hasParcelCouriers`), exactly as the Delivery section
 * did — honesty does not get lost in a redesign.
 */

const PHASES: readonly FlowPhase[] = [1, 2, 3, 4];

function StepButton({
	phase,
	active,
	title,
	body,
	onPick,
	reduced,
}: {
	phase: FlowPhase;
	active: boolean;
	title: string;
	body: string;
	onPick: (phase: FlowPhase) => void;
	reduced: boolean;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	// On a phone the pills scroll sideways: the row follows the active step so
	// "Step 3 of 3" never points at a pill that is off the right edge. Only the
	// ROW scrolls — `scrollIntoView` would also drag the page to the pill while
	// the reader is looking at the frame below it.
	useEffect(() => {
		const el = ref.current;
		const row = el?.parentElement;
		if (!active || !el || !row || typeof row.scrollTo !== "function") return;
		row.scrollTo({
			left: Math.max(0, el.offsetLeft - row.offsetLeft - 20),
			behavior: reduced ? "auto" : "smooth",
		});
	}, [active, reduced]);
	return (
		<button
			ref={ref}
			type="button"
			aria-current={active ? "step" : undefined}
			onClick={() => onPick(phase)}
			className={cn(
				// The mobile pill and the desktop row are one control: a numeral and
				// the title, the body only from `lg` where there is room to read it.
				// `relative`: the sr-only prefix is absolutely positioned, and without
				// a positioned button it anchors to the document — a pill scrolled
				// off the row's right edge then widened the whole page at 390.
				"group relative flex min-h-11 shrink-0 items-center gap-3 rounded-full border px-3 py-2 text-left transition-colors lg:w-full lg:items-start lg:gap-4 lg:rounded-2xl lg:border-transparent lg:px-4 lg:py-3.5",
				active
					? "border-accent bg-accent/5 lg:border-transparent"
					: "border-border bg-card hover:bg-muted lg:bg-transparent",
			)}
		>
			{/* The numeral is decorative; the name a screen reader gets is "Step N:
			    <title> <body>" — an `aria-label` here would REPLACE the copy. */}
			<span className="sr-only">{m.flow_step_label({ step: phase })}: </span>
			<span
				aria-hidden
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-full font-heading text-[11px] font-extrabold transition-colors lg:size-9 lg:text-[13px]",
					active
						? "bg-accent text-accent-foreground"
						: "bg-muted text-muted-foreground",
				)}
			>
				{String(phase).padStart(2, "0")}
			</span>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span
					className={cn(
						"whitespace-nowrap text-sm font-semibold lg:whitespace-normal lg:text-base",
						active
							? "text-foreground"
							: "text-muted-foreground lg:text-foreground",
					)}
				>
					{title}
				</span>
				<span className="hidden text-sm leading-relaxed text-muted-foreground lg:block">
					{body}
				</span>
			</span>
		</button>
	);
}

export function SellerFlow() {
	const [region, setRegion] = useLandingRegionContext();
	const currency = BILLING_CURRENCY_FOR_COUNTRY[region];
	const couriers = couriersFor(region);
	const quotes = mockQuotes(region);
	const parcelsLive = hasParcelCouriers(region);
	const courier = quotes[0]?.name ?? "";

	const reduced = Boolean(useReducedMotion());
	const frameRef = useRef<HTMLDivElement>(null);
	// `once`: the mocks mount the first time the frame comes near and stay —
	// unmounting them on scroll-out would replay every entrance on return.
	const near = useInView(frameRef, { margin: "400px 0px", once: true });
	const playing = useInView(frameRef, { margin: "-10% 0px" });
	const [hovered, setHovered] = useState(false);
	const { beat: index, goTo } = useTimeline(
		near && playing && !reduced && !hovered,
		TIMELINE_HOLDS,
	);
	// Reduced motion: the clock never runs, so the phase is the reader's pick
	// and the beat is that phase's last — a still, not a frozen first frame.
	const [stillPhase, setStillPhase] = useState<FlowPhase>(1);
	const step = reduced ? stepAt(lastStepOf(stillPhase)) : stepAt(index);
	const { phase, beat } = step;

	const pick = useCallback(
		(next: FlowPhase) => {
			if (reduced) setStillPhase(next);
			else goTo(firstStepOf(next));
		},
		[goTo, reduced],
	);

	const titles: Record<FlowPhase, string> = {
		1: m.flow_step_1_title(),
		2: m.flow_step_2_title(),
		3: m.flow_step_3_title(),
		4: m.flow_step_4_title(),
	};
	const bodies: Record<FlowPhase, string> = {
		1: m.flow_step_1_body(),
		2: m.flow_step_2_body(),
		3: m.flow_step_3_body(),
		4: parcelsLive ? m.flow_step_4_body() : m.flow_step_4_body_rider(),
	};
	// Who gets a message at this step — and that nobody does, when nobody
	// does. One message per order (`docs/one-message-per-order.md`): the
	// buyer's confirmation at 01, the seller's own payment-received alert at
	// 02, and NOTHING to the buyer on confirmed or shipped — her order page
	// carries those. The first cut sent Aina a WhatsApp on every step.
	const bubbles: Record<
		FlowPhase,
		{ label: string; sent: boolean; body: string }
	> = {
		1: {
			label: m.flow_bubble_buyer_label(),
			sent: true,
			body: m.flow_bubble_1(),
		},
		2: {
			label: m.flow_bubble_seller_label(),
			sent: true,
			body: m.flow_bubble_2(),
		},
		3: {
			label: m.flow_bubble_none_label(),
			sent: false,
			body: m.flow_bubble_3(),
		},
		4: {
			label: m.flow_bubble_none_label(),
			sent: false,
			body: m.flow_bubble_4({ courier }),
		},
	};

	return (
		<section
			id="flow"
			aria-labelledby="flow-heading"
			className="border-t border-border bg-background"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
				<div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:gap-14">
					<div className="min-w-0">
						<FadeIn>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<Eyebrow>{m.flow_label()}</Eyebrow>
								<RegionToggle region={region} onChange={setRegion} />
							</div>
							<h2
								id="flow-heading"
								className="mt-4 max-w-xl text-3xl font-bold leading-[1.08] md:text-5xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.flow_heading()}
							</h2>
							<p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
								{m.flow_sub()}
							</p>
						</FadeIn>

						<FadeIn delay={0.1}>
							{/* Phone: a scrolling row of pills above the frame, the active
							    step's body said once under it. Desktop: the three rows with
							    their bodies, a column beside the frame. */}
							<div className="-mx-5 mt-7 flex gap-2 overflow-x-auto px-5 scrollbar-none lg:mx-0 lg:mt-8 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
								{PHASES.map((p) => (
									<StepButton
										key={p}
										phase={p}
										active={p === phase}
										title={titles[p]}
										body={bodies[p]}
										onPick={pick}
										reduced={reduced}
									/>
								))}
							</div>
							<p className="mt-4 text-sm leading-relaxed text-muted-foreground lg:hidden">
								{bodies[phase]}
							</p>

							<div className="mt-5 flex items-center gap-3 lg:mt-6">
								<div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
									<div
										className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
										style={{ width: `${(phase / PHASES.length) * 100}%` }}
									/>
								</div>
								<span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
									{m.flow_progress({ step: phase })}
								</span>
							</div>
						</FadeIn>
					</div>

					{/* The frame: the hero stage's navy ground and dot grid. All four
					    phases are stacked in one cell (below), so its height is the tallest
					    phase's and never changes on a swap — and it HUGS that phase: a
					    min-height taller than the mocks left a third of the frame as empty
					    navy around phones a quarter of its width (Arif, 19 Oct). */}
					<FadeIn delay={0.15} className="min-w-0">
						<div
							ref={frameRef}
							data-testid="flow-frame"
							aria-hidden="true"
							onPointerEnter={() => setHovered(true)}
							onPointerLeave={() => setHovered(false)}
							className="relative overflow-hidden rounded-[2rem] bg-primary p-5 pb-32 shadow-2xl shadow-primary/25 contain-inline-size sm:p-8 sm:pb-32 md:rounded-[2.5rem]"
						>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-0 [background-image:radial-gradient(hsl(0_0%_100%/0.07)_1px,transparent_1px)] [background-size:18px_18px]"
							/>
							<div
								aria-hidden
								className="pointer-events-none absolute -left-[10%] top-[10%] size-[55%] rounded-full bg-accent/10 blur-3xl"
							/>
							{/* Every phase is mounted in the SAME grid cell and only the active
							    one is visible: the tallest phase sets the frame's height, so a
							    swap never reflows the section or the page (the reviewer measured
							    +318px per loop with one phase mounted at a time). Inactive phases
							    render their last beat as a still — no keyframes run off-screen. */}
							{near ? (
								<div className="grid [grid-template-areas:'stage']">
									{PHASES.map((p) => {
										const active = p === phase;
										const phaseBeat = active
											? beat
											: stepAt(lastStepOf(p)).beat;
										const still = reduced || !active;
										return (
											<motion.div
												key={p}
												data-phase={p}
												data-active={active}
												aria-hidden={active ? undefined : true}
												initial={false}
												animate={
													active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }
												}
												transition={
													reduced
														? { duration: 0 }
														: { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
												}
												className={cn(
													"relative flex flex-col items-center justify-center [grid-area:stage]",
													!active && "pointer-events-none invisible",
												)}
											>
												{p === 1 ? (
													<div className="text-[11px] md:text-[13px]">
														<AfterPhone
															beat={phaseBeat}
															still={still}
															showLabel={false}
														/>
													</div>
												) : null}
												{p === 2 ? (
													<PayNowPanes beat={phaseBeat} still={still} />
												) : null}
												{p === 3 ? (
													<HandshakePanes beat={phaseBeat} still={still} />
												) : null}
												{p === 4 ? (
													<DispatchCard
														beat={phaseBeat}
														reduced={still}
														currency={currency}
														quotes={quotes}
														parcelsLive={parcelsLive}
													/>
												) : null}
											</motion.div>
										);
									})}
								</div>
							) : (
								<div className="min-h-[26rem] md:min-h-[30rem]" />
							)}

							{/* What goes out at this step — one WhatsApp per order, then the
							    order page doing the rest; the label says who, or that no one. */}
							<div
								key={phase}
								className={cn(
									"pointer-events-none absolute bottom-4 left-4 flex max-w-[17rem] flex-col gap-0.5 rounded-2xl bg-card px-3.5 py-2.5 text-card-foreground shadow-2xl ring-1 ring-black/10 sm:bottom-6 sm:left-6",
									!reduced && "animate-kp-toast-in",
								)}
							>
								<span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
									{bubbles[phase].sent ? (
										<WhatsAppIcon className="size-3 text-[#25D366]" />
									) : (
										<BellOff className="size-3" />
									)}
									{bubbles[phase].label}
								</span>
								<span className="text-xs font-semibold leading-snug">
									{bubbles[phase].body}
								</span>
								{/* The clock stops while the pointer rests here — say so, on its
								    own line under the message. */}
								{hovered && !reduced ? (
									<span className="mt-1 block text-[10px] font-semibold text-accent-emphasis">
										{m.flow_pause_hint()}
									</span>
								) : null}
							</div>
						</div>
						{/* The courier catalogue is information, not decoration, so it sits
						    OUTSIDE the aria-hidden frame on every breakpoint, always mounted
						    (a row that appears on phase 03 would move the section). */}
						<div className="mt-6">
							<CourierCatalogue couriers={couriers} />
						</div>
						{/* The region's honest footnote, under the catalogue it qualifies. */}
						{!parcelsLive ? (
							<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
								{m.delivery_sg_note()}
							</p>
						) : null}
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
