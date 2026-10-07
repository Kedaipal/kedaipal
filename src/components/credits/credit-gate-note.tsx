import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useCreditGate } from "../../hooks/useCreditGate";
import { useStoreLock } from "../../hooks/useStoreLock";
import { lockCta, ordersWaitingLabel } from "../../lib/credits-ui";
import { Button } from "../ui/button";

/**
 * The in-place "waiting on credits" note (Credits T3.1) for the two screens
 * the gate touches: the order inbox and the order page.
 *
 * The app-shell banner is the alarm; this is the explanation sitting next to
 * the rows that are redacted and the controls that are greyed out, with the
 * one way back. Muted like `ViewOnlyNote`, so it doesn't read as a second
 * alarm under the banner. Renders nothing when no order is waiting — or while
 * the whole store is view-only, where `ViewOnlyNote` already says more (and
 * paying the invoice is the way back for both) — so a call site is one line.
 *
 * There is no `products` scope any more. The catalogue is never gated (Zaki,
 * 6 Oct 2026): products, categories, insights and settings are paid for by
 * the subscription, not by credits, so a note on those screens would be
 * announcing a restriction that doesn't exist.
 *
 * On the INBOX it also offers the filter, because a seller with 40 waiting
 * needs to see exactly those 40 — the count alone is a fact they can't act on.
 */
export function CreditGateNote({
	scope,
	className,
}: {
	/** `inbox` adds the "Show them" filter link; `order` is the single-order
	 * page, where the row the seller is looking at IS the one waiting. */
	scope: "inbox" | "order";
	className?: string;
}) {
	const gate = useCreditGate();
	const store = useStoreLock();
	if (!gate.anyWaiting || store.readOnly) return null;
	const waiting = ordersWaitingLabel(gate.ordersWaiting);
	const cta = lockCta(gate.route);
	return (
		<div
			className={`flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-3 sm:flex-row sm:items-center ${className ?? ""}`}
		>
			<div className="flex min-w-0 flex-1 items-start gap-2.5">
				<Lock
					className="mt-0.5 size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="min-w-0 text-xs leading-relaxed">
					<p className="font-semibold text-foreground">{waiting}</p>
					<p className="text-muted-foreground">
						{gate.canAct
							? "Top up and they open oldest first. Your other orders, your products and your settings all carry on as normal."
							: "Ask the store owner to add credits. Your other orders, your products and your settings all carry on as normal."}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
				{scope === "inbox" ? (
					<Button
						asChild
						variant="outline"
						size="lg"
						className="h-11 w-full px-4 sm:h-9 sm:w-auto"
					>
						<Link to="/app/orders" search={{ creditGated: true }}>
							Show{" "}
							{gate.ordersWaiting >= 99 ? "them" : `the ${gate.ordersWaiting}`}
						</Link>
					</Button>
				) : null}
				{gate.canAct ? (
					<Button
						asChild
						size="lg"
						className="h-11 w-full px-4 sm:h-9 sm:w-auto"
					>
						<Link to="/app/settings" search={cta.search}>
							{cta.label}
						</Link>
					</Button>
				) : null}
			</div>
		</div>
	);
}
