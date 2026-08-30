import { ArrowRight, TrendingDown } from "lucide-react";
import { useState } from "react";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
} from "#/../convex/lib/plans";
import { RegionToggle } from "#/components/landing/landing-ui";
import { AppImage } from "#/components/ui/app-image";
import { Button } from "#/components/ui/button";
import { Field, FieldLabel } from "#/components/ui/field";
import { Slider } from "#/components/ui/slider";
import { useLandingRegion } from "#/hooks/useLandingRegion";
import { useSupportWaNumber } from "#/hooks/useSupportWaNumber";
import {
	BOUNDS_FOR,
	type CostInputs,
	clampInputs,
	computeStatusQuoCost,
	DEFAULT_INPUTS_FOR,
	FOUNDING_PRICE,
} from "#/lib/calculator";
import { buildWaContactLink } from "#/lib/contact";
import { currencySymbol, formatPrice } from "#/lib/format";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** Render a major-unit amount via the shared minor-unit formatter. */
function money(major: number, currency: BillingCurrency): string {
	return formatPrice(Math.round(major * 100), currency);
}

/**
 * The Founding price as it reads inside a sentence — "RM104", "S$41". The
 * message catalogs used to hardcode the "RM", which left an SG visitor being
 * quoted ringgit beside S$ figures; they now take this whole string.
 */
function foundingPriceLabel(currency: BillingCurrency): string {
	return `${currencySymbol(currency)}${FOUNDING_PRICE[currency]}`;
}

function buildWaLink(
	monthlyCost: number,
	supportWa: string,
	currency: BillingCurrency,
): string {
	const message = m.cost_wa_message({
		cost: money(monthlyCost, currency),
		price: foundingPriceLabel(currency),
	});
	return buildWaContactLink(message, supportWa);
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
	/**
	 * Prefill from `/cost?w=&aov=&m=&min=`. Partial on purpose: only the fields
	 * the link actually carried count as "entered", so the rest still follow
	 * the region's own defaults.
	 */
	initialInputs?: Partial<CostInputs>;
	/** Called on every input change so the route can mirror state into the URL. */
	onInputsChange?: (inputs: CostInputs) => void;
}

export function CostCalculator({
	initialInputs,
	onInputsChange,
}: CostCalculatorProps) {
	// The calculator owns the region, not the route: every currency-shaped
	// value here (the Founding anchor, the labour rate, the AOV slider's range
	// and default) is derived from it, and keeping one owner means the toggle
	// can never disagree with the numbers beside it.
	const [region, setRegion] = useLandingRegion();
	const currency: BillingCurrency = BILLING_CURRENCY_FOR_COUNTRY[region];
	const bounds = BOUNDS_FOR[currency];

	// State holds only what the visitor actually stated (a shared link's params,
	// then each slider they move). Everything else is derived, so switching
	// region re-seeds the untouched fields with that region's defaults while
	// keeping the numbers they did enter — clamped into the new slider's range,
	// since an RM 400 basket has no S$ slider position.
	const [entered, setEntered] = useState<Partial<CostInputs>>(
		() => initialInputs ?? {},
	);
	const inputs = clampInputs(
		{ ...DEFAULT_INPUTS_FOR[currency], ...entered },
		bounds,
	);

	const update = (patch: Partial<CostInputs>) => {
		const next = { ...inputs, ...patch };
		setEntered(next);
		onInputsChange?.(next);
	};

	const supportWa = useSupportWaNumber();
	const result = computeStatusQuoCost(inputs, currency);
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
						{m.cost_badge()}
					</span>
					<h1
						className="mt-5 text-3xl font-bold tracking-tight md:text-5xl"
						style={{ letterSpacing: "-0.03em" }}
					>
						{m.cost_heading_1()}{" "}
						<span className="kp-highlight text-destructive">
							{m.cost_heading_2()}
						</span>
					</h1>
					<p className="mx-auto mt-4 max-w-md text-muted-foreground md:text-lg">
						{m.cost_sub()}
					</p>
					{/* Same control, same place in the reading order as the pricing
					    teaser and /pricing. It carries a visible label here because
					    on this page it also reshapes the seller's OWN numbers — the
					    currency of every slider and the leak total — not just the
					    price we quote. */}
					<div className="mt-6 flex flex-col items-center gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							{m.region_toggle_label()}
						</span>
						<RegionToggle region={region} onChange={setRegion} />
					</div>
				</header>

				<div className="mt-10 grid items-start gap-6 md:mt-14 md:grid-cols-[1fr_0.95fr] md:gap-8">
					{/* Inputs */}
					<div className="space-y-7 rounded-3xl border border-border bg-card p-6 shadow-md md:p-8">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
							{m.cost_your_numbers()}
						</p>
						<SliderRow
							label={m.cost_orders_week()}
							value={inputs.ordersPerWeek}
							display={`${inputs.ordersPerWeek}`}
							min={bounds.ordersPerWeek.min}
							max={bounds.ordersPerWeek.max}
							step={bounds.ordersPerWeek.step}
							onChange={(v) => update({ ordersPerWeek: v })}
						/>
						<SliderRow
							label={m.cost_aov()}
							value={inputs.aov}
							display={money(inputs.aov, currency)}
							min={bounds.aov.min}
							max={bounds.aov.max}
							step={bounds.aov.step}
							onChange={(v) => update({ aov: v })}
						/>
						<SliderRow
							label={m.cost_missed_week()}
							value={inputs.missedPerWeek}
							display={`${inputs.missedPerWeek}`}
							min={bounds.missedPerWeek.min}
							max={bounds.missedPerWeek.max}
							step={bounds.missedPerWeek.step}
							onChange={(v) => update({ missedPerWeek: v })}
						/>
						<div className="border-t border-border/60 pt-6">
							<SliderRow
								label={m.cost_chase_min()}
								value={inputs.chaseMin}
								display={m.cost_min_suffix({ minutes: inputs.chaseMin })}
								min={bounds.chaseMin.min}
								max={bounds.chaseMin.max}
								step={bounds.chaseMin.step}
								onChange={(v) => update({ chaseMin: v })}
							/>
						</div>
					</div>

					{/* Result card — designed to screenshot cleanly */}
					<div className="md:sticky md:top-24">
						<ResultCard
							result={result}
							ratioLabel={ratioLabel}
							currency={currency}
						/>
					</div>
				</div>

				{/* Sticky bottom CTA */}
				<div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
					<div className="mx-auto max-w-xl">
						{result.disqualified ? (
							<div className="flex flex-col items-center gap-1 text-center">
								<p className="text-sm text-muted-foreground">
									{m.cost_disq_reassure()}
								</p>
								<Button
									asChild
									variant="outline"
									className="h-11 w-full rounded-full"
								>
									<a
										href={buildWaLink(result.total, supportWa, currency)}
										target="_blank"
										rel="noopener noreferrer"
									>
										{m.cost_keep_number()}
									</a>
								</Button>
							</div>
						) : (
							<Button
								asChild
								className="h-12 w-full rounded-full text-sm sm:text-base"
							>
								<a
									href={buildWaLink(result.total, supportWa, currency)}
									target="_blank"
									rel="noopener noreferrer"
								>
									{m.cost_cta_join({ price: foundingPriceLabel(currency) })}
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
	currency: BillingCurrency;
}

function ResultCard({ result, ratioLabel, currency }: ResultCardProps) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-3xl shadow-xl",
				result.disqualified
					? "border border-border bg-muted/40 shadow-sm"
					: "bg-cta-mesh text-cta-mesh-foreground",
			)}
		>
			{result.disqualified ? (
				<DisqualifiedBody result={result} currency={currency} />
			) : (
				<QualifiedBody
					result={result}
					ratioLabel={ratioLabel}
					currency={currency}
				/>
			)}

			{/* Self-branding footer so a screenshot carries the source. */}
			<div
				className={cn(
					"flex items-center justify-between border-t px-6 py-3 text-xs",
					result.disqualified
						? "border-border/60 text-muted-foreground"
						: "border-white/10 text-cta-mesh-foreground/60",
				)}
			>
				<AppImage
					src={result.disqualified ? "/logo-3.svg" : "/logo-dark.svg"}
					alt="Kedaipal"
					aspect="h-5 w-auto"
					fill={false}
				/>
				<span>kedaipal.com/cost</span>
			</div>
		</div>
	);
}

