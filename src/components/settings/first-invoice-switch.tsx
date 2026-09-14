import { useMutation } from "convex/react";
import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { type BillingCurrency, planPrice } from "../../../convex/lib/plans";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { PLAN_LABEL } from "../../lib/subscription";
import { Button } from "../ui/button";

/**
 * Inside the pending-invoice card: switch a MACHINE-issued plan invoice to the
 * other tier before paying it (z8r3fday24). Every trial runs on Pro, so the
 * first invoice bills Pro — this is where a seller who wants Starter says so,
 * in one tap, keeping the same due date. States the consequence that
 * matters: paying a Starter invoice moves the store to Starter, which has no
 * customer database, order inbox or insights. Admin-issued invoices never
 * show this (Arif may have priced them by hand) — `invoices.switchPendingPlan`
 * refuses those server-side too.
 */
export function FirstInvoiceSwitch({
	invoicePlan,
	currency,
	founding,
}: {
	invoicePlan: "starter" | "pro";
	currency: BillingCurrency;
	/** The invoice carries a founding discount — the Pro price shown for a
	 * switch back must be the founding one, or the number lies. */
	founding: boolean;
}) {
	const switchPlan = useMutation(api.invoices.switchPendingPlan);
	const [busy, setBusy] = useState(false);
	const target = invoicePlan === "pro" ? "starter" : "pro";
	const targetPrice = formatPrice(
		planPrice(target, "monthly", founding && target === "pro", currency),
		currency,
	);

	const submit = async () => {
		setBusy(true);
		try {
			await switchPlan({ plan: target });
			toast.success(`Invoice switched to ${PLAN_LABEL[target]}`, {
				description: "Same due date — pay it below when you're ready.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-xs text-muted-foreground">
				{invoicePlan === "pro" ? (
					<>
						This invoice is for{" "}
						<span className="font-medium text-foreground">Pro</span> — paying it
						starts Pro. Prefer Starter ({targetPrice}/month)? It has no customer
						database, order inbox or insights, but everything else works the
						same.
					</>
				) : (
					<>
						This invoice is for{" "}
						<span className="font-medium text-foreground">Starter</span> —
						paying it moves your store to Starter. Want to keep the customer
						database, order inbox and insights? Switch back to Pro (
						{targetPrice}/month).
					</>
				)}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={busy}
				onClick={submit}
				className="h-10 w-fit shrink-0 gap-1.5"
			>
				<ArrowLeftRight className="size-4" aria-hidden />
				{busy ? "Switching…" : `Switch to ${PLAN_LABEL[target]}`}
			</Button>
		</div>
	);
}
