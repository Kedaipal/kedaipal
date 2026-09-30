import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Award, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { CreditBalanceView } from "../../../convex/credits";
import { TOP_UP_VIEW_ONLY_MESSAGE } from "../../../convex/lib/creditPurchases";
import { useCreditLockFor } from "../../hooks/useCreditLock";
import { TOP_UP_SEARCH } from "../../lib/credit-top-up";
import {
	CREDIT_RULES_LINE,
	type CreditTone,
	creditRefreshLabel,
	creditStateLine,
	creditTone,
	lockCta,
	ordersBalanceLabel,
} from "../../lib/credits-ui";
import { formatShortDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { NeedsAccessNote } from "../app/owner-only-note";
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
 * (`full`, with the two balances, the rules and the top-up). Reads
 * `credits.getBalance`, gated on the Credits permission — a teammate without
 * it sees nothing here (the lock itself still reaches them via the banner).
 *
 * The two balances are always shown apart (Zaki, 1 Oct 2026): MONTHLY credits
 * are used first and reset on the 1st; BOUGHT credits are used next and carry
 * over for 12 months. The headline is their sum — what the lock reads.
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
	// T2's own answer to "can this reader buy a pack?" — credits-read gated, so
	// a teammate with Credits write gets it without Billing access.
	const topUp = useQuery(
		convexQuery(api.creditPurchases.topUpOptions, storeArgs),
	).data;
	const lock = useCreditLockFor(retailer);

	if (balance === undefined)
		return variant === "card" ? (
			<Skeleton className="h-36 w-full rounded-2xl" />
		) : (
			<Skeleton className="h-64 w-full rounded-2xl" />
		);
	if (balance === null) return null;

	const sub = retailer?.subscription;
	const exempt = balance.lockExempt;
	const tone = creditTone(balance.total, balance.periodGrant);
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

	// Top-up opens T2's pack picker: hidden where packs aren't sold AND for a
	// store that can never be locked (an admin's own store, a sponsored one —
	// nothing to top up; the state line says so), disabled WITH the reason
	// everywhere else — T2's own sentences (`topUpOptions`), so the meter and
	// the picker can never disagree about who may buy.
	const showTopUp = topUp?.available === true && exempt === null;
	const topUpReason =
		topUp?.refusalMessage ??
		(topUp?.viewOnly === "acting_as_admin" ? TOP_UP_VIEW_ONLY_MESSAGE : null);
	const topUpNoWrite = topUp?.viewOnly === "no_write";
	const canTopUp = topUpReason === null && !topUpNoWrite;

	const stateLine = creditStateLine({
		locked: lock.locked,
		total: balance.total,
		purchased: balance.purchased,
		regime: balance.regime,
		status: sub?.status,
		exempt,
		customGrant: balance.customGrant,
		nextGrant: balance.nextGrant,
	});
	const refresh = creditRefreshLabel(balance);

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

	const headline = (
		<p
			className={`text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}
			data-testid="credit-balance"
		>
			{ordersBalanceLabel(balance.total)}
		</p>
	);

	if (variant === "card") {
		// One button, by urgency: the way back when locked; a top-up once the
		// store is running low and this reader may buy; otherwise just Billing.
		const cta =
			lock.locked && lock.canAct
				? lockCta(lock.route)
				: !lock.locked && tone === "low" && showTopUp && canTopUp
					? { label: "Top up credits", search: TOP_UP_SEARCH }
					: null;
		return (
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5">
				{header}
				<div className="flex flex-col gap-2">
					{headline}
					<MonthlyBar balance={balance} tone={tone} />
					<p className="text-xs text-muted-foreground tabular-nums">
						{monthlyFigure(balance)} {monthlyNoun(balance)} ·{" "}
						{balance.purchased} bought
					</p>
				</div>
				<p className="text-xs text-muted-foreground">
					{lock.locked
						? "Paused: accepting and updating orders, editing products."
						: (refresh ??
							(balance.regime === "trial"
								? "Trial orders — pick a plan to keep going once they're used."
								: "Monthly credits reset on the 1st."))}
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

	// A store that can't buy packs (never locked, or on its trial) and holds no
	// bought credits has one balance, so "used first / used next" has nothing
	// to explain.
	const showBought =
		balance.purchased > 0 || (exempt === null && balance.regime !== "trial");

	return (
		<section
			id="credits"
			className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6"
		>
			{header}
			{headline}
			<div
				className={cn(
					"grid gap-3",
					showBought ? "sm:grid-cols-2" : "grid-cols-1",
				)}
			>
				<BalanceTile
					label={
						balance.regime === "trial" ? "Trial orders" : "Monthly credits"
					}
					order={showBought ? "Used first" : null}
					figure={
						<>
							{monthlyFigure(balance)}
							{balance.plan >= 0 && balance.periodGrant > 0 ? (
								<span className="text-sm font-normal text-muted-foreground">
									{" "}
									of {balance.periodGrant}
								</span>
							) : null}
						</>
					}
					detail={monthlyDetail(balance, refresh)}
				>
					<MonthlyBar balance={balance} tone={tone} />
				</BalanceTile>
				{showBought ? (
					<BalanceTile
						label="Bought credits"
						order="Used next"
						figure={balance.purchased}
						detail={
							balance.purchased > 0 && balance.nextExpiry
								? `Next ${balance.nextExpiry.credits} expire ${formatShortDate(balance.nextExpiry.at)}`
								: balance.purchased > 0
									? "Last 12 months from purchase"
									: "None yet — packs last 12 months"
						}
					/>
				) : null}
			</div>
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
			{showTopUp ? (
				<div className="flex flex-col gap-1.5">
					<Button
						asChild={canTopUp}
						size="lg"
						className="h-11 w-full px-4 sm:h-9 sm:w-fit"
						disabled={!canTopUp}
					>
						{canTopUp ? (
							<Link to="/app/settings" search={TOP_UP_SEARCH}>
								Top up credits
							</Link>
						) : (
							<span>Top up credits</span>
						)}
					</Button>
					{topUpReason ? (
						<p className="text-xs text-muted-foreground">{topUpReason}</p>
					) : topUpNoWrite ? (
						<NeedsAccessNote area="credits" level="write" />
					) : null}
				</div>
			) : null}
			<p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
				{CREDIT_RULES_LINE}
			</p>
		</section>
	);
}

type Balance = Pick<
	CreditBalanceView,
	"plan" | "periodGrant" | "regime" | "purchased"
>;

/** The monthly bucket as a figure: what's left, or what's owed. */
function monthlyFigure(balance: Balance): string {
	return balance.plan < 0 ? `${-balance.plan} owed` : String(balance.plan);
}

function monthlyNoun(balance: Balance): string {
	const kind = balance.regime === "trial" ? "trial" : "monthly";
	return balance.plan >= 0 && balance.periodGrant > 0
		? `of ${balance.periodGrant} ${kind}`
		: kind;
}

/** Under the monthly figure: when it resets, or why it won't. */
function monthlyDetail(balance: Balance, refresh: string | null): string {
	if (refresh) return refresh;
	if (balance.regime === "trial")
		return "One-off for your trial — your plan's monthly credits take over when you subscribe";
	return "None granted this month";
}

/** The monthly bucket against the month's grant. Decorative: the figures
 * say it in words, so the bar stays out of the accessibility tree. */
function MonthlyBar({ balance, tone }: { balance: Balance; tone: CreditTone }) {
	const fill =
		balance.periodGrant > 0
			? Math.min(1, Math.max(0, balance.plan / balance.periodGrant))
			: 0;
	return (
		<div
			className="h-2 overflow-hidden rounded-full bg-muted"
			aria-hidden="true"
		>
			<div
				className={`h-full rounded-full transition-all ${TONE_BAR[tone]}`}
				style={{ width: `${Math.round(fill * 100)}%` }}
			/>
		</div>
	);
}

/** One of the two balances — its name, where it sits in the order of use,
 * the figure, and one line on when it changes. */
function BalanceTile({
	label,
	order,
	figure,
	detail,
	children,
}: {
	label: string;
	order: string | null;
	figure: ReactNode;
	detail: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs font-medium text-muted-foreground">{label}</p>
				{order ? (
					<span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						{order}
					</span>
				) : null}
			</div>
			<p className="text-xl font-semibold tabular-nums">{figure}</p>
			{children}
			<p className="text-xs text-muted-foreground">{detail}</p>
		</div>
	);
}
