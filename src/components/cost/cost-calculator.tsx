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
import { formatPrice } from "#/lib/format";
import { cn } from "#/lib/utils";

/**
 * Founding Member WhatsApp number for the DM CTA. wa.me requires digits only —
 * country code, no `+` or spaces (here: +60 18-473 5095 → "60184735095").
 */
const FOUNDING_WA_NUMBER = "60184735095";

/** Render an RM major-unit amount via the shared minor-unit formatter. */
function rm(major: number): string {
	return formatPrice(Math.round(major * 100), "MYR");
}

function buildWaLink(monthlyCost: number): string {
	const message = `Hi Kedaipal! I worked out WhatsApp-only ordering is costing me about ${rm(
		monthlyCost,
	)}/mo. I'd like to join as a Founding Member (RM${FOUNDING_PRICE_RM}/mo).`;
	return `https://wa.me/${FOUNDING_WA_NUMBER}?text=${encodeURIComponent(message)}`;
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
			<div className="flex items-baseline justify-between">
				<FieldLabel className="text-base">{label}</FieldLabel>
				<span className="text-lg font-semibold tabular-nums">{display}</span>
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
		<div className="mx-auto max-w-xl px-5 pb-32 pt-8 md:pt-12">
			<header className="text-center">
				<span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
					<TrendingDown className="size-3" />
					The real cost of WhatsApp-only orders
				</span>
				<h1
					className="mt-4 text-3xl font-bold tracking-tight md:text-4xl"
					style={{ letterSpacing: "-0.02em" }}
				>
					What is WhatsApp-only ordering costing you?
				</h1>
				<p className="mx-auto mt-3 max-w-md text-muted-foreground">
					Three quick guesses. We'll show you the monthly leak — honestly, even
					if it means you don't need us yet.
				</p>
			</header>

			{/* Inputs */}
			<div className="mt-8 space-y-7 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
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
				<div className="border-t border-border/60 pt-5">
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
			<ResultCard result={result} ratioLabel={ratioLabel} />

			{/* Sticky bottom CTA */}
			<div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
				<div className="mx-auto max-w-xl">
					{result.disqualified ? (
						<div className="flex flex-col items-center gap-1 text-center">
							<p className="text-sm text-muted-foreground">
								No pressure — we'll be here when it's worth it.
							</p>
							<Button asChild variant="outline" className="h-11 w-full">
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
						<Button asChild className="h-12 w-full text-base">
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
				"mt-6 overflow-hidden rounded-2xl border shadow-sm",
				result.disqualified
					? "border-border bg-muted/40"
					: "border-accent/30 bg-card",
			)}
		>
			{result.disqualified ? (
				<DisqualifiedBody result={result} />
			) : (
				<QualifiedBody result={result} ratioLabel={ratioLabel} />
			)}

			{/* Self-branding footer so a screenshot carries the source. */}
			<div className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
				<img src="/logo-3.svg" alt="Kedaipal" className="h-5 w-auto" />
				<span>kedaipal.com/cost</span>
			</div>
		</div>
	);
}

function QualifiedBody({ result, ratioLabel }: ResultCardProps) {
	return (
		<div className="p-5 md:p-6">
			<p className="text-sm font-medium text-muted-foreground">
				WhatsApp-only ordering is costing you about
			</p>
			<p className="mt-1 text-4xl font-bold tracking-tight text-accent md:text-5xl">
				{rm(result.total)}
				<span className="text-xl font-semibold text-muted-foreground">
					{" "}
					/mo
				</span>
			</p>

			<dl className="mt-5 space-y-2 text-sm">
				<div className="flex items-center justify-between">
					<dt className="text-muted-foreground">Missed-order revenue</dt>
					<dd className="font-medium tabular-nums">
						{rm(result.missedRevenue)}
					</dd>
				</div>
				<div className="flex items-center justify-between">
					<dt className="text-muted-foreground">Time chasing payments</dt>
					<dd className="font-medium tabular-nums">{rm(result.chaseCost)}</dd>
				</div>
			</dl>

			<div className="mt-5 rounded-xl bg-accent/10 p-4">
				<p className="text-sm text-foreground/90">
					Kedaipal costs{" "}
					<span className="font-semibold">RM{FOUNDING_PRICE_RM}/mo</span> to
					plug that leak — putting{" "}
					<span className="font-semibold text-accent">
						{rm(result.savings)}
					</span>{" "}
					back in your pocket every month.
				</p>
				<p className="mt-1 text-xs font-semibold uppercase tracking-wider text-accent">
					{ratioLabel} your subscription
				</p>
			</div>
		</div>
	);
}

function DisqualifiedBody({ result }: { result: ResultCardProps["result"] }) {
	const isNoMissed = result.disqualifyReason === "no_missed";
	return (
		<div className="p-5 md:p-6">
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
