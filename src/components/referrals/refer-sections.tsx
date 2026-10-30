import { Link } from "@tanstack/react-router";
import {
	Check,
	Clock,
	Copy,
	ImageIcon,
	Lock,
	MessageSquareText,
	PauseCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { referralShareMessage } from "../../../convex/lib/referral";
import type { MyReferralCard, MyReferralRow } from "../../../convex/referrals";
import { formatRelativeTime, formatShortDate } from "../../lib/format";
import {
	type ReferralShareSurface,
	trackReferralShare,
} from "../../lib/ga-events";
import { copyText, waChatHref, waShareHref } from "../../lib/referral-share";
import { TONE_CHIP } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { Button } from "../ui/button";
import { ShareImageDialog } from "./share-image-dialog";

/**
 * The Refer & earn building blocks (the 28 Oct 2026 push, docs/referrals.md
 * § The push). ONE set of pieces for the two surfaces that show the
 * programme — `/app/refer` and, before 31 Oct, the Home teaser — so the link, the buttons,
 * the pending state and the paused/trial notices can never drift apart
 * ("one idea, one control").
 *
 * The offer is always said in ORDERS. A seller thinks in orders; "bonus
 * credits" needed a conversion the card asked them to make (1 credit = 1
 * order is said once, in the fine print).
 */

/** "60 orders on us. For both of you." — the headline, by who earns. */
export function offerHeadline(card: Pick<MyReferralCard, "offer" | "earns">) {
	return card.earns
		? `${card.offer.pro} orders on us. For both of you.`
		: `${card.offer.pro} orders on us, for every kedai you refer.`;
}

/**
 * The share kit: WhatsApp first (where a referral actually travels), the
 * link, and — on the page — the message and the image. Every tap is counted
 * (`referral_share`): the card shipped with no event, so nobody could tell
 * whether it was ever used.
 */
export function ReferShareActions({
	card,
	surface,
	full = false,
}: {
	card: Pick<MyReferralCard, "link" | "slug" | "storeName">;
	surface: ReferralShareSurface;
	/** The page shows all four channels; the Home teaser the first two. */
	full?: boolean;
}) {
	const [copied, setCopied] = useState<"link" | "message" | null>(null);
	const [imageOpen, setImageOpen] = useState(false);
	const message = referralShareMessage(card.link, card.storeName);

	async function copy(what: "link" | "message") {
		const ok = await copyText(what === "link" ? card.link : message);
		if (!ok) {
			toast.error("Couldn't copy — select the link and copy it by hand.");
			return;
		}
		trackReferralShare(what === "link" ? "copy_link" : "copy_message", surface);
		setCopied(what);
		setTimeout(() => setCopied(null), 1800);
	}

	return (
		<div className="flex flex-col gap-2">
			{/* Two equal columns, not two `flex-1`s: the labels differ in length,
			    and flex-basis sizes from content, so "Copy link" came out visibly
			    narrower than its sibling on a phone (T3). */}
			<div className="grid grid-cols-2 gap-2">
				<Button asChild className="h-11 min-w-0">
					{/* "Share on WhatsApp" needs ~173px; a phone column is ~156px.
					    The icon + "WhatsApp" says the same thing there, and the
					    accessible name stays whole at every width. */}
					<a
						href={waShareHref(message)}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Share on WhatsApp"
						onClick={() => trackReferralShare("whatsapp", surface)}
					>
						<WhatsAppIcon className="size-4" />
						<span className="sm:hidden">WhatsApp</span>
						<span className="hidden sm:inline">Share on WhatsApp</span>
					</a>
				</Button>
				{/* "Copy INVITE link", never bare "Copy link": on Home this card sits
				    under the store-link card, whose own button is "Copy link" —
				    two identical labels for two different links is how a seller
				    sends a stranger their storefront instead of their invite. */}
				<Button
					variant="outline"
					className="h-11 min-w-0"
					onClick={() => copy("link")}
					aria-label="Copy invite link"
				>
					{copied === "link" ? (
						<>
							<Check className="size-4" aria-hidden="true" />
							Copied!
						</>
					) : (
						<>
							<Copy className="size-4" aria-hidden="true" />
							<span className="sm:hidden">Copy invite</span>
							<span className="hidden sm:inline">Copy invite link</span>
						</>
					)}
				</Button>
			</div>
			{full ? (
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						className="h-11 rounded-full px-4"
						onClick={() => setImageOpen(true)}
					>
						<ImageIcon className="size-3.5" aria-hidden="true" />
						Share image
					</Button>
					<Button
						variant="secondary"
						size="sm"
						className="h-11 rounded-full px-4"
						onClick={() => copy("message")}
					>
						<MessageSquareText className="size-3.5" aria-hidden="true" />
						{copied === "message" ? "Message copied!" : "Copy message"}
					</Button>
					<ShareImageDialog
						open={imageOpen}
						onClose={() => setImageOpen(false)}
						storeName={card.storeName}
						slug={card.slug}
						link={card.link}
						surface={surface}
					/>
				</div>
			) : null}
		</div>
	);
}

/** The link itself, with the slug lit. */
export function ReferLinkLine({ slug }: { slug: string }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
				Your referral link
			</span>
			<span className="flex min-w-0 font-mono text-sm font-medium">
				<span className="shrink-0">kedaipal.com/referral/</span>
				<span className="kp-highlight truncate">{slug}</span>
			</span>
		</div>
	);
}

