import { useMutation } from "convex/react";
import { Clock, Lock, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClaimSendOutcome } from "../../../convex/lib/orderClaims";
import { MASK_PII } from "../../lib/analytics-privacy";
import { formatClaimCountdown } from "../../lib/countdown";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	ClaimCopyLinkButton,
	ClaimRetryButton,
	ClaimSendNotice,
	useClaimNow,
} from "./claim-actions";

export type LiveClaim = {
	claimId: Id<"orderClaims">;
	token: string;
	expiresAt: number;
	windowMinutes: number;
	currency: string;
	itemsTotal: number;
	lines: Array<{
		name: string;
		variantLabel: string | undefined;
		price: number;
		quantity: number;
	}>;
	sentCount: number;
	lastSentAt: number;
	lastSendOutcome: ClaimSendOutcome | undefined;
};

/**
 * What a seller sees when they open a counter checkout whose claim link is
 * still out (86eyq0epn, Zaki 27 Aug).
 *
 * The build screen used to open here, fully editable, and every edit was a
 * trap: changing the cart silently diverged from the frozen offer the buyer is
 * looking at (their page never updates, so the seller believes a change landed
 * that didn't), while ringing it up at the counter — or sending again — killed
 * the buyer's open link mid-form. During a live, where this happens fast and
 * often, that is a mistake waiting to be made.
 *
 * So the checkout is READ-ONLY while the link is live, and the way back to
 * editing is one deliberate, confirmed step: cancel the link. That is also the
 * only honest way to do it, because cancelling is what tells the buyer their
 * offer was withdrawn. Same posture as the post-commit freeze
 * (`isPaymentWindowLocked`): once an offer is out, you release it before you
 * change it.
 *
 * The lines shown are the claim's frozen SNAPSHOT, not the session draft —
 * this screen answers "what is that buyer looking at right now?"
 */
export function WaitingOnBuyerScreen({
	claim,
	buyerName,
}: {
	claim: LiveClaim;
	/** Resolved display name; the screen is never reached for anonymous sales. */
	buyerName: string | undefined;
}) {
	const cancelClaim = useMutation(api.orderClaims.cancelClaim);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const now = useClaimNow(true);
	const remaining = claim.expiresAt - now;
	const stillOpen = remaining > 0;
	const who = buyerName ?? "this buyer";

	async function release() {
		setCancelling(true);
		try {
			await cancelClaim({ claimId: claim.claimId });
			// No navigation: `getCheckoutSession` is a live subscription, so the
			// screen flips itself back to the editable build screen the moment the
			// claim stops being live.
			toast.success("Link released — this checkout is editable again");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setCancelling(false);
			setConfirmOpen(false);
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-md flex-col gap-3">
			<section className="flex flex-col gap-3 rounded-2xl border-2 border-accent/40 bg-card p-4 shadow-sm">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="text-xs font-semibold uppercase tracking-widest text-accent-emphasis">
							Link sent
						</p>
						<h2
							className="truncate font-heading text-lg font-bold"
							{...MASK_PII}
						>
							Waiting on {who}
						</h2>
					</div>
					<span
						className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${
							stillOpen
								? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
								: "bg-muted text-muted-foreground"
						}`}
					>
						<Clock className="size-3.5" aria-hidden />
						{stillOpen ? formatClaimCountdown(remaining) : "Expired"}
					</span>
				</div>

				<p className="text-sm text-muted-foreground">
					{stillOpen ? (
						<>
							They&apos;re choosing delivery or pickup, date &amp; time and
							payment on their phone. These prices are locked for them until the
							countdown runs out.
						</>
					) : (
						<>
							The countdown ran out, so the link no longer works. Cancel it
							below to edit this checkout and send a fresh one.
						</>
					)}
				</p>

				{/* The frozen snapshot — deliberately the claim's lines, not the
				    session draft: this is the cart that buyer is looking at. */}
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{claim.lines.map((line) => (
						<li
							key={`${line.name}-${line.variantLabel ?? ""}`}
							className="flex items-center justify-between gap-3 px-3 py-2"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">
									{line.name}
									{line.variantLabel ? (
										<span className="ml-1 font-normal text-muted-foreground">
											{line.variantLabel}
										</span>
									) : null}
								</p>
								<p className="text-xs text-muted-foreground">
									{line.quantity} × {formatPrice(line.price, claim.currency)}
								</p>
							</div>
							<span className="shrink-0 text-sm font-semibold tabular-nums">
								{formatPrice(line.price * line.quantity, claim.currency)}
							</span>
						</li>
					))}
				</ul>
				<div className="flex items-center justify-between text-sm">
					{/* "Locked total", not "Total": the buyer adds delivery on their own
					    page, so this figure is the commitment, not the final bill. */}
					<span className="font-medium text-muted-foreground">
						Locked total
					</span>
					<span className="text-lg font-bold tabular-nums">
						{formatPrice(claim.itemsTotal, claim.currency)}
					</span>
				</div>

				<ClaimSendNotice outcome={claim.lastSendOutcome} />

				<div className="flex flex-wrap gap-2">
					<ClaimCopyLinkButton token={claim.token} className="flex-1" />
					<ClaimRetryButton
						claim={claim}
						now={now}
						stillOpen={stillOpen}
						className="flex-1"
					/>
				</div>
			</section>

			{/* The lock is stated, not just enforced — a seller who can't find the
			    Add buttons must not be left guessing why they're gone. */}
			<p className="flex items-start gap-2 rounded-2xl border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
				<Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
				<span>
					This checkout is locked while the link is out. Changes here
					couldn&apos;t reach {who}&apos;s page anyway — to change the order,
					cancel the link and send a new one.
				</span>
			</p>

			<button
				type="button"
				onClick={() => setConfirmOpen(true)}
				className="tap-target flex w-full items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<Pencil className="size-4" aria-hidden />
				Cancel link &amp; edit this order
			</button>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={(o) => {
					if (!cancelling) setConfirmOpen(o);
				}}
				title="Cancel this link?"
				description={
					<>
						<span {...MASK_PII}>{who}</span>&apos;s page will say the offer was
						withdrawn, and anything they&apos;ve filled in is lost. The items
						come back here so you can change them and send a new link. Nothing
						is charged either way.
					</>
				}
				confirmLabel="Cancel link"
				cancelLabel="Keep waiting"
				destructive
				onConfirm={release}
			/>
		</div>
	);
}
