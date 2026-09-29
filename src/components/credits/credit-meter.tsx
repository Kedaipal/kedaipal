import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Award, Gauge } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { topUpBlock } from "../../../convex/lib/credits";
import { useCreditLockFor } from "../../hooks/useCreditLock";
import { usePermission } from "../../hooks/usePermission";
import {
	type CreditTone,
	creditTone,
	lockCta,
	ordersBalanceLabel,
} from "../../lib/credits-ui";
import { formatShortDate } from "../../lib/format";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

const EXPIRY_HEADS_UP_MS = 30 * 24 * 60 * 60 * 1000;

const TONE_TEXT: Record<CreditTone, string> = {
	ok: "text-foreground",
	low: "text-amber-700 dark:text-amber-400",
	out: "text-red-600 dark:text-red-400",
};
const TONE_BAR: Record<CreditTone, string> = {
	ok: "bg-accent",
	low: "bg-amber-500",
	out: "bg-red-500",
};

/**
 * The credit balance (Credits T3) — "42 orders left", never an amount of
 * money. One component, two places (one control, one rule): the dashboard
 * home's quick look (`card`, with a way into Billing) and Settings → Billing
 * (`full`, with the breakdown, the rules and the top-up). Reads
 * `credits.getBalance`, gated on the Credits permission — a teammate without
 * it sees nothing here (the lock itself still reaches them via the banner).
 */
type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

