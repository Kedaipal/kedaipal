import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useCreditLock } from "../../hooks/useCreditLock";
import { useStoreLock } from "../../hooks/useStoreLock";
import { lockCta, ordersWaitingLabel } from "../../lib/credits-ui";
import { Button } from "../ui/button";

const SCOPE_LINE = {
	orders:
		"Accepting and updating orders is paused until you add credits. Cancelling and refunding still work.",
	products: "Adding and editing products is paused until you add credits.",
} as const;

/**
 * The in-place "out of credits" note (Credits T3) for the screens the lock
 * touches — the order inbox, the order page, the product list and form. The
 * app-shell banner is the alarm; this is the explanation next to the controls
 * that are greyed out, with the one way back. Muted like `ViewOnlyNote`, so it
 * doesn't read as a second alarm under the banner. Renders nothing while the
 * store has credits — or while the whole store is view-only, where
 * `ViewOnlyNote` already says more (and paying the invoice is the way back
 * for both) — so a call site is one line.
 */
export function CreditLockNote({
	scope,
	className,
}: {
	scope: keyof typeof SCOPE_LINE;
	className?: string;
}) {
	const lock = useCreditLock();
	const store = useStoreLock();
	if (!lock.locked || store.readOnly) return null;
	const waiting = ordersWaitingLabel(lock.ordersWaiting);
	const cta = lockCta(lock.route);
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
					<p className="font-semibold text-foreground">
						Out of credits{waiting ? ` · ${waiting}` : ""}
					</p>
					<p className="text-muted-foreground">
						{SCOPE_LINE[scope]}
						{lock.canAct ? "" : " Ask the store owner to add credits."}
					</p>
				</div>
			</div>
			{!lock.canAct ? null : (
				<Button asChild size="lg" className="h-11 w-full px-4 sm:h-9 sm:w-auto">
					<Link to="/app/settings" search={cta.search}>
						{cta.label}
					</Link>
				</Button>
			)}
		</div>
	);
}
