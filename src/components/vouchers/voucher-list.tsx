import { Link } from "@tanstack/react-router";
import { Ban, CalendarX, CheckCircle2, Share2, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { VoucherKind, VoucherStatus } from "../../../convex/lib/vouchers";
import { formatVoucherTerms } from "../../../convex/lib/vouchers";
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
	canWrite,
	/** Rendered nested under a batch parent: the card loses its own border and
	 * tightens, so a run reads as ONE object rather than N floating cards. */
	nested = false,
}: {
	vouchers: ReadonlyArray<VoucherRowView>;
	onShare: (voucher: VoucherRowView) => void;
	onVoid: (voucher: VoucherRowView) => void;
	/** A teammate with read-only on `vouchers` sees the book and no actions. */
	canWrite: boolean;
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
									voucher.status === "active"
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
							<StatusPill status={voucher.status} />
						</div>
						<p className="text-xs text-muted-foreground">
							<OutcomeLine voucher={voucher} />
						</p>
						{/* Nested, the note is the BATCH's name and the parent card is
						    already titled with it — printing it again on all six rows
						    says the same word six times inside the thing it names. */}
						{voucher.note && !nested ? (
							<p className="truncate text-xs italic text-muted-foreground">
								{voucher.note}
							</p>
						) : null}
					</div>

					{canWrite && voucher.status === "active" ? (
						<div className="flex shrink-0 gap-2">
							<Button
								variant="outline"
								className="tap-target flex-1 gap-1.5 sm:flex-none"
								onClick={() => onShare(voucher)}
							>
								<Share2 className="size-4" aria-hidden />
								Share
							</Button>
							<Button
								variant="ghost"
								className="tap-target flex-1 text-muted-foreground hover:text-destructive sm:flex-none"
								onClick={() => onVoid(voucher)}
							>
								Void
							</Button>
						</div>
					) : null}
				</li>
			))}
		</ul>
	);
}

/** What HAPPENED to this voucher, in the seller's words. The status pill says
 * which state; this line says the useful part. */
function OutcomeLine({ voucher }: { voucher: VoucherRowView }): ReactNode {
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
	}
}

function StatusPill({ status }: { status: VoucherStatus }) {
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
