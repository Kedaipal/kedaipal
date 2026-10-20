import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { CreditLockErrorData } from "../../../convex/lib/credits";
import { lockCta } from "../../lib/credits-ui";
import { Button } from "../ui/button";

/**
 * The way back, next to a save the credit lock refused (Credits T3). The
 * refusal is typed, so a form whose save couldn't land offers "Top up" (or
 * "Pick a plan", …) right under the sentence instead of ending in a dead end.
 * Renders nothing for any other error, or for a teammate who can't take the
 * way back — their sentence already says to ask the owner.
 */
export function CreditLockCta({ lock }: { lock: CreditLockErrorData | null }) {
	if (!lock || lock.audience === "member") return null;
	const cta = lockCta(lock.unlockRoute);
	return (
		<Button asChild size="lg" className="mt-2 h-11 w-full px-4 sm:h-9 sm:w-fit">
			<Link to="/app/settings" search={cta.search}>
				{cta.label}
			</Link>
		</Button>
	);
}

/**
 * Why Save is greyed out, said where the seller is about to press it — the
 * shared Button can't show a tooltip while disabled, and on a long form the
 * page-top note has scrolled away. `reason` is the same sentence the server
 * would refuse with (view-only, out of credits, or a teammate's missing grant).
 */
export function SaveLockNote({ reason }: { reason: string }) {
	return (
		<p className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
			<Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
			<span>{reason}</span>
		</p>
	);
}
