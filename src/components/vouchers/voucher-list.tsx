import { Link } from "@tanstack/react-router";
import {
	Ban,
	CalendarClock,
	CalendarX,
	CheckCircle2,
	PauseCircle,
	Share2,
	Ticket,
	TimerReset,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
	VoucherKind,
	VoucherStatus,
	VoucherUsage,
} from "../../../convex/lib/vouchers";
import {
	formatSharedUses,
	formatVoucherMoment,
	formatVoucherTerms,
	voucherFinePrint,
} from "../../../convex/lib/vouchers";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

/** One row as the seller's list shows it — mirrors `VoucherRow` on the server
 * without importing the function's return type, so the components stay
 * unit-testable without Convex. */
export interface VoucherRowView {
	id: Id<"vouchers">;
	code: string;
	kind: VoucherKind;
	value: number;
	currency: string;
	status: VoucherStatus;
	expiresAt?: number;
	note?: string;
	batchId?: string;
	redeemedOrder?: { shortId: string; total: number };
	redeemedAt?: number;
	voidedAt?: number;
	voidReason?: string;
	createdAt: number;
	/** `shared` rows count uses instead of flipping (`z8r3fducfm`). Optional
	 * on the VIEW so the many existing fixtures stay single-use by default. */
	usage?: VoucherUsage;
	maxRedemptions?: number;
	redeemedCount?: number;
	endsAt?: number;
	/** v2 (`z8r3fdz0pw`). */
	startsAt?: number;
	perBuyerLimit?: number;
	minSpend?: number;
	maxDiscount?: number;
}

/** Can this row take an Extend? A shared code that hasn't been voided — an
 * ended or run-out one included, because "it sold out by lunch, add 20 more"
 * is the commonest reason to reach for it (`z8r3fdz0pw`). */
export function canExtend(voucher: VoucherRowView): boolean {
	return voucher.usage === "shared" && voucher.status !== "voided";
}

/** Is the code still in play — spendable now, or waiting for its start?
 * What decides whether Share and Void are offered. */
function isLive(voucher: VoucherRowView): boolean {
	return voucher.status === "active" || voucher.status === "scheduled";
}

/**
 * The voucher list (`z8r3fdr617`).
 *
 * Every row answers two questions at a glance — what is this worth, and what
 * happened to it — because a list of twenty look-alike codes is otherwise
 * unreadable. The status is the ANSWER, so it leads the second line:
 * "Used on #ORD-7F3K" beats a grey "redeemed" pill, and a voided row carries
 * the seller's own reason where they wrote it.
 *
 * Only an `active` row offers Share and Void: a spent voucher can't be either
 * (sharing it would send a dead code, and voiding would imply a placed order
 * could be clawed back), and an expired one has nothing left to share. That's
 * why the actions are per-status rather than a uniform row of buttons that
 * sometimes do nothing.
 */
