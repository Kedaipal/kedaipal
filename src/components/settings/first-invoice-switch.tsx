import { useMutation } from "convex/react";
import { ArrowLeftRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	type BillingCurrency,
	foundingPlanLocked,
	isPlanSelectable,
	PLAN_CAPS,
	PLAN_CREDIT_GRANT,
	type Plan,
	PLANS,
	planPrice,
} from "../../../convex/lib/plans";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { PLAN_LABEL } from "../../lib/subscription";
import { Button } from "../ui/button";
import { OwnerOnlyNote } from "./owner-only-note";

/**
 * The tiers a pending machine-issued invoice can be switched to: every other
 * tier that's for sale, minus any a Founding Member can't move to (they stay
 * on Founding Pro, so for them this is empty and the tab renders nothing).
 * Exported so the tab decides whether to render from the same answer.
 */
export function firstInvoiceTargets(
	invoicePlan: Plan,
	foundingPricing: boolean,
): Plan[] {
	return PLANS.filter(
		(p) =>
			p !== invoicePlan &&
			isPlanSelectable(p) &&
			!foundingPlanLocked(p, foundingPricing),
	);
}

/**
 * Inside the pending-invoice card: switch a MACHINE-issued plan invoice to
 * another tier before paying it (z8r3fday24). Every trial runs on Pro, so the
 * first invoice bills Pro — this is where a seller who wants Starter, or
 * (since Scale opened, z8r3fdfuhq) Scale, says so, in one tap, keeping the
 * same due date. Without the Scale option, `/pricing`'s "Subscribe" on the
 * Scale card led a trialing seller to a Pro bill with no way to choose Scale.
 *
 * States the consequence that matters for each move, where the tap is: Starter
 * has no customer database, order inbox or insights; Scale's reason to exist
 * today is its credits and teammates. Admin-issued invoices never show this
 * (Arif may have priced them by hand) — `invoices.switchPendingPlan` refuses
 * those server-side too.
 */
export function FirstInvoiceSwitch({
	invoicePlan,
	currency,
	founding,
	ownerOnly = false,
}: {
	invoicePlan: Plan;
	currency: BillingCurrency;
	/** SERVER-resolved (`billingGatewayAvailable.foundingPricing`) — the Pro
	 * price shown for a switch back must be the founding one, or the number
	 * lies. Not the open invoice's discount: a Starter invoice never carries
	 * one, so that read quoted a founding member list Pro (z8r3fdfty4). */
	founding: boolean;
	/** Admin act-as: the switch resolves the caller's own store server-side —
	 * disabled with the reason. */
	ownerOnly?: boolean;
}) {
	const switchPlan = useMutation(api.invoices.switchPendingPlan);
	const [busy, setBusy] = useState<Plan | null>(null);
	const targets = firstInvoiceTargets(invoicePlan, founding);
	const monthly = (plan: Plan) =>
		formatPrice(
			planPrice(plan, "monthly", founding && plan === "pro", currency),
			currency,
		);

	const submit = async (target: Plan) => {
		setBusy(target);
		try {
			await switchPlan({ plan: target });
			toast.success(`Invoice switched to ${PLAN_LABEL[target]}`, {
				description: "Same due date — pay it below when you're ready.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(null);
		}
	};

	/** What moving to `target` changes, in the seller's terms. */
	const consequence = (target: Plan): ReactNode => {
		const credits = PLAN_CREDIT_GRANT[target];
		if (target === "starter")
			return (
				<>
					Prefer Starter ({monthly("starter")}/month, {credits} credits a
					month)? It has no customer database, order inbox or insights, but
					everything else works the same.
				</>
			);
		if (target === "pro")
			return invoicePlan === "starter" ? (
				<>
					Want to keep the customer database, order inbox and insights? Switch
					back to Pro ({monthly("pro")}/month, {credits} credits a month).
				</>
			) : (
				<>
					Prefer Pro ({monthly("pro")}/month)? It has {credits} credits a month
					and room for {PLAN_CAPS.pro.userCap - 1} teammates.
				</>
			);
		return (
			<>
				Need more volume? Scale ({monthly("scale")}/month) has {credits} credits
				a month and room for {PLAN_CAPS.scale.userCap - 1} teammates.
			</>
		);
	};

	if (targets.length === 0) return null;

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3">
			<div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
				<p>
					This invoice is for{" "}
					<span className="font-medium text-foreground">
						{PLAN_LABEL[invoicePlan]}
					</span>{" "}
					—{" "}
					{invoicePlan === "pro"
						? "paying it starts Pro."
						: `paying it moves your store to ${PLAN_LABEL[invoicePlan]}.`}
				</p>
				{targets.map((target) => (
					<p key={target}>{consequence(target)}</p>
				))}
			</div>
			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				{targets.map((target) => (
					<Button
						key={target}
						type="button"
						variant="outline"
						size="sm"
						disabled={busy !== null || ownerOnly}
						onClick={() => submit(target)}
						className="h-10 w-fit shrink-0 gap-1.5"
					>
						<ArrowLeftRight className="size-4" aria-hidden />
						{busy === target ? "Switching…" : `Switch to ${PLAN_LABEL[target]}`}
					</Button>
				))}
			</div>
			{ownerOnly ? <OwnerOnlyNote /> : null}
		</div>
	);
}
