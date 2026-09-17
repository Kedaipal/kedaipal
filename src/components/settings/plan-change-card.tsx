import { useMutation } from "convex/react";
import {
	ArrowDownRight,
	ArrowUpRight,
	Award,
	CalendarClock,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	type BillingCurrency,
	FOUNDING_PLAN,
	foundingPlanLocked,
	isPlanUpgrade,
	PLAN_FEATURES,
	type Plan,
	planChangeCarryover,
	planPrice,
} from "../../../convex/lib/plans";
import type { FixHighlight } from "../../lib/country-setup-copy";
import { highlightRingClass } from "../../lib/country-setup-copy";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../../lib/format";
import { PLAN_LABEL, type SubscriptionView } from "../../lib/subscription";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { OwnerOnlyNote } from "./owner-only-note";

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
 *
 * A Founding Member has no tier to move to (Zaki, 17 Sep 2026): they stay on
 * Founding Pro, so the card says so in place of offering a change, and
 * `changePlan` refuses it server-side.
 */
export function PlanChangeCard({
	id,
	highlight,
	sub,
	currency,
	foundingPricing,
	ownerOnly = false,
	openInvoiceNumber,
}: {
	/** Anchor + ring for `?spot=plan_change`, on every rendered state. */
	id?: string;
	highlight?: FixHighlight;
	sub: SubscriptionView;
	/** What plan changes and renewals bill in — the gateway's
	 * `renewalCurrency` (last paid invoice, else the country). */
	currency: BillingCurrency;
	/** SERVER-resolved (`billingGatewayAvailable.foundingPricing`). Never
	 * `sub.foundingIntent`: that misses every member an admin marked founding
	 * and shows a lapsed one a price `changePlan` won't bill (z8r3fdfty4). */
	foundingPricing: boolean;
	/** Admin act-as: the changes resolve the caller's own store server-side,
	 * so they're disabled here with the reason. */
	ownerOnly?: boolean;
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
	const founding = foundingPricing;
	// A Founding Member's downgrade scheduled before the founding lock is
	// cancelled (Zaki, 17 Sep 2026) — `renewalQuote` bills Founding Pro and the
	// renewal clears the flag — so it is never shown as a move that will land.
	const scheduled =
		sub.pendingPlanChange &&
		!foundingPlanLocked(sub.pendingPlanChange.plan, founding)
			? sub.pendingPlanChange
			: undefined;

	// Only the tiers a seller can actually buy, minus the one they're on — and
	// a Founding Member can buy Founding Pro alone.
	const options = (["starter", "pro"] as const).filter(
		(p) => p !== current && !foundingPlanLocked(p, founding),
	);

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
			<section
				id={id}
				data-fix-highlight={highlight ?? undefined}
				className={`flex flex-col gap-3 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(highlight)}`}
			>
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
					disabled={ownerOnly}
					className="tap-target inline-flex h-10 w-fit items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
				>
					Cancel this change — stay on {PLAN_LABEL[current]}
				</button>
				{ownerOnly ? <OwnerOnlyNote /> : null}
			</section>
		);
	}

	// A Founding Member on Founding Pro: nothing to change to. Said where the
	// change would have been offered, so "why can't I switch plans?" has its
	// answer on the spot instead of an unexplained absence.
	if (options.length === 0) {
		return (
			<section
				id={id}
				data-fix-highlight={highlight ?? undefined}
				className={`flex flex-col gap-3 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(highlight)}`}
			>
				<div className="flex items-start gap-3">
					<Award className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div>
						<p className="text-sm font-medium">Your plan stays Founding Pro</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Founding Members keep Founding Pro at{" "}
							{formatPrice(
								planPrice(FOUNDING_PLAN, cycle, true, currency),
								currency,
							)}
							/{cycle === "annual" ? "year" : "month"}, so there's no other plan
							to move to. Your founding price holds as long as your subscription
							doesn't lapse for more than 3 months.
						</p>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section
			id={id}
			data-fix-highlight={highlight ?? undefined}
			className={`flex flex-col gap-3 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(highlight)}`}
		>
			<div>
				<p className="text-sm font-medium">Change your plan</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Moving up starts right away, and everything you've already paid for
					carries over as extra days on the new plan. Moving down waits until
					your current period ends, so nothing you've paid for is lost.
				</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row">
				{options.map((plan) => {
					const up = isPlanUpgrade(current, plan);
					const blocked = ownerOnly || (up && openInvoiceNumber !== undefined);
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
			{ownerOnly ? <OwnerOnlyNote /> : null}
			{!ownerOnly &&
			openInvoiceNumber &&
			options.some((p) => isPlanUpgrade(current, p)) ? (
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
	// Same pure helper the server applies at settle, so the numbers quoted here
	// are the numbers granted — not an estimate that drifts.
	const carry = planChangeCarryover({
		fromPlan: current,
		fromCycle: cycle,
		toPlan: target,
		toCycle: cycle,
		founding,
		currency,
		periodEnd: sub.currentPeriodEnd,
		now: Date.now(),
	});
	const opening = `You'll be invoiced ${formatPrice(price, currency)} and ${PLAN_LABEL[target]} starts as soon as it's paid.`;
	if (carry.days <= 0) return opening;
	// Say WHY the day count shrinks. "16 days carry over" beside a billing page
	// promising another 30 reads as 14 days confiscated; what carries is every
	// sen of it, and the tier being bought simply costs more per day.
	const day = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
	return `${opening} Your ${day(carry.daysLeft)} left on ${PLAN_LABEL[current]} aren't lost — they're worth ${formatPrice(carry.valueLeftSen, currency)}, and at ${PLAN_LABEL[target]}'s higher daily rate that buys ${day(carry.days)}, added on top of your new month.`;
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
