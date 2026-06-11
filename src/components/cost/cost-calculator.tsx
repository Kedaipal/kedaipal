import { ArrowRight, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Field, FieldLabel } from "#/components/ui/field";
import { Slider } from "#/components/ui/slider";
import {
	BOUNDS,
	type CostInputs,
	computeStatusQuoCost,
	DEFAULT_INPUTS,
	FOUNDING_PRICE_RM,
} from "#/lib/calculator";
import { buildWaContactLink } from "#/lib/contact";
import { formatPrice } from "#/lib/format";
import { cn } from "#/lib/utils";

/** Render an RM major-unit amount via the shared minor-unit formatter. */
function rm(major: number): string {
	return formatPrice(Math.round(major * 100), "MYR");
}

function buildWaLink(monthlyCost: number): string {
	const message = `Hi Kedaipal! I worked out WhatsApp-only ordering is costing me about ${rm(
		monthlyCost,
	)}/mo. I'd like to join as a Founding Member (RM${FOUNDING_PRICE_RM}/mo).`;
	return buildWaContactLink(message);
}

interface SliderRowProps {
	label: string;
	value: number;
	display: string;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}

function SliderRow({
	label,
	value,
	display,
	min,
	max,
	step,
	onChange,
}: SliderRowProps) {
	return (
		<Field>
			<div className="flex items-baseline justify-between gap-3">
				<FieldLabel className="text-base">{label}</FieldLabel>
				<span className="rounded-lg bg-muted px-2.5 py-1 text-base font-bold tabular-nums">
					{display}
				</span>
			</div>
			<Slider
				aria-label={label}
				value={value}
				onValueChange={onChange}
				min={min}
				max={max}
				step={step}
			/>
		</Field>
	);
}

interface CostCalculatorProps {
	initialInputs?: CostInputs;
	/** Called on every input change so the route can mirror state into the URL. */
	onInputsChange?: (inputs: CostInputs) => void;
}

export function CostCalculator({
	initialInputs,
	onInputsChange,
}: CostCalculatorProps) {
	const [inputs, setInputs] = useState<CostInputs>(
		initialInputs ?? DEFAULT_INPUTS,
	);

	const update = (patch: Partial<CostInputs>) => {
		const next = { ...inputs, ...patch };
		setInputs(next);
		onInputsChange?.(next);
	};

	const result = computeStatusQuoCost(inputs);
	const ratioLabel = `${result.ratio.toFixed(1)}×`;

	return (
		<div className="bg-hero-mesh">
			<div className="mx-auto max-w-5xl px-5 pb-36 pt-24 md:px-8 md:pt-32">
				<header className="mx-auto max-w-2xl text-center">
					<span
						className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-destructive shadow-sm"
						style={{ transform: "rotate(-1.5deg)" }}
					>
						<TrendingDown className="size-3" />
						The real cost of WhatsApp-only orders
					</span>
					<h1
						className="mt-5 text-3xl font-bold tracking-tight md:text-5xl"
						style={{ letterSpacing: "-0.03em" }}
					>
						What is WhatsApp-only ordering{" "}
						<span className="kp-highlight text-destructive">costing you?</span>
					</h1>
					<p className="mx-auto mt-4 max-w-md text-muted-foreground md:text-lg">
						Three quick guesses. We'll show you the monthly leak — honestly,
						even if it means you don't need us yet.
					</p>
				</header>

				<div className="mt-10 grid items-start gap-6 md:mt-14 md:grid-cols-[1fr_0.95fr] md:gap-8">
					{/* Inputs */}
					<div className="space-y-7 rounded-3xl border border-border bg-card p-6 shadow-md md:p-8">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
							Your numbers
						</p>
						<SliderRow
							label="Orders a week"
							value={inputs.ordersPerWeek}
							display={`${inputs.ordersPerWeek}`}
							min={BOUNDS.ordersPerWeek.min}
							max={BOUNDS.ordersPerWeek.max}
							step={BOUNDS.ordersPerWeek.step}
							onChange={(v) => update({ ordersPerWeek: v })}
						/>
						<SliderRow
							label="Average order value"
							value={inputs.aov}
							display={rm(inputs.aov)}
							min={BOUNDS.aov.min}
							max={BOUNDS.aov.max}
							step={BOUNDS.aov.step}
							onChange={(v) => update({ aov: v })}
						/>
						<SliderRow
							label="Orders you miss a week (your guess)"
							value={inputs.missedPerWeek}
							display={`${inputs.missedPerWeek}`}
							min={BOUNDS.missedPerWeek.min}
							max={BOUNDS.missedPerWeek.max}
							step={BOUNDS.missedPerWeek.step}
							onChange={(v) => update({ missedPerWeek: v })}
						/>
						<div className="border-t border-border/60 pt-6">
							<SliderRow
								label="Minutes chasing each payment"
								value={inputs.chaseMin}
								display={`${inputs.chaseMin} min`}
								min={BOUNDS.chaseMin.min}
								max={BOUNDS.chaseMin.max}
								step={BOUNDS.chaseMin.step}
								onChange={(v) => update({ chaseMin: v })}
							/>
						</div>
					</div>

					{/* Result card — designed to screenshot cleanly */}
					<div className="md:sticky md:top-24">
						<ResultCard result={result} ratioLabel={ratioLabel} />
					</div>
				</div>

				{/* Sticky bottom CTA */}
				<div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
					<div className="mx-auto max-w-xl">
						{result.disqualified ? (
							<div className="flex flex-col items-center gap-1 text-center">
								<p className="text-sm text-muted-foreground">
									No pressure — we'll be here when it's worth it.
								</p>
								<Button
									asChild
									variant="outline"
									className="h-11 w-full rounded-full"
								>
									<a
										href={buildWaLink(result.total)}
										target="_blank"
										rel="noopener noreferrer"
									>
										Keep my number for later
									</a>
								</Button>
							</div>
						) : (
							<Button
								asChild
								className="h-12 w-full rounded-full text-sm sm:text-base"
							>
								<a
									href={buildWaLink(result.total)}
									target="_blank"
									rel="noopener noreferrer"
								>
									Become a Founding Member — RM{FOUNDING_PRICE_RM}/mo
									<ArrowRight />
								</a>
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

interface ResultCardProps {
	result: ReturnType<typeof computeStatusQuoCost>;
	ratioLabel: string;
}

function ResultCard({ result, ratioLabel }: ResultCardProps) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-3xl shadow-xl",
				result.disqualified
					? "border border-border bg-muted/40 shadow-sm"
					: "bg-cta-mesh text-primary-foreground",
			)}
		>
			{result.disqualified ? (
				<DisqualifiedBody result={result} />
			) : (
				<QualifiedBody result={result} ratioLabel={ratioLabel} />
			)}

			{/* Self-branding footer so a screenshot carries the source. */}
			<div
				className={cn(
					"flex items-center justify-between border-t px-6 py-3 text-xs",
					result.disqualified
						? "border-border/60 text-muted-foreground"
						: "border-white/10 text-primary-foreground/60",
				)}
			>
				<img
					src={result.disqualified ? "/logo-3.svg" : "/logo-dark.svg"}
					alt="Kedaipal"
					className="h-5 w-auto"
				/>
				<span>kedaipal.com/cost</span>
			</div>
		</div>
	);
}