/** Signed up / Started their plan / Orders earned — the three numbers. */
export function ReferStats({
	card,
	className,
}: {
	card: Pick<
		MyReferralCard,
		"signedUp" | "started" | "creditsEarned" | "capped" | "earns"
	>;
	className?: string;
}) {
	return (
		<dl
			className={cn(
				"grid gap-2",
				card.earns ? "grid-cols-3" : "grid-cols-2",
				className,
			)}
		>
			<Stat
				label="Signed up"
				value={`${card.signedUp}${card.capped ? "+" : ""}`}
			/>
			<Stat label="Started their plan" value={String(card.started)} />
			{card.earns ? (
				<Stat label="Orders earned" value={String(card.creditsEarned)} accent />
			) : null}
		</dl>
	);
}

function Stat({
	label,
	value,
	accent,
}: {
	label: string;
	value: string;
	accent?: boolean;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-[11px] font-semibold text-muted-foreground">
				{label}
			</dt>
			<dd
				className={cn(
					"font-heading text-xl font-extrabold tabular-nums",
					accent && "text-accent-emphasis",
				)}
			>
				{value}
			</dd>
		</div>
	);
}

/**
 * One row per referee. Pending rows lead (newest first within each group):
 * they are the ones the referrer can still do something about — a word from
 * a friend converts where an email from us doesn't, so the row carries the
 * referee's own WhatsApp (public: it is their storefront's number).
 */
export function ReferralList({
	rows,
	capped,
	card,
}: {
	rows: MyReferralRow[];
	capped: boolean;
	card: Pick<MyReferralCard, "offer" | "earns">;
}) {
	if (rows.length === 0)
		return (
			<p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
				No sign-ups through your link yet. The kedai you refer appear here the
				moment they create their store.
			</p>
		);
	const pending = rows.filter((r) => r.status === "signed_up");
	const started = rows.filter((r) => r.status === "started");
	return (
		<div className="flex flex-col gap-3">
			{/* How a waiting row pays out — said ONCE for the list, not repeated
			    on every row (three identical paragraphs read as a wall). */}
			{pending.length > 0 ? (
				<p
					className="text-[13px] leading-snug text-muted-foreground"
					data-testid="referral-list-note"
				>
					{card.earns
						? `Your ${card.offer.pro} land the moment a kedai pays its first invoice (${card.offer.starter} if they pick Starter). A word from you helps more than any email from us.`
						: `Their ${card.offer.pro} land the moment they pay their first invoice (${card.offer.starter} on Starter). A word from you helps more than any email from us.`}
				</p>
			) : null}
			<ul className="flex flex-col gap-2" data-testid="referral-list">
				{[...pending, ...started].map((row) => (
					<ReferralRow key={row.id} row={row} card={card} />
				))}
				{capped ? (
					<li className="px-1 text-xs text-muted-foreground">
						Showing your latest {rows.length} referrals.
					</li>
				) : null}
			</ul>
		</div>
	);
}