function QualifiedBody({ result, ratioLabel, currency }: ResultCardProps) {
	return (
		<div className="p-6 md:p-8">
			<p className="text-sm font-medium text-cta-mesh-foreground/65">
				{m.cost_result_lead()}
			</p>
			<p className="mt-2 text-5xl font-bold tracking-tight md:text-6xl">
				{money(result.total, currency)}
				<span className="text-xl font-semibold text-cta-mesh-foreground/50">
					{" "}
					{m.pricing_per_month()}
				</span>
			</p>

			<dl className="mt-7 space-y-3 text-sm">
				<div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3">
					<dt className="text-cta-mesh-foreground/70">
						{m.cost_missed_revenue()}
					</dt>
					<dd className="font-bold tabular-nums text-red-300">
						{money(result.missedRevenue, currency)}
					</dd>
				</div>
				<div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3">
					<dt className="text-cta-mesh-foreground/70">{m.cost_chase_cost()}</dt>
					<dd className="font-bold tabular-nums text-red-300">
						{money(result.chaseCost, currency)}
					</dd>
				</div>
			</dl>

			<div className="mt-6 rounded-2xl border border-accent/30 bg-accent/15 p-5">
				<p className="text-sm leading-relaxed text-cta-mesh-foreground/90">
					{m.cost_plug({
						price: foundingPriceLabel(currency),
						savings: money(result.savings, currency),
					})}
				</p>
				<p className="mt-2 inline-flex rotate-[-1deg] rounded-md bg-accent px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-foreground">
					{m.cost_ratio({ ratio: ratioLabel })}
				</p>
			</div>
		</div>
	);
}

function DisqualifiedBody({
	result,
	currency,
}: {
	result: ResultCardProps["result"];
	currency: BillingCurrency;
}) {
	const isNoMissed = result.disqualifyReason === "no_missed";
	return (
		<div className="p-6 md:p-8">
			<p className="text-lg font-semibold">
				{isNoMissed ? m.cost_disq_nomiss_title() : m.cost_disq_notyet_title()}
			</p>
			<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
				{isNoMissed
					? m.cost_disq_nomiss_body()
					: m.cost_disq_notyet_body({
							total: money(result.total, currency),
							price: foundingPriceLabel(currency),
						})}
			</p>
		</div>
	);
}
