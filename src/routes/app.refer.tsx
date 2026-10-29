import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { ReferrerIneligibleReason } from "../../convex/lib/referral";
import type { MyReferralCard } from "../../convex/referrals";
import { NeedsAccessNote } from "../components/app/owner-only-note";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	HowItWorks,
	offerHeadline,
	PausedReferNotice,
	ReferFinePrint,
	ReferLinkLine,
	ReferralList,
	ReferShareActions,
	ReferStats,
	TrialReferNotice,
} from "../components/referrals/refer-sections";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";

/**
 * Refer & earn (`/app/refer`, the 28 Oct 2026 push — docs/referrals.md
 * § The push). The programme's HOME: the offer in orders, the link and the
 * whole share kit, the numbers, one row per referee with the pending state
 * made visible, and how it works.
 *
 * Why a page and not a bigger Home card: the T3 card sat last on Home,
 * below everything operational, and that was the right order for Home —
 * referring is never urgent. But a feature that lives only below the fold
 * of a page a busy seller rarely scrolls is one they never think of. The
 * page gives it a door of its own (sidebar, the phone's More sheet) and
 * room for the one thing the card could not hold: WHO signed up and what is
 * waiting on them.
 *
 * Not plan-walled and not area-guarded: any member can see and share the
 * link (public). The referee LIST is credits:read — it says what the store
 * earned — so a teammate without that grant gets the NeedsAccessNote in its
 * place, never a blank.
 */
export const Route = createFileRoute("/app/refer")({
	component: ReferRoute,
});

const SUBTITLE =
	"Send your link to a kedai still taking orders by hand. When they start their plan, you both get free orders.";

function ReferRoute() {
	const retailer = useDashboardRetailer();
	const credits = usePermission("credits");
	const card = useQuery(
		convexQuery(
			api.referrals.myCard,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const list = useQuery(
		convexQuery(
			api.referrals.myReferrals,
			retailer && credits.canRead ? { retailerId: retailer._id } : "skip",
		),
	).data;

	if (!retailer || card === undefined)
		return (
			<div className="flex max-w-3xl flex-col gap-6">
				<PageHeaderSkeleton hasSubtitle />
				<Skeleton className="h-40 w-full rounded-3xl" />
				<Skeleton className="h-44 w-full rounded-2xl" />
			</div>
		);

	return (
		<div className="flex max-w-3xl flex-col gap-6">
			<PageHeader title="Refer & earn" subtitle={SUBTITLE} />
			{/* PageHeader is desktop-only; a phone gets the title row every
			    other dashboard page carries. */}
			<div className="flex flex-col gap-1 lg:hidden">
				<h1 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
					Refer &amp; earn
				</h1>
				<p className="text-sm text-muted-foreground">{SUBTITLE}</p>
			</div>

			{card === null ? (
				<p className="text-sm text-muted-foreground">
					Referrals aren't available for this store.
				</p>
			) : !card.standing.canRefer ? (
				<IneligibleBody
					reason={card.standing.reason}
					offer={card.offer}
					storeName={retailer.storeName}
				/>
			) : (
				<LiveBody
					card={card}
					storeName={retailer.storeName}
					list={credits.canRead ? list : "no-access"}
				/>
			)}
		</div>
	);
}

/**
 * A store that can't refer right now still gets the page — it explains what
 * the programme is and when the link opens, so the rule is never a surprise.
 */
function IneligibleBody({
	reason,
	offer,
	storeName,
}: {
	reason: ReferrerIneligibleReason;
	offer: MyReferralCard["offer"];
	storeName: string;
}) {
	return (
		<>
			{reason === "trial" ? (
				<TrialReferNotice offer={offer} />
			) : reason === "paused" || reason === "lapsed" ? (
				<PausedReferNotice reason={reason} />
			) : (
				<p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
					This store has no plan yet, so its referral link doesn't count.
				</p>
			)}
			<Section title="How it works">
				<HowItWorks storeName={storeName} card={{ offer, earns: true }} />
			</Section>
		</>
	);
}

function LiveBody({
	card,
	storeName,
	list,
}: {
	card: MyReferralCard;
	storeName: string;
	list:
		| { rows: Parameters<typeof ReferralList>[0]["rows"]; capped: boolean }
		| null
		| undefined
		| "no-access";
}) {
	return (
		<>
			{/* The hero — inverted like Home's welcome card, so the page opens
			    the way Home does: one sentence, in the seller's unit. */}
			<section className="relative flex flex-col gap-2 overflow-hidden rounded-3xl bg-foreground p-5 text-background dark:border dark:border-accent/30 dark:bg-accent/12 dark:text-foreground">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -right-12 -top-14 size-[200px] rounded-full bg-accent/30 blur-[44px]"
				/>
				<span className="relative text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
					Refer a kedai
				</span>
				<h2 className="relative font-heading text-[26px] font-extrabold leading-[1.1] tracking-tight sm:text-3xl">
					{offerHeadline(card)}
				</h2>
				<p className="relative text-[13px] leading-relaxed text-background/75 dark:text-foreground/75">
					{card.earns
						? `When a kedai you refer starts Pro, you each get ${card.offer.pro} free orders. On Starter it's ${card.offer.starter} each.`
						: `When a kedai you refer starts Pro, they get ${card.offer.pro} free orders (${card.offer.starter} on Starter). Your account is on the house, so there's nothing for you to earn — the orders are theirs.`}
				</p>
			</section>

			<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
				<ReferLinkLine slug={card.slug} />
				<ReferShareActions card={card} surface="page" full />
			</section>

			<section className="rounded-2xl border border-border bg-card px-4 py-3">
				<ReferStats card={card} />
			</section>

			<Section title="Your referrals">
				{list === "no-access" ? (
					<NeedsAccessNote area="credits" level="read" />
				) : list === undefined ? (
					<Skeleton className="h-20 w-full rounded-2xl" />
				) : list === null ? null : (
					<ReferralList rows={list.rows} capped={list.capped} card={card} />
				)}
			</Section>

			<Section title="How it works">
				<HowItWorks storeName={storeName} card={card} />
			</Section>

			<ReferFinePrint card={card} />
		</>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-heading text-lg font-extrabold tracking-tight">
				{title}
			</h2>
			{children}
		</section>
	);
}