function QualifiedBody({ result, ratioLabel }: ResultCardProps) {
	return (
		<div className="p-6 md:p-8">
			<p className="text-sm font-medium text-primary-foreground/65">
				WhatsApp-only ordering is costing you about
			</p>
			<p className="mt-2 text-5xl font-bold tracking-tight md:text-6xl">
				{rm(result.total)}
				<span className="text-xl font-semibold text-primary-foreground/50">
					{" "}
					/mo
				</span>
			</p>

			<dl className="mt-7 space-y-3 text-sm">
				<div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3">
					<dt className="text-primary-foreground/70">Missed-order revenue</dt>
					<dd className="font-bold tabular-nums text-red-300">
						{rm(result.missedRevenue)}
					</dd>
				</div>
				<div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3">
					<dt className="text-primary-foreground/70">Time chasing payments</dt>
					<dd className="font-bold tabular-nums text-red-300">
						{rm(result.chaseCost)}
					</dd>
				</div>
			</dl>

			<div className="mt-6 rounded-2xl border border-accent/30 bg-accent/15 p-5">
				<p className="text-sm leading-relaxed text-primary-foreground/90">
					Kedaipal costs{" "}
					<span className="font-bold">RM{FOUNDING_PRICE_RM}/mo</span> to plug
					that leak — putting{" "}
					<span className="font-bold text-accent">{rm(result.savings)}</span>{" "}
					back in your pocket every month.
				</p>
				<p className="mt-2 inline-flex rotate-[-1deg] rounded-md bg-accent px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-foreground">
					{ratioLabel} your subscription
				</p>
			</div>
		</div>
	);
}

function DisqualifiedBody({ result }: { result: ResultCardProps["result"] }) {
	const isNoMissed = result.disqualifyReason === "no_missed";
	return (
		<div className="p-6 md:p-8">
			<p className="text-lg font-semibold">
				{isNoMissed ? "Nothing's leaking 👍" : "Not worth it yet — honestly"}
			</p>
			<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
				{isNoMissed ? (
					<>
						You told us you're not missing any orders. Then there's nothing for
						Kedaipal to plug right now — and we won't pretend otherwise. If
						orders ever start slipping through WhatsApp chat, come back and run
						this again.
					</>
				) : (
					<>
						Right now your status-quo cost ({rm(result.total)}/mo) is smaller
						than Kedaipal's RM{FOUNDING_PRICE_RM}/mo. It wouldn't pay for itself
						yet. Come back when your order volume grows.
					</>
				)}
			</p>
		</div>
	);
}
