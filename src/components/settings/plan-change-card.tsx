import { useMutation } from "convex/react";
import { ArrowDownRight, ArrowUpRight, CalendarClock } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	type BillingCurrency,
	isPlanUpgrade,
	PLAN_FEATURES,
	type Plan,
	planChangeCarryoverDays,
	planPrice,
} from "../../../convex/lib/plans";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../../lib/format";
import { PLAN_LABEL, type SubscriptionView } from "../../lib/subscription";
import { ConfirmDialog } from "../ui/confirm-dialog";

/** What a seller actually loses by dropping to a lower tier, in their words —
 * derived from PLAN_FEATURES so it can never drift from the real gates. */
const FEATURE_LABEL: Record<string, string> = {
	crm: "your customer database",
	orderInbox: "order inbox search, filters and CSV export",
	insights: "Seller Insights",
	categories: "building product categories",
	chargeablePickup: "charging a pickup fee",
	radiusDelivery: "distance-based delivery pricing",
	delivery: "Lalamove booking",
	onlinePayments: "online payments for your buyers",
	waOrderAlerts: "WhatsApp order alerts",
};

function featuresLost(from: Plan, to: Plan): string[] {
	const a = PLAN_FEATURES[from];
	const b = PLAN_FEATURES[to];
	return Object.keys(a)
		.filter((k) => a[k as keyof typeof a] && !b[k as keyof typeof b])
		.map((k) => FEATURE_LABEL[k] ?? k);
}

/**
 * Settings → Billing: change tier on an ACTIVE subscription (86eyb6z4r).
 *
 * The two directions are deliberately different, and the copy says so before
 * anything is confirmed:
 *  - UP is immediate and billed at the ordinary price; the days already paid
 *    for on the old tier carry over, so nothing is forfeited.
 *  - DOWN waits for the end of the period already bought — the seller keeps
 *    every feature until then, and the dialog names exactly what goes away
 *    when it lands, because losing the customer database by surprise is the
 *    kind of thing a seller only discovers when they need it.
 */