export function VoucherList({
	vouchers,
	onShare,
	onVoid,
	onShowUses,
	onExtend,
	canWrite,
	paused = false,
	/** Rendered nested under a batch parent: the card loses its own border and
	 * tightens, so a run reads as ONE object rather than N floating cards. */
	nested = false,
}: {
	vouchers: ReadonlyArray<VoucherRowView>;
	onShare: (voucher: VoucherRowView) => void;
	onVoid: (voucher: VoucherRowView) => void;
	/** Open the "who used it" list for a SHARED code (`z8r3fducfm`) — the
	 * question its count can't answer. A read, so it is offered to every
	 * grant that can see the list, not only to writers. */
	onShowUses?: (voucher: VoucherRowView) => void;
	/** Give a shared code more room — a later end or a higher cap
	 * (`z8r3fdz0pw`). Absent = not offered. */
	onExtend?: (voucher: VoucherRowView) => void;
	/** A teammate with read-only on `vouchers` sees the book and no actions. */
	canWrite: boolean;
	/**
	 * The STORE can't redeem right now (below the plan that carries vouchers,
	 * `z8r3fdr617`). The rows are still `active` — true of the voucher, and
	 * misleading on screen, so an active row wears "Paused" instead. Without
	 * this the seller reads Active, their buyer is refused, and the seller
	 * rightly blames us.
	 */
	paused?: boolean;
	nested?: boolean;
}) {
	return (
		<ul className={nested ? "flex flex-col" : "flex flex-col gap-2"}>
			{vouchers.map((voucher) => (
				<li
					key={voucher.id}
					className={
						nested
							? "flex flex-col gap-3 border-t border-border/70 px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4"
							: "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4"
					}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<code
								className={`font-mono text-sm font-bold tracking-wider ${
									isLive(voucher)
										? "text-foreground"
										: "text-muted-foreground line-through"
								}`}
							>
								{voucher.code}
							</code>
							<span className="text-sm font-semibold text-accent-emphasis">
								{formatVoucherTerms(voucher, (sen) =>
									formatPrice(sen, voucher.currency),
								)}
							</span>
							{/* A shared code sits in the same list as unique ones and
							    looks like a word rather than a KP-code, which is a hint
							    and not a statement — so it SAYS it is shared. Outlined
							    rather than filled, to stay a kind and not read as a
							    second status. */}
							{voucher.usage === "shared" ? (
								<span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
									<Users className="size-3" aria-hidden />
									Shared
								</span>
							) : null}
							<StatusPill status={voucher.status} paused={paused} />
						</div>
						<p className="text-xs text-muted-foreground">
							<OutcomeLine voucher={voucher} />
						</p>
						{/* The conditions a buyer meets at checkout (`z8r3fdz0pw`),
						    so the seller can see on the row what they promised. */}
						<FinePrint voucher={voucher} />
						{/* Nested, the note is the BATCH's name and the parent card is
						    already titled with it — printing it again on all six rows
						    says the same word six times inside the thing it names. */}
						{voucher.note && !nested ? (
							<p className="truncate text-xs italic text-muted-foreground">
								{voucher.note}
							</p>
						) : null}
					</div>

					{(canWrite && isLive(voucher)) ||
					(canWrite && onExtend && canExtend(voucher)) ||
					(onShowUses && hasUses(voucher)) ? (
						<div className="flex shrink-0 flex-wrap gap-2">
							{/* "Who used it" is a READ and stays available after the code
							    has run out or ended — that is exactly when the seller
							    wants to see where the money went. */}
							{onShowUses && hasUses(voucher) ? (
								<Button
									variant="ghost"
									className="tap-target flex-1 gap-1.5 text-muted-foreground sm:flex-none"
									onClick={() => onShowUses(voucher)}
								>
									<Users className="size-4" aria-hidden />
									{voucher.redeemedCount}{" "}
									{voucher.redeemedCount === 1 ? "order" : "orders"}
								</Button>
							) : null}
							{canWrite && isLive(voucher) ? (
								<Button
									variant="outline"
									className="tap-target flex-1 gap-1.5 sm:flex-none"
									onClick={() => onShare(voucher)}
								>
									<Share2 className="size-4" aria-hidden />
									Share
								</Button>
							) : null}
							{canWrite && onExtend && canExtend(voucher) ? (
								<Button
									variant={isLive(voucher) ? "ghost" : "outline"}
									className="tap-target flex-1 gap-1.5 sm:flex-none"
									onClick={() => onExtend(voucher)}
								>
									<TimerReset className="size-4" aria-hidden />
									Extend
								</Button>
							) : null}
							{canWrite && isLive(voucher) ? (
								<Button
									variant="ghost"
									className="tap-target flex-1 text-muted-foreground hover:text-destructive sm:flex-none"
									onClick={() => onVoid(voucher)}
								>
									Void
								</Button>
							) : null}
						</div>
					) : null}
				</li>
			))}
		</ul>
	);
}

/** "up to RM 20.00 off · min. spend RM 50.00 · 1 per buyer" — or nothing. */
function FinePrint({ voucher }: { voucher: VoucherRowView }) {
	const lines = voucherFinePrint(voucher, (sen) =>
		formatPrice(sen, voucher.currency),
	);
	if (lines.length === 0) return null;
	return <p className="text-xs text-muted-foreground">{lines.join(" · ")}</p>;
}

/** Has a shared code been spent at least once? Gates the "N orders" read. */
function hasUses(voucher: VoucherRowView): boolean {
	return voucher.usage === "shared" && (voucher.redeemedCount ?? 0) > 0;
}

/** What HAPPENED to this voucher, in the seller's words. The status pill says
 * which state; this line says the useful part. */
