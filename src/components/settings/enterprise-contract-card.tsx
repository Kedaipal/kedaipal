import { Building2, CalendarClock, MessageCircle } from "lucide-react";
import { enterpriseBlockPrice } from "../../../convex/lib/enterprise";
import { enterprisePrice } from "../../../convex/lib/plans";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { formatPrice, formatShortDate } from "../../lib/format";
import type { SubscriptionView } from "../../lib/subscription";
import { OwnerOnlyNote } from "./owner-only-note";

/**
 * Settings → Billing for a store on an Enterprise contract (Credits T6): what
 * the contract says — the fee and its term, the credits it includes, what an
 * overage block costs — in place of the plan picker and the plan-change card,
 * because a contract changes by conversation, never by a self-serve tap (the
 * server refuses those with the same words). A scheduled move to Pro, set with
 * the customer by an admin, is stated here with the date it lands. A viewer
 * who can't change billing sees the chat button disabled beside the reason.
 */
export function EnterpriseContractCard({
	sub,
	slug,
	ownerOnly = false,
}: {
	sub: SubscriptionView;
	slug: string;
	ownerOnly?: boolean;
}) {
	const supportWa = useSupportWaNumber();
	const contract = sub.enterprise;
	if (!contract) return null;
	const annual = sub.billingCycle === "annual";
	const fee = enterprisePrice(contract, annual ? "annual" : "monthly");
	const credits = contract.includedCredits.toLocaleString("en");
	const block = contract.blockSize.toLocaleString("en");
	const moving = sub.pendingPlanChange;

	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div className="flex items-start gap-3">
				<Building2
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<div>
					<p className="text-sm font-medium">Your Enterprise contract</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Priced for your volume and agreed with Kedaipal — it renews on its
						own, and changes to it go through us.
					</p>
				</div>
			</div>

			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
				<dt className="text-muted-foreground">Fee</dt>
				<dd className="tabular-nums">
					{formatPrice(fee, contract.currency)} a {annual ? "year" : "month"}
					{annual ? (
						<span className="text-muted-foreground">
							{" "}
							· {formatPrice(contract.baseFeeMinor, contract.currency)} a month,
							2 months free
						</span>
					) : null}
				</dd>
				<dt className="text-muted-foreground">Included</dt>
				<dd className="tabular-nums">{credits} credits a month</dd>
				<dt className="text-muted-foreground">More credits</dt>
				<dd className="tabular-nums">
					Blocks of {block} at{" "}
					{formatPrice(contract.overageRateMinor, contract.currency)} a credit —{" "}
					{formatPrice(enterpriseBlockPrice(contract), contract.currency)} a
					block. Bought credits last 12 months.
				</dd>
				{sub.currentPeriodEnd !== undefined && !moving ? (
					<>
						<dt className="text-muted-foreground">Renews</dt>
						<dd>{formatShortDate(sub.currentPeriodEnd)}</dd>
					</>
				) : null}
			</dl>

			{moving ? (
				<p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
					<CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
					<span>
						Moving to Pro on {formatShortDate(moving.effectiveAt)} — your
						contract ends then, and from the next month your store has Pro's
						allowance. Set with Kedaipal; message us to change it.
					</span>
				</p>
			) : null}

			{ownerOnly ? (
				<div className="flex flex-col gap-1.5">
					<button
						type="button"
						disabled
						className="tap-target inline-flex h-11 w-fit cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground opacity-50 sm:h-10"
					>
						<MessageCircle className="size-4" aria-hidden />
						Need a block or a change? Message us
					</button>
					<OwnerOnlyNote />
				</div>
			) : (
				<a
					href={buildWaContactLink(
						`Hi Arif, it's about the Enterprise contract for kedaipal.com/${slug}.`,
						supportWa,
					)}
					target="_blank"
					rel="noopener noreferrer"
					className="tap-target inline-flex h-11 w-fit items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:h-10"
				>
					<MessageCircle className="size-4" aria-hidden />
					Need a block or a change? Message us
				</a>
			)}
		</section>
	);
}