function ReferralRow({
	row,
	card,
}: {
	row: MyReferralRow;
	card: Pick<MyReferralCard, "offer" | "earns">;
}) {
	const name = row.storeName ?? "A store since deleted";
	if (row.status === "signed_up") {
		const chat = waChatHref(row.waPhone);
		return (
			<li className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 pt-3.5 dark:border-amber-800 dark:bg-amber-950/50">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate text-[15px] font-semibold">{name}</span>
						<span className="text-xs text-amber-900/80 dark:text-amber-200/80">
							Signed up {formatRelativeTime(row.createdAt)}
							{row.stage ? ` · ${STAGE_COPY[row.stage]}` : ""}
						</span>
					</div>
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
							TONE_CHIP.warn,
						)}
					>
						<Clock className="size-3" aria-hidden="true" />
						{card.earns ? `${card.offer.pro} waiting` : "Bonus waiting"}
					</span>
				</div>
				{chat ? (
					<a
						href={chat}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-semibold text-accent-emphasis underline-offset-4 hover:underline"
					>
						<WhatsAppIcon className="size-4" />
						Say hi on WhatsApp
					</a>
				) : (
					<span aria-hidden="true" className="h-3" />
				)}
			</li>
		);
	}
	const landed = row.referrerCredits > 0;
	const why = landed ? undefined : outcomeWhy(row.referrerOutcome);
	return (
		<li className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate text-[15px] font-semibold">{name}</span>
					<span className="text-xs text-muted-foreground">
						Started their plan
						{row.rewardedAt ? ` · ${formatShortDate(row.rewardedAt)}` : ""}
					</span>
				</div>
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
						landed ? TONE_CHIP.success : TONE_CHIP.neutral,
					)}
				>
					{landed ? <Check className="size-3" aria-hidden="true" /> : null}
					{landed
						? `+${row.referrerCredits} landed`
						: outcomeLabel(row.referrerOutcome)}
				</span>
			</div>
			{/* Why nothing landed — on the row, not in a hover tooltip a phone
			    can never show. */}
			{why ? (
				<p className="text-xs leading-snug text-muted-foreground">{why}</p>
			) : null}
		</li>
	);
}

/** Where a waiting referee stands — the words the Billing tab uses for the
 * same states ("Free period", "first invoice due"), so they read as one app. */
const STAGE_COPY: Record<NonNullable<MyReferralRow["stage"]>, string> = {
	free: "on their free period",
	invoice_due: "free period over · first invoice due",
	overdue: "first invoice overdue",
	not_on_plan: "not on a plan yet",
};

/** Why a started referral paid this store nothing — said plainly. */
function outcomeLabel(outcome: MyReferralRow["referrerOutcome"]): string {
	switch (outcome) {
		case "self":
			return "Same owner";
		case "unmetered":
			return "On the house";
		default:
			return "Started";
	}
}

function outcomeWhy(
	outcome: MyReferralRow["referrerOutcome"],
): string | undefined {
	switch (outcome) {
		case "self":
			return "This store shares your email or WhatsApp number, so only their half was paid.";
		case "unmetered":
			return "Your account is unlimited, so there was nothing to add — they still got theirs.";
		default:
			return undefined;
	}
}

