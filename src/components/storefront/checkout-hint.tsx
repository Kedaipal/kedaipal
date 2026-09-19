import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A fulfilment constraint stated where it bites, at the "when" step of both
 * checkouts: a pickup point's recurring schedule ("available Every Sat 3–5pm"),
 * the cart's prep window ("takes about 2 hours to prepare"). One component for
 * one idea, so the two hints — and the two checkouts — read alike.
 */
export function CheckoutHint({
	icon: Icon = Clock,
	children,
}: {
	icon?: LucideIcon;
	children: ReactNode;
}) {
	return (
		<p className="flex items-start gap-1.5 rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
			<Icon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
			<span>{children}</span>
		</p>
	);
}