function OutcomeLine({ voucher }: { voucher: VoucherRowView }): ReactNode {
	if (voucher.usage === "shared") return sharedOutcomeLine(voucher);
	switch (voucher.status) {
		case "redeemed":
			return voucher.redeemedOrder ? (
				<>
					Used on{" "}
					<Link
						to="/app/orders/$shortId"
						params={{ shortId: voucher.redeemedOrder.shortId }}
						className="font-semibold text-accent-emphasis hover:underline"
					>
						{voucher.redeemedOrder.shortId}
					</Link>{" "}
					· {formatPrice(voucher.redeemedOrder.total, voucher.currency)} paid
				</>
			) : (
				// The order was hard-deleted (admin only) — the voucher is still
				// spent, and saying so beats a blank.
				<>Used — that order has since been deleted</>
			);
		case "voided":
			return voucher.voidReason
				? `Voided — ${voucher.voidReason}`
				: "Voided — the code no longer works";
		case "expired":
			return voucher.expiresAt
				? `Expired on ${formatDay(voucher.expiresAt)}`
				: "Expired";
		case "active":
			return voucher.expiresAt
				? `Works until ${formatDay(voucher.expiresAt)}`
				: "No expiry · one use";
		case "scheduled":
			// Unreachable today — only a shared code can be scheduled — but the
			// status type is shared, and a blank would be worse than a sentence.
			return "Not started yet";
	}
}

/**
 * A SHARED code's outcome line (`z8r3fducfm`): the tally leads, because it is
 * the number the seller is watching, then the bound that ended it or will.
 * "All 50 used" rather than "Used" — the pill already says Used, and the
 * seller wants to know it was the CAP, not the clock, that stopped it.
 */
function sharedOutcomeLine(voucher: VoucherRowView): string {
	const uses = formatSharedUses(voucher);
	switch (voucher.status) {
		case "redeemed":
			return `All ${voucher.maxRedemptions ?? voucher.redeemedCount ?? 0} uses taken${
				voucher.endsAt
					? ` · had until ${formatVoucherMoment(voucher.endsAt)}`
					: ""
			}`;
		case "expired":
			return voucher.endsAt
				? `Ended ${formatVoucherMoment(voucher.endsAt)} · ${uses}`
				: `Ended · ${uses}`;
		case "voided":
			return `${
				voucher.voidReason
					? `Voided — ${voucher.voidReason}`
					: "Voided — the code no longer works"
			} · ${uses}`;
		case "active":
			return `${uses} · ${
				voucher.endsAt
					? `ends ${formatVoucherMoment(voucher.endsAt)}`
					: "no end time"
			}`;
		case "scheduled":
			// The start leads: it is what the seller set it up for, and the
			// one thing about the code that hasn't happened yet.
			return `Starts ${
				voucher.startsAt ? formatVoucherMoment(voucher.startsAt) : "later"
			}${voucher.endsAt ? ` · ends ${formatVoucherMoment(voucher.endsAt)}` : ""}${
				voucher.maxRedemptions !== undefined
					? ` · ${voucher.maxRedemptions} uses`
					: ""
			}`;
	}
}

function StatusPill({
	status,
	paused = false,
}: {
	status: VoucherStatus;
	paused?: boolean;
}) {
	// Only an ACTIVE row changes: a spent or voided code is unaffected by the
	// store's plan, and relabelling those would overstate what the gate does.
	if (paused && (status === "active" || status === "scheduled"))
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
				<PauseCircle className="size-3" aria-hidden />
				Paused
			</span>
		);
	const look: Record<
		VoucherStatus,
		{ label: string; className: string; icon: ReactNode }
	> = {
		active: {
			label: "Active",
			className: "bg-accent/15 text-accent-emphasis",
			icon: <Ticket className="size-3" aria-hidden />,
		},
		redeemed: {
			label: "Used",
			className: "bg-muted text-muted-foreground",
			icon: <CheckCircle2 className="size-3" aria-hidden />,
		},
		expired: {
			label: "Expired",
			className: "bg-muted text-muted-foreground",
			icon: <CalendarX className="size-3" aria-hidden />,
		},
		voided: {
			label: "Voided",
			className: "bg-destructive/10 text-destructive",
			icon: <Ban className="size-3" aria-hidden />,
		},
		// Live-in-waiting, not dead: the accent's outline rather than the muted
		// fill the ended states wear (`z8r3fdz0pw`).
		scheduled: {
			label: "Scheduled",
			className: "border border-accent/40 text-accent-emphasis",
			icon: <CalendarClock className="size-3" aria-hidden />,
		},
	};
	const { label, className, icon } = look[status];
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
		>
			{icon}
			{label}
		</span>
	);
}

function formatDay(epoch: number): string {
	return new Date(epoch).toLocaleDateString("en-MY", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "Asia/Kuala_Lumpur",
	});
}

export function VoucherListSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1, 2, 3].map((n) => (
				<li
					key={n}
					className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4"
				>
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="h-4 w-48 rounded" />
						<Skeleton className="h-3 w-32 rounded" />
					</div>
					<Skeleton className="h-10 w-20 shrink-0 rounded-lg" />
				</li>
			))}
		</ul>
	);
}
