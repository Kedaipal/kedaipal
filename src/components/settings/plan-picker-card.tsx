import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	ANNUAL_MONTHS_CHARGED,
	type BillingCurrency,
	planPrice,
} from "../../../convex/lib/plans";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import type { SubscriptionView } from "../../lib/subscription";

type PickablePlan = "starter" | "pro";
type Cycle = "monthly" | "annual";

const PLAN_PITCH: Record<PickablePlan, { name: string; pitch: string }> = {
	starter: {
		name: "Starter",
		pitch: "Storefront, orders + WhatsApp confirmations",
	},
	pro: {
		name: "Pro",
		pitch: "Everything in Starter + customer database, order inbox, insights, online payments",
	},
};

/**
 * Settings → Billing: self-serve plan picker (86eyb6z4r) — replaces the
 * "message us on WhatsApp and we'll send your invoice" card when the payment
 * gateway is configured. Pick a plan + cycle → your invoice appears with a
 * Pay-now button → paying activates the plan, nobody at Kedaipal in the
 * loop. Founding-intent stores see their promised discounted Pro price
 * (applied server-side too). Annual leads with its real hook: 2 months free.
 */
export function PlanPickerCard({
	sub,
	currency,
	renewing,
	foundingPricing,
	foundingPricingLapsed,
}: {
	sub: SubscriptionView;
	currency: BillingCurrency;
	/** past_due / cancelled ⇒ "renew" framing instead of "choose". */
	renewing: boolean;
	/** SERVER-resolved (billingGatewayAvailable) — never derived client-side
	 * from foundingIntent, which would show a lapsed founding member a
	 * discount the server won't bill. */
	foundingPricing: boolean;
	/** Founding-shaped store whose 3-month lapse window passed — explain why
	 * the price reads standard instead of leaving them to wonder. */
	foundingPricingLapsed: boolean;
}) {
	const subscribeSelf = useMutation(api.invoices.subscribeSelf);
	// Default to the seller's current plan (a renewal shouldn't nudge them off
	// it), which is Pro for every trial.
	const [plan, setPlan] = useState<PickablePlan>(
		sub.plan === "starter" ? "starter" : "pro",
	);
	const [cycle, setCycle] = useState<Cycle>("monthly");
	const [busy, setBusy] = useState(false);

	const founding = foundingPricing;

	const submit = async () => {
		setBusy(true);
		try {
			await subscribeSelf({ plan, billingCycle: cycle });
			toast.success("Invoice created", {
				description:
					"Pay it below — your plan activates the moment payment lands.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const priceLine = (p: PickablePlan) => {
		const foundingApplies = founding && p === "pro";
		const monthly = planPrice(p, "monthly", foundingApplies, currency);
		const total = planPrice(p, cycle, foundingApplies, currency);
		return cycle === "annual"
			? `${formatPrice(total, currency)}/year (${ANNUAL_MONTHS_CHARGED} months' price for 12)`
			: `${formatPrice(monthly, currency)}/month`;
	};

	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div>
				<p className="text-sm font-medium">
					{renewing ? "Renew your subscription" : "Ready to choose a plan?"}
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Pick a plan to get your invoice — pay it online and your plan
					activates straight away.
				</p>
				{foundingPricingLapsed ? (
					<p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
						Your Founding Member rank is yours for good, but the founding
						price lapses after 3 months without an active subscription — so
						these are the standard prices. Questions? Message us.
					</p>
				) : null}
			</div>

			{/* Cycle toggle — annual leads with its actual hook (2 months free). */}
			<div className="flex w-fit items-center rounded-xl border border-border p-1">
				{(["monthly", "annual"] as const).map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => setCycle(c)}
						aria-pressed={cycle === c}
						className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors ${
							cycle === c
								? "bg-foreground text-background"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{c === "monthly" ? "Monthly" : "Yearly"}
						{c === "annual" ? (
							<span
								className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
									cycle === "annual"
										? "bg-background/20 text-background"
										: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
								}`}
							>
								2 months free
							</span>
						) : null}
					</button>
				))}
			</div>

			<div className="flex flex-col gap-2">
				{(["starter", "pro"] as const).map((p) => {
					const selected = plan === p;
					const foundingApplies = founding && p === "pro";
					return (
						<button
							key={p}
							type="button"
							onClick={() => setPlan(p)}
							aria-pressed={selected}
							className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
								selected
									? "border-foreground bg-muted/50"
									: "border-border hover:border-foreground/40"
							}`}
						>
							<div>
								<p className="flex items-center gap-2 text-sm font-semibold">
									{PLAN_PITCH[p].name}
									{foundingApplies ? (
										<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
											Founding 30% off
										</span>
									) : null}
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{PLAN_PITCH[p].pitch}
								</p>
								<p className="mt-1.5 text-sm font-medium tabular-nums">
									{priceLine(p)}
								</p>
							</div>
							<span
								aria-hidden
								className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
									selected
										? "border-foreground bg-foreground text-background"
										: "border-border"
								}`}
							>
								{selected ? <Check className="size-3.5" /> : null}
							</span>
						</button>
					);
				})}
			</div>

			<button
				type="button"
				onClick={submit}
				disabled={busy}
				className="inline-flex h-11 w-fit items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
			>
				{busy
					? "Creating your invoice…"
					: `Get my ${PLAN_PITCH[plan].name} invoice`}
			</button>
			<p className="text-[11px] text-muted-foreground">
				Your plan activates once payment lands. Changing plan later or paying
				by bank transfer? Both still work — just message us.
			</p>
		</section>
	);
}
