import { Gift } from "lucide-react";
import type { ReferralInvite } from "../../../convex/referrals";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { Skeleton } from "../ui/skeleton";

/**
 * "Invited by <store> · bonus credits when you start" — the referral promise
 * (z8r3fdetf5) at the top of the landing hero and the `/pricing` hero, where a
 * referred visitor decides. The offer is the referee's own: what THEY get on
 * each tier, never a claim about the referrer's reward (a comped partner's
 * referrer earns nothing, so "you both get…" would be false for them).
 *
 * `undefined` holds the pill's place while the invite resolves (the visitor
 * holds a referral cookie, so one is coming): the same shell with skeleton
 * bars, so the headline below never jumps. `null` renders nothing.
 *
 * Measured, not guessed (the design-system rule): on a 375px phone the offer
 * line wraps to two, so the pill stands 67px; from `sm` it is 54px. The SAME
 * `min-h` sits on the pill and the placeholder so the two can never disagree,
 * whatever the store name or locale does to the wrap.
 */

const SHELL_CLASS =
	"inline-flex min-h-[4.25rem] max-w-full items-center gap-3 rounded-2xl border border-accent/30 bg-card/80 py-1.5 pl-1.5 pr-4 text-left shadow-sm backdrop-blur sm:min-h-[3.5rem]";
const TILE_CLASS =
	"flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent";
export function ReferralInvitePill({
	invite,
	className,
}: {
	invite: ReferralInvite | null | undefined;
	className?: string;
}) {
	if (invite === null) return null;
	if (invite === undefined)
		return (
			<div aria-hidden className={cn(SHELL_CLASS, "w-80", className)}>
				<span className={TILE_CLASS}>
					<Gift className="size-5" />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Skeleton className="h-4 w-36" />
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-2/3 sm:hidden" />
				</span>
			</div>
		);
	return (
		<p className={cn(SHELL_CLASS, className)}>
			<span className={TILE_CLASS}>
				<Gift className="size-5" aria-hidden />
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-semibold text-foreground">
					{m.referral_invite_by({ storeName: invite.storeName })}
				</span>
				<span className="text-xs leading-snug text-muted-foreground">
					{m.referral_invite_offer({
						pro: invite.offer.pro,
						starter: invite.offer.starter,
					})}
				</span>
			</span>
		</p>
	);
}