/** The three steps, in the referee's order. */
export function HowItWorks({
	storeName,
	card,
}: {
	storeName: string;
	card: Pick<MyReferralCard, "offer" | "earns">;
}) {
	const steps: Array<{ title: string; body: string }> = [
		{
			title: "Send your link",
			body: "To any kedai still taking orders by hand in WhatsApp.",
		},
		{
			title: "They sign up through it",
			body: `They see "${storeName} invited you" and their bonus from the first page.`,
		},
		{
			title: "Their first invoice pays out",
			body: card.earns
				? `${card.offer.pro} orders each on Pro, ${card.offer.starter} on Starter. Yours land the same minute.`
				: `${card.offer.pro} orders on Pro, ${card.offer.starter} on Starter — theirs land the same minute.`,
		},
	];
	return (
		<ol className="flex flex-col gap-3.5">
			{steps.map((step, i) => (
				<li key={step.title} className="flex items-start gap-3">
					<span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-segment text-xs font-bold text-segment-foreground">
						{i + 1}
					</span>
					<div className="flex flex-col gap-0.5">
						<span className="text-sm font-semibold">{step.title}</span>
						<span className="text-[13px] leading-snug text-muted-foreground">
							{step.body}
						</span>
					</div>
				</li>
			))}
		</ol>
	);
}

/** The fine print — once, where the seller can find it. */
export function ReferFinePrint({
	card,
}: {
	card: Pick<MyReferralCard, "earns">;
}) {
	return (
		<p className="text-xs leading-relaxed text-muted-foreground">
			1 credit = 1 order. Bonus credits are used after your monthly credits and
			last 12 months.{" "}
			{card.earns
				? "No limit on how many kedai you refer."
				: "Your account is on the house, so there's nothing for you to earn — every kedai you refer still gets their bonus."}
		</p>
	);
}

/**
 * A TRIAL store: the programme exists, and when it opens. Shipped as nothing
 * at all (Zaki, 7 Oct 2026: refer once the plan is paid) — but a feature a
 * seller can't see is one they never plan around. The rule is unchanged; it
 * is now said.
 */
export function TrialReferNotice({
	offer,
	className,
}: {
	offer: MyReferralCard["offer"];
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-2xl border border-dashed border-border bg-card p-4",
				className,
			)}
			data-testid="refer-trial"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
				<Lock className="size-4" aria-hidden="true" />
			</span>
			<div className="flex min-w-0 flex-col gap-1 text-sm">
				<p className="font-semibold">Refer &amp; earn unlocks with your plan</p>
				<p className="text-[13px] leading-snug text-muted-foreground">
					Once you're on Starter or Pro, your link pays {offer.pro} orders each
					time a kedai you refer starts Pro ({offer.starter} on Starter) — and
					the same to them.
				</p>
				{/* The way forward, like the paused notice's — a locked feature
				    with no door is a dead end (found in the hands-on test). */}
				<Link
					to="/app/settings"
					search={{ tab: "billing", spot: "choose_plan" }}
					className="inline-flex min-h-11 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline"
				>
					Start your plan in Billing
				</Link>
			</div>
		</div>
	);
}

/**
 * A store whose plan is on hold or lapsed: the card stays, PAUSED, with why
 * and the way back — a link that silently stopped counting would be the
 * hidden behaviour CLAUDE.md forbids.
 */
export function PausedReferNotice({
	reason,
	className,
}: {
	reason: "paused" | "lapsed";
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-2xl border border-border bg-card p-4",
				className,
			)}
			data-testid="refer-paused"
		>
			<PauseCircle
				className="mt-0.5 size-5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-2 text-sm">
				<p className="font-semibold">Your referral link is paused</p>
				<p className="text-muted-foreground">
					{reason === "paused"
						? "While your store is on an Off-Season Hold, kedai who sign up through your link don't get a bonus, and neither do you. Resume your plan to turn it back on."
						: "Your plan isn't active, so kedai who sign up through your link don't get a bonus, and neither do you. Renew your plan to turn it back on."}
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex min-h-11 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline"
				>
					{reason === "paused" ? "Resume in Billing" : "Renew in Billing"}
				</Link>
			</div>
		</div>
	);
}
