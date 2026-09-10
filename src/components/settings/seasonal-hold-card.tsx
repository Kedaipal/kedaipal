import { useMutation } from "convex/react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	HOLD_MONTHLY_PRICES,
} from "../../../convex/lib/plans";
import { HOLD_LABEL, holdBillsNow } from "../../../convex/lib/seasonalHold";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../../lib/format";
import { PLAN_LABEL, type SubscriptionView } from "../../lib/subscription";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";

/**
 * Settings → Billing: the Off-Season Hold switch (z8r3fday24). Rendered for
 * every real (non-comped, non-admin) paid seller so the pause is discoverable
 * where billing lives — a seasonal seller must never find out about it from
 * the pricing page after they've already churned. Four states:
 *
 *  - `active`         → offer the pause, with the price and when it starts billing.
 *  - `past_due` (plan) → offer "pause instead of paying the tier".
 *  - `on_hold`        → the resume switch, with what a resume bills.
 *  - `past_due` (hold) → the hold invoice is overdue: pay it, or resume now.
 *
 * Every consequence is stated before the tap (what pauses, what stays live,
 * what's billed and when, that unused hold days aren't refunded) — the
 * confirm dialog repeats the one that costs money.
 */
export function SeasonalHoldCard({
	retailerId,
	country,
	sub,
	pendingKind,
}: {
	retailerId: Id<"retailers">;
	country: "MY" | "SG";
	sub: SubscriptionView;
	/** Kind of the seller's pending invoice, if any — a past_due seller's
	 * way out differs by whether the unpaid bill is the tier or the hold. */
	pendingKind?: "plan" | "hold";
}) {
	const setHold = useMutation(api.subscriptions.setSeasonalHold);
	const [confirm, setConfirm] = useState<"pause" | "resume" | null>(null);
	const currency = BILLING_CURRENCY_FOR_COUNTRY[country];
	const price = formatPrice(HOLD_MONTHLY_PRICES[currency], currency);
	const plan = PLAN_LABEL[sub.plan];
	const now = Date.now();
	const paidThrough =
		sub.currentPeriodEnd !== undefined && sub.currentPeriodEnd > now
			? sub.currentPeriodEnd
			: undefined;

	const held = sub.status === "on_hold" || sub.held === true;
	const lockedOverHold = sub.status === "past_due" && pendingKind === "hold";
	const lockedOverPlan = sub.status === "past_due" && !lockedOverHold;
	if (!held && !lockedOverHold && !lockedOverPlan && sub.status !== "active")
		return null;

	// The price is the headline fact of this card — a chip beside the title,
	// never buried mid-paragraph (Zaki, 10 Sep: "RM19 doesn't seem prominent").
	const priceChip = (
		<span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold tabular-nums text-accent">
			{price}/month
		</span>
	);

	const run = async (hold: boolean) => {
		try {
			const res = await setHold({ retailerId, hold });
			toast.success(
				hold
					? "Off-Season Hold is on — ordering is paused"
					: `${plan} is back on — your store is taking orders`,
				{
					description: res.invoiceIssued
						? "Your invoice is on its way; you have 14 days to pay it."
						: hold
							? `Nothing to pay until ${paidThrough ? formatShortDate(paidThrough) : "your period ends"}.`
							: "You're already paid up — nothing to pay right now.",
				},
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			throw err;
		}
	};

	// --- Resume states -------------------------------------------------------
	if (held || lockedOverHold) {
		const resumeBillsNow =
			paidThrough === undefined || (sub.periodPaidBy ?? "plan") === "hold";
		return (
			<section className="flex flex-col gap-4 rounded-2xl border border-accent/30 bg-accent/5 p-5 lg:p-6">
				<div className="flex items-start gap-3">
					<PauseCircle
						className="mt-0.5 size-5 shrink-0 text-accent"
						aria-hidden
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm font-semibold">
								{lockedOverHold
									? "Your hold invoice is overdue"
									: `On ${HOLD_LABEL}${sub.heldAt ? ` since ${formatShortDate(sub.heldAt)}` : ""}`}
							</p>
							{priceChip}
						</div>
						<p className="text-xs text-muted-foreground">
							<span className="font-medium text-foreground/80">Paused:</span>{" "}
							new orders — buyers see a seasonal-break note, not a dead link.
						</p>
						<p className="text-xs text-muted-foreground">
							<span className="font-medium text-foreground/80">
								Still live:
							</span>{" "}
							storefront, catalog, buyer list, order history and editing.
						</p>
						{lockedOverHold ? (
							<p className="text-xs text-muted-foreground">
								Pay the hold invoice above to stay paused, or resume {plan} now
								— the hold invoice is cancelled and your {plan} invoice is
								issued instead.
							</p>
						) : null}
					</div>
				</div>
				<div className="flex flex-col gap-2 border-t border-accent/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-xs text-muted-foreground">
						{resumeBillsNow
							? `Resuming issues your ${plan} invoice right away, with 14 days to pay — you keep full access meanwhile. Any unused hold days aren't refunded.`
							: `You're paid up for ${plan} until ${paidThrough ? formatShortDate(paidThrough) : "your period ends"} — resuming bills nothing today.`}
					</p>
					<Button
						type="button"
						onClick={() => setConfirm("resume")}
						className="h-11 w-fit shrink-0 gap-1.5"
					>
						<PlayCircle className="size-4" aria-hidden />
						Resume {plan}
					</Button>
				</div>
				<ConfirmDialog
					open={confirm === "resume"}
					onOpenChange={(open) => setConfirm(open ? "resume" : null)}
					title={`Resume ${plan}?`}
					description={
						resumeBillsNow
							? `Ordering reopens straight away. Your ${plan} invoice is issued now with 14 days to pay${lockedOverHold ? ", and the overdue hold invoice is cancelled" : ""}. Unused hold days aren't refunded.`
							: `Ordering reopens straight away. You're paid up until ${paidThrough ? formatShortDate(paidThrough) : "your period ends"}, so there's nothing to pay today.`
					}
					confirmLabel={`Resume ${plan}`}
					onConfirm={() => run(false)}
				/>
			</section>
		);
	}

	// --- Pause states --------------------------------------------------------
	// THE server rule (lib/seasonalHold.ts), not a re-derivation — found live:
	// a store resumed mid-hold-bought-period (periodPaidBy "hold"), carrying the
	// pending plan invoice its resume issued, read "the hold starts billing
	// after {date}" while pausing would actually bill the hold immediately.
	const pauseBillsNow = holdBillsNow({
		currentPeriodEnd: sub.currentPeriodEnd,
		periodPaidBy: sub.periodPaidBy,
		hadPendingInvoice: pendingKind === "plan",
		now,
	});
	const voidsPlanInvoice = pendingKind === "plan";
	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div className="flex items-start gap-3">
				<PauseCircle
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-semibold">
							{lockedOverPlan
								? `Rather pause than pay for ${plan}?`
								: HOLD_LABEL}
						</p>
						{priceChip}
					</div>
					<p className="text-xs text-muted-foreground">
						Between seasons? Keep everything warm while ordering takes a break.
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="font-medium text-foreground/80">Paused:</span> new
						orders — buyers see a seasonal-break note, not a dead link.
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="font-medium text-foreground/80">Still live:</span>{" "}
						storefront, catalog, buyer list, order history and editing. One tap
						brings {plan} back.
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-xs text-muted-foreground">
					{lockedOverPlan
						? `Your unpaid ${plan} invoice is cancelled, editing unlocks, and your first hold invoice (${price}) is issued now with 14 days to pay.`
						: voidsPlanInvoice
							? `Your unpaid ${plan} invoice is cancelled and your first hold invoice (${price}) is issued now, with 14 days to pay.`
							: pauseBillsNow
								? `Your first hold invoice (${price}) is issued right away, with 14 days to pay.`
								: `You're paid up for ${plan} until ${paidThrough ? formatShortDate(paidThrough) : "your period ends"} — the hold starts billing after that.`}
				</p>
				<Button
					type="button"
					variant="outline"
					onClick={() => setConfirm("pause")}
					className="h-11 w-fit shrink-0 gap-1.5"
				>
					<PauseCircle className="size-4" aria-hidden />
					{lockedOverPlan ? "Pause instead" : "Pause for the season"}
				</Button>
			</div>
			<ConfirmDialog
				open={confirm === "pause"}
				onOpenChange={(open) => setConfirm(open ? "pause" : null)}
				title="Pause for the season?"
				description={`New orders stop immediately — buyers see a seasonal-break note. Everything else stays live. ${
					voidsPlanInvoice
						? `Your unpaid ${plan} invoice is cancelled and your first ${price} hold invoice is issued now.`
						: pauseBillsNow
							? `Your first ${price} hold invoice is issued now.`
							: `The ${price}/month hold starts billing after ${paidThrough ? formatShortDate(paidThrough) : "your current period"}.`
				} Resume any time from here.`}
				confirmLabel="Pause ordering"
				onConfirm={() => run(true)}
			/>
		</section>
	);
}