export function PlanChangeCard({
	sub,
	currency,
	openInvoiceNumber,
}: {
	sub: SubscriptionView;
	currency: BillingCurrency;
	/** The seller's unsettled invoice, if any. Moving UP writes a second bill,
	 * which the server refuses while one is open — so the option is disabled
	 * with the invoice named, rather than erroring on confirm. Moving DOWN
	 * costs nothing and stays available. */
	openInvoiceNumber?: string;
}) {
	const changePlan = useMutation(api.invoices.changePlan);
	const cancelPlanChange = useMutation(api.invoices.cancelPlanChange);
	const [target, setTarget] = useState<"starter" | "pro" | null>(null);
	const [busy, setBusy] = useState(false);

	const current = sub.plan;
	const cycle = sub.billingCycle ?? "monthly";
	const founding = sub.foundingIntent === true;
	const scheduled = sub.pendingPlanChange;

	// Only the tiers a seller can actually buy, minus the one they're on.
	const options = (["starter", "pro"] as const).filter((p) => p !== current);

	const confirm = async (plan: "starter" | "pro") => {
		setBusy(true);
		try {
			const result = await changePlan({ plan });
			if (result.kind === "scheduled") {
				toast.success(
					`Moving to ${PLAN_LABEL[plan]} on ${formatShortDate(result.effectiveAt)}`,
					{
						description:
							"Nothing changes until then — and you can cancel any time.",
					},
				);
			} else if (result.chargingSavedMethod) {
				toast.success(`Upgrading to ${PLAN_LABEL[plan]}`, {
					description: "Charging your saved payment method now.",
				});
			} else {
				toast.success(`Your ${PLAN_LABEL[plan]} invoice is ready`, {
					description: "Pay it below and the new plan starts straight away.",
				});
			}
			setTarget(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const undo = async () => {
		try {
			await cancelPlanChange({});
			toast.success("Plan change cancelled", {
				description: `You're staying on ${PLAN_LABEL[current]}.`,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	};

	if (scheduled) {
		return (
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
				<div className="flex items-start gap-3">
					<CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div>
						<p className="text-sm font-medium">
							Moving to {PLAN_LABEL[scheduled.plan]} on{" "}
							{formatShortDate(scheduled.effectiveAt)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							You keep {PLAN_LABEL[current]} — every feature and limit — until
							then, because you've already paid for it. Your next invoice will
							be{" "}
							{formatPrice(
								planPrice(scheduled.plan, cycle, founding, currency),
								currency,
							)}{" "}
							for {PLAN_LABEL[scheduled.plan]}.
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={undo}
					className="tap-target inline-flex h-10 w-fit items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
				>
					Cancel this change — stay on {PLAN_LABEL[current]}
				</button>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div>
				<p className="text-sm font-medium">Change your plan</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Moving up starts right away and the days you've already paid for carry
					over. Moving down waits until your current period ends, so nothing
					you've paid for is lost.
				</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row">
				{options.map((plan) => {
					const up = isPlanUpgrade(current, plan);
					const blocked = up && openInvoiceNumber !== undefined;
					return (
						<button
							key={plan}
							type="button"
							disabled={blocked}
							onClick={() => setTarget(plan)}
							className="tap-target inline-flex h-11 w-fit items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
						>
							{up ? (
								<ArrowUpRight className="size-4" />
							) : (
								<ArrowDownRight className="size-4" />
							)}
							{up ? "Move up to" : "Move down to"} {PLAN_LABEL[plan]}
						</button>
					);
				})}
			</div>
			{openInvoiceNumber && options.some((p) => isPlanUpgrade(current, p)) ? (
				<p className="text-xs text-muted-foreground">
					Moving up waits until invoice{" "}
					<span className="font-mono">{openInvoiceNumber}</span> is settled —
					two open bills at once is how a paid-up store ends up locked out.
				</p>
			) : null}

			{target ? (
				<ConfirmDialog
					open={target !== null}
					onOpenChange={(open) => {
						if (!open) setTarget(null);
					}}
					title={
						isPlanUpgrade(current, target)
							? `Move up to ${PLAN_LABEL[target]}?`
							: `Move down to ${PLAN_LABEL[target]}?`
					}
					description={
						isPlanUpgrade(current, target)
							? upgradeCopy({ current, target, cycle, founding, currency, sub })
							: downgradeCopy({
									current,
									target,
									cycle,
									founding,
									currency,
									sub,
								})
					}
					confirmLabel={busy ? "Working…" : `Move to ${PLAN_LABEL[target]}`}
					onConfirm={() => confirm(target)}
				/>
			) : null}
		</section>
	);
}

function upgradeCopy({
	current,
	target,
	cycle,
	founding,
	currency,
	sub,
}: {
	current: Plan;
	target: Plan;
	cycle: "monthly" | "annual";
	founding: boolean;
	currency: BillingCurrency;
	sub: SubscriptionView;
}): string {
	const price = planPrice(
		target,
		cycle,
		founding && target === "pro",
		currency,
	);
	// Same pure helper the server applies at settle, so the number quoted here
	// is the number granted — not an estimate that drifts.
	const carried = planChangeCarryoverDays({
		fromPlan: current,
		fromCycle: cycle,
		toPlan: target,
		toCycle: cycle,
		founding,
		currency,
		periodEnd: sub.currentPeriodEnd,
		now: Date.now(),
	});
	const carriedLine =
		carried > 0
			? ` The ${carried} day${carried === 1 ? "" : "s"} you've already paid for carry over, so your next bill moves back by the same amount.`
			: "";
	return `You'll be invoiced ${formatPrice(price, currency)} and ${PLAN_LABEL[target]} starts as soon as it's paid.${carriedLine} Nothing you've already paid for is lost.`;
}

function downgradeCopy({
	current,
	target,
	cycle,
	founding,
	currency,
	sub,
}: {
	current: Plan;
	target: Plan;
	cycle: "monthly" | "annual";
	founding: boolean;
	currency: BillingCurrency;
	sub: SubscriptionView;
}): React.ReactNode {
	const lost = featuresLost(current, target);
	const when = sub.currentPeriodEnd
		? formatShortDate(sub.currentPeriodEnd)
		: "the end of your current period";
	const nowPrice = planPrice(current, cycle, founding, currency);
	const thenPrice = planPrice(target, cycle, founding, currency);
	// DialogDescription is a <p>, so the "list" is block spans rather than a
	// <ul> — a nine-item comma run inside a paragraph is not something a seller
	// reads, and these are the capabilities they are about to lose.
	return (
		<>
			<span className="block">
				You'll stay on {PLAN_LABEL[current]} with everything you have now until{" "}
				{when}, because you've paid for it.
			</span>
			<span className="mt-2 block">
				Your next invoice is{" "}
				<span className="font-medium text-foreground">
					{formatPrice(thenPrice, currency)} for {PLAN_LABEL[target]}
				</span>
				, instead of {formatPrice(nowPrice, currency)}.
			</span>
			{lost.length ? (
				<>
					<span className="mt-2 block">From {when} you lose:</span>
					{/* Bounded: nine losses wrap to ~15 lines on a 375px phone, and
					    DialogContent has no max-height and clips (overflow-hidden),
					    which would put the Cancel/confirm buttons out of reach. */}
					<span className="mt-1 block max-h-52 overflow-y-auto">
						{lost.map((feature) => (
							<span key={feature} className="block -indent-3 pl-6">
								<span className="text-muted-foreground/60">•</span> {feature}
							</span>
						))}
					</span>
					<span className="mt-2 block">
						Your data stays — you just won't be able to open it until you move
						back up.
					</span>
				</>
			) : null}
			<span className="mt-2 block">
				You can cancel this any time before it takes effect.
			</span>
		</>
	);
}