export function CreditMeter({
	variant,
	retailer,
}: {
	variant: "card" | "full";
	retailer: Retailer | null | undefined;
}) {
	const actingAsAdmin = retailer?.actingAsAdmin === true;
	const storeArgs = retailer
		? { retailerId: actingAsAdmin ? retailer._id : undefined }
		: "skip";
	const balance = useQuery(convexQuery(api.credits.getBalance, storeArgs)).data;
	const gateway = useQuery(
		convexQuery(api.subscriptionPayments.billingGatewayAvailable, storeArgs),
	).data;
	const { canWrite: canBuy } = usePermission("credits");
	const lock = useCreditLockFor(retailer);

	if (balance === undefined)
		return variant === "card" ? (
			<Skeleton className="h-36 w-full rounded-2xl" />
		) : (
			<Skeleton className="h-48 w-full rounded-2xl" />
		);
	if (balance === null) return null;

	const sub = retailer?.subscription;
	const comped = sub?.comped === true;
	const tone = creditTone(balance.total, balance.periodGrant);
	const fill =
		balance.periodGrant > 0
			? Math.min(1, Math.max(0, balance.plan / balance.periodGrant))
			: 0;
	const founding =
		retailer?.isFoundingMember === true &&
		balance.regime === "monthly" &&
		sub?.plan === "pro" &&
		!balance.customGrant;
	const expirySoon =
		balance.nextExpiry &&
		balance.nextExpiry.at - Date.now() <= EXPIRY_HEADS_UP_MS
			? balance.nextExpiry
			: null;

	// Top-up (the pack picker is Credits T2): hidden where packs aren't sold,
	// disabled WITH the reason everywhere else it can't be used.
	const block = topUpBlock(sub?.status ?? null, comped);
	const topUpReason = (() => {
		if (block === "trialing")
			return "Pick a plan first — top-ups are for subscribed stores.";
		if (block === "past_due")
			return "Pay your open invoice first — this month's credits land with it.";
		if (block === "on_hold") return "Resume your plan first.";
		if (block === "cancelled") return "Choose a plan first.";
		if (actingAsAdmin)
			return "Billing is view-only while you're acting as a store.";
		if (!canBuy)
			return "Ask the store owner for edit access to Credits to buy packs.";
		return null;
	})();
	const showTopUp = gateway?.payNow === true;

	const stateLine = (() => {
		if (lock.locked)
			return balance.total < 0
				? `Accepting and updating orders and editing products are paused. The ${-balance.total} ${balance.total === -1 ? "order" : "orders"} owed come off your next pack or your next monthly credits.`
				: "Accepting and updating orders and editing products are paused until you add credits.";
		if (comped)
			return "Sponsored stores are never locked — this is here so you can see your volume.";
		if (balance.regime === "trial")
			return "Your free trial includes 200 orders, counted from your first order. Pick a plan when they're used or your first invoice comes due.";
		if (sub?.status === "past_due")
			return "Pay your invoice and this month's credits land straight away.";
		if (sub?.status === "on_hold")
			return "Your plan is paused, so no monthly credits are granted — resume to get this month's.";
		if (balance.customGrant && balance.nextGrant !== null)
			return `Your store has a custom allowance of ${balance.nextGrant} orders a month.`;
		return null;
	})();

	const header = (
		<div className="flex items-center justify-between gap-3">
			<p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				<Gauge className="size-3.5" aria-hidden="true" />
				Credits
			</p>
			{founding ? (
				<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
					<Award className="size-3" aria-hidden="true" />
					Founding · 300 a month
				</span>
			) : null}
		</div>
	);

	const figure = (
		<div className="flex flex-col gap-2">
			<p
				className={`text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}
				data-testid="credit-balance"
			>
				{ordersBalanceLabel(balance.total)}
			</p>
			{/* Decorative: the figure above IS the reading ("42 orders left"),
			    so the bar stays out of the accessibility tree. */}
			<div
				className="h-2 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<div
					className={`h-full rounded-full transition-all ${TONE_BAR[tone]}`}
					style={{ width: `${Math.round(fill * 100)}%` }}
				/>
			</div>
		</div>
	);

	const refreshLine =
		balance.refreshesAt !== null && balance.nextGrant !== null
			? `${balance.nextGrant} more on ${formatShortDate(balance.refreshesAt)}`
			: null;

	if (variant === "card") {
		const cta = lock.locked && !lock.isMember ? lockCta(lock.route) : null;
		return (
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5">
				{header}
				{figure}
				<p className="text-xs text-muted-foreground">
					{lock.locked
						? "Paused: accepting and updating orders, editing products."
						: (refreshLine ??
							(balance.regime === "trial"
								? "Trial orders — pick a plan to keep going once they're used."
								: "Plan credits refresh on the 1st."))}
				</p>
				<div className="flex flex-wrap gap-2">
					{cta ? (
						<Button asChild size="lg" className="h-11 px-4 sm:h-9">
							<Link to="/app/settings" search={cta.search}>
								{cta.label}
							</Link>
						</Button>
					) : null}
					<Button
						asChild
						size="lg"
						variant="outline"
						className="h-11 px-4 sm:h-9"
					>
						<Link to="/app/settings" search={{ tab: "billing" }}>
							Billing
						</Link>
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section
			id="credits"
			className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6"
		>
			{header}
			{figure}
			<dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
				<div>
					<dt className="text-muted-foreground">Plan credits</dt>
					<dd className="font-medium tabular-nums">
						{balance.plan < 0
							? `${-balance.plan} owed`
							: `${balance.plan} of ${balance.periodGrant}`}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Bought credits</dt>
					<dd className="font-medium tabular-nums">{balance.purchased}</dd>
				</div>
				{refreshLine ? (
					<div className="col-span-2 sm:col-span-1">
						<dt className="text-muted-foreground">Next refresh</dt>
						<dd className="font-medium">{refreshLine}</dd>
					</div>
				) : null}
			</dl>
			{stateLine ? (
				<p
					className={`text-sm ${lock.locked ? "font-medium text-foreground" : "text-muted-foreground"}`}
				>
					{stateLine}
				</p>
			) : null}
			{expirySoon ? (
				<p className="text-xs text-amber-700 dark:text-amber-400">
					{expirySoon.credits} bought{" "}
					{expirySoon.credits === 1 ? "credit expires" : "credits expire"} on{" "}
					{formatShortDate(expirySoon.at)}.
				</p>
			) : null}
			<p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
				1 credit = 1 order. Plan credits refresh on the 1st of every month and
				don't carry over; credits you buy last 12 months, and plan credits are
				always used first. Cancel a new order before you accept it and its
				credit comes back (up to 10 a month).
			</p>
			{showTopUp ? (
				<div className="flex flex-col gap-1.5">
					<Button
						asChild={topUpReason === null}
						size="lg"
						className="h-11 w-full px-4 sm:h-9 sm:w-fit"
						disabled={topUpReason !== null}
						title={topUpReason ?? undefined}
					>
						{topUpReason === null ? (
							<Link to="/app/settings" search={{ tab: "billing", topup: 1 }}>
								Top up credits
							</Link>
						) : (
							<span>Top up credits</span>
						)}
					</Button>
					{topUpReason ? (
						<p className="text-xs text-muted-foreground">{topUpReason}</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
